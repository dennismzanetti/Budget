/**
 * import.js — Bank of America CSV import engine
 *
 * Parses a BofA checking/savings/credit CSV export and writes
 * new transactions to Firestore under users/{uid}/transactions/.
 *
 * BofA CSV format:
 *   - Rows 1–6: metadata header (account name, date range, etc.)
 *   - Row 7:    column headers
 *   - Row 8+:   transaction data
 *
 * Columns: Date, Description, Amount, Running Bal. (checking/savings)
 *          Date, Description, Reference Number, Credits, Debits (credit card variant)
 *          The credit card format may also include a "Category" column.
 */

import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
  Timestamp,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./app.js";
import { ensureCategoryExists } from "./categories.js";

// ── CSV Parsing ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const cols = [];
    let inQuote = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cell += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === "," && !inQuote) {
        cols.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cols.push(cell.trim());
    rows.push(cols);
  }
  return rows;
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].trim().toLowerCase() === "date") return i;
  }
  return -1;
}

/**
 * Parse BofA date strings.
 * Handles both MM/DD/YYYY (4-digit year) and MM/DD/YY (2-digit year).
 * 2-digit years are interpreted as 2000+YY (BofA statements only go back ~7 years).
 */
function parseBofADate(str) {
  const parts = str.trim().split("/");
  if (parts.length !== 3) return null;
  const [mm, dd, yyRaw] = parts;
  let yyyy = parseInt(yyRaw, 10);
  if (isNaN(yyyy)) return null;
  // Fix 2-digit year: "26" → 2026
  if (yyyy < 100) yyyy = 2000 + yyyy;
  const d = new Date(Date.UTC(yyyy, parseInt(mm, 10) - 1, parseInt(dd, 10)));
  return isNaN(d.getTime()) ? null : d;
}

function dollarToCents(str) {
  const cleaned = str.replace(/,/g, "").trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : Math.round(val * 100);
}

/**
 * Build a collision-resistant sourceId.
 * Uses pipe separators and percent-encodes the description so that
 * a description containing "__" cannot produce an ambiguous ID.
 */
function buildSourceId(dateObj, description, amountCents) {
  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getUTCDate()).padStart(2, "0");
  const safDesc = encodeURIComponent(description.trim().replace(/\s+/g, " "));
  return `bofa|${yyyy}${mm}${dd}|${safDesc}|${amountCents}`;
}

/**
 * Build a normalised column-name → index map.
 * Handles BofA column name variants:
 *   "Debits" / "Debit"  → "debits"
 *   "Credits" / "Credit" → "credits"
 *   "Running Bal." / "Running Bal" → "running bal."
 */
function buildColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((col, i) => {
    let key = col.trim().toLowerCase();
    // Normalise singular → plural for amount columns
    if (key === "debit")  key = "debits";
    if (key === "credit") key = "credits";
    // Normalise "running bal" (no period) → "running bal."
    if (key === "running bal") key = "running bal.";
    map[key] = i;
  });
  return map;
}

/**
 * Extract the transaction amount and type from a data row.
 * Returns null for rows where no non-zero amount is present.
 * Note: $0.00 entries are intentionally skipped — they represent
 * informational rows (e.g. balance carry-forwards) with no real value.
 */
function extractAmount(row, colMap) {
  if (colMap["amount"] !== undefined) {
    const cents = dollarToCents(row[colMap["amount"]] || "");
    if (cents === null || cents === 0) return null;
    return { amountCents: Math.abs(cents), type: cents < 0 ? "expense" : "income" };
  }
  if (colMap["credits"] !== undefined || colMap["debits"] !== undefined) {
    const creditStr = (colMap["credits"] !== undefined ? row[colMap["credits"]] : "") || "";
    const debitStr  = (colMap["debits"]  !== undefined ? row[colMap["debits"]]  : "") || "";
    if (creditStr.trim() !== "") {
      const c = dollarToCents(creditStr);
      if (c !== null && c !== 0) return { amountCents: Math.abs(c), type: "income" };
    }
    if (debitStr.trim() !== "") {
      const d = dollarToCents(debitStr);
      if (d !== null && d !== 0) return { amountCents: Math.abs(d), type: "expense" };
    }
  }
  return null;
}

// ── Main Parse Function ───────────────────────────────────────────────────────

/**
 * Parse a BofA CSV file contents into an array of candidate transaction objects.
 * Category names from the CSV are preserved as `_categoryName` for resolution
 * during the Firestore write phase.
 */
export function parseBofACSV(csvText, accountId) {
  const rows = parseCSV(csvText);
  const headerIdx = findHeaderRow(rows);
  const parseErrors = [];

  if (headerIdx === -1) {
    return { parsed: [], skippedRows: 0, parseErrors: ["Could not find a Date column header in the file. Is this a Bank of America CSV export?"] };
  }

  const colMap = buildColumnMap(rows[headerIdx]);
  const dataRows = rows.slice(headerIdx + 1);
  const parsed = [];
  let skippedRows = 0;

  dataRows.forEach((row, i) => {
    if (row.every(c => c.trim() === "")) { skippedRows++; return; }

    const dateStr = row[colMap["date"]] || "";
    const description = (row[colMap["description"]] || "").trim();

    // Skip rows with no description — they are header continuations or balance rows
    if (!description) { skippedRows++; return; }

    const dateObj = parseBofADate(dateStr);
    if (!dateObj) {
      parseErrors.push(`Row ${headerIdx + 2 + i}: invalid date "${dateStr}" — skipped.`);
      skippedRows++;
      return;
    }

    const amountInfo = extractAmount(row, colMap);
    if (!amountInfo || amountInfo.amountCents === 0) {
      skippedRows++;
      return;
    }

    // Read category name from CSV if present (credit card format may have it)
    const categoryName = (colMap["category"] !== undefined)
      ? (row[colMap["category"]] || "").trim()
      : "";

    const sourceId = buildSourceId(dateObj, description, amountInfo.amountCents);

    parsed.push({
      date: Timestamp.fromDate(dateObj),
      payee: description,
      amountCents: amountInfo.amountCents,
      type: amountInfo.type,
      accountId,
      categoryId: null,           // resolved in importTransactions()
      _categoryName: categoryName, // temporary — stripped before Firestore write
      notes: "",
      transferGroupId: null,
      isCleared: false,
      isActive: true,
      source: "bofa_csv",
      sourceId
    });
  });

  return { parsed, skippedRows, parseErrors };
}

// ── Firestore Write ───────────────────────────────────────────────────────────

/**
 * Import parsed BofA transactions into Firestore for the given user.
 * - Resolves _categoryName to a real categoryId (auto-creates categories as needed).
 * - Normalises category name keys to lowercase before lookup to prevent casing mismatches.
 * - Skips rows whose sourceId already exists (safe to re-import same file).
 */
export async function importTransactions(uid, candidates) {
  if (!candidates.length) return { imported: 0, duplicates: 0, errors: [] };

  const txnCol = collection(db, "users", uid, "transactions");
  const errors = [];
  let duplicates = 0;
  let imported = 0;

  // ── Resolve category names → IDs (batch, deduplicated) ───────────────────
  // Normalise all names to lowercase before deduplication so that
  // "Shopping" and "shopping" are treated as the same category.
  const uniqueNames = [...new Set(
    candidates
      .map(c => c._categoryName ? c._categoryName.trim().toLowerCase() : "")
      .filter(n => n.length > 0)
  )];
  // nameToId keyed by lowercase name
  const nameToId = {};
  for (const nameLower of uniqueNames) {
    try {
      // Pass the original casing for display, but store result under lowercase key.
      // Find original-cased version from candidates for a nicer category label.
      const originalName = candidates.find(
        c => c._categoryName && c._categoryName.trim().toLowerCase() === nameLower
      )?._categoryName?.trim() || nameLower;
      nameToId[nameLower] = await ensureCategoryExists(uid, originalName);
    } catch (e) {
      errors.push(`Category lookup failed for "${nameLower}": ${e.message}`);
    }
  }

  const BATCH_SIZE = 400;

  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const chunk = candidates.slice(offset, offset + BATCH_SIZE);
    const sourceIds = chunk.map(c => c.sourceId);
    const existingIds = new Set();
    const IN_LIMIT = 30;

    for (let j = 0; j < sourceIds.length; j += IN_LIMIT) {
      const slice = sourceIds.slice(j, j + IN_LIMIT);
      try {
        const snap = await getDocs(query(txnCol, where("sourceId", "in", slice)));
        snap.forEach(d => existingIds.add(d.data().sourceId));
      } catch (e) {
        errors.push(`Dedup query failed: ${e.message}`);
      }
    }

    const batch = writeBatch(db);
    let batchCount = 0;

    for (const txn of chunk) {
      if (existingIds.has(txn.sourceId)) {
        duplicates++;
        continue;
      }

      // Resolve category ID using lowercase key, then strip the temp field
      const { _categoryName, ...txnData } = txn;
      if (_categoryName) {
        txnData.categoryId = nameToId[_categoryName.trim().toLowerCase()] ?? null;
      }

      const ref = doc(txnCol);
      batch.set(ref, { ...txnData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      batchCount++;
      imported++;
    }

    if (batchCount > 0) {
      try {
        await batch.commit();
      } catch (e) {
        errors.push(`Batch write failed: ${e.message}`);
        imported -= batchCount;
      }
    }
  }

  return { imported, duplicates, errors };
}

// ── High-level helper ─────────────────────────────────────────────────────────

export async function importBofAFile(uid, file, accountId, onProgress = () => {}) {
  onProgress({ step: "read", message: "Reading file…" });
  const csvText = await file.text();

  onProgress({ step: "parse", message: "Parsing transactions…" });
  const { parsed, skippedRows, parseErrors } = parseBofACSV(csvText, accountId);

  if (parseErrors.length && parsed.length === 0) {
    return { imported: 0, duplicates: 0, skippedRows, parseErrors, writeErrors: [] };
  }

  onProgress({ step: "write", message: `Writing ${parsed.length} transaction(s) to database…` });
  const { imported, duplicates, errors: writeErrors } = await importTransactions(uid, parsed);

  onProgress({ step: "done", message: `Done. ${imported} imported, ${duplicates} duplicate(s) skipped.` });

  return { imported, duplicates, skippedRows, parseErrors, writeErrors };
}
