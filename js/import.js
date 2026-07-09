/**
 * import.js — Bank of America CSV import engine
 *
 * Parses a BofA "Export Data" CSV export and writes
 * new transactions to Firestore under users/{uid}/transactions/.
 *
 * BofA CSV format (current export):
 *   - Row 1: column headers (no metadata rows)
 *   - Row 2+: transaction data
 *
 * Columns: Status, Date, Original Description, Split Type, Category,
 *          Currency, Amount, User Description, Memo, Classification,
 *          Account Name, Simple Description
 *
 * Notes:
 *   - File starts with a UTF-8 BOM (\uFEFF) — stripped before parsing.
 *   - Amount is a single signed column: negative = expense, positive = income.
 *   - Simple Description is used as payee (cleaner merchant name).
 *   - Only "posted" rows are imported; "pending" rows are skipped.
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
  Timestamp,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ensureCategoryExists } from "./categories.js";

const db = getFirestore(getApp());

// ── CSV Parsing ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  // Strip UTF-8 BOM if present
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
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
    // Check any column for "date" — handles BOM and leading blank columns
    if (rows[i].some(col => col.trim().toLowerCase() === "date")) return i;
  }
  return -1;
}

function buildColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((col, i) => {
    map[col.trim().toLowerCase()] = i;
  });
  return map;
}

/**
 * Parse BofA date strings.
 * Handles both MM/DD/YYYY (4-digit year) and MM/DD/YY (2-digit year).
 * 2-digit years are interpreted as 2000+YY.
 */
function parseBofADate(str) {
  const parts = str.trim().split("/");
  if (parts.length !== 3) return null;
  const [mm, dd, yyRaw] = parts;
  let yyyy = parseInt(yyRaw, 10);
  if (isNaN(yyyy)) return null;
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
 * Uses pipe separators and percent-encodes the description.
 */
function buildSourceId(dateObj, description, amountCents) {
  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getUTCDate()).padStart(2, "0");
  const safDesc = encodeURIComponent(description.trim().replace(/\s+/g, " "));
  return `bofa|${yyyy}${mm}${dd}|${safDesc}|${amountCents}`;
}

// ── Main Parse Function ───────────────────────────────────────────────────────

/**
 * Parse a BofA Export Data CSV into an array of candidate transaction objects.
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

    // Only import posted transactions; skip pending
    const status = (row[colMap["status"]] || "").trim().toLowerCase();
    if (status && status !== "posted") { skippedRows++; return; }

    const dateStr = row[colMap["date"]] || "";
    const dateObj = parseBofADate(dateStr);
    if (!dateObj) {
      parseErrors.push(`Row ${headerIdx + 2 + i}: invalid date "${dateStr}" — skipped.`);
      skippedRows++;
      return;
    }

    // Prefer Simple Description for payee; fall back to Original Description
    const simpleDesc = (colMap["simple description"] !== undefined ? row[colMap["simple description"]] : "").trim();
    const originalDesc = (colMap["original description"] !== undefined ? row[colMap["original description"]] : "").trim();
    const payee = simpleDesc || originalDesc;
    if (!payee) { skippedRows++; return; }

    // Amount is a single signed column: negative = expense, positive = income
    const amountStr = row[colMap["amount"]] || "";
    const cents = dollarToCents(amountStr);
    if (cents === null || cents === 0) { skippedRows++; return; }

    const amountCents = Math.abs(cents);
    const type = cents < 0 ? "expense" : "income";

    const categoryName = (colMap["category"] !== undefined ? row[colMap["category"]] : "").trim();
    const sourceId = buildSourceId(dateObj, payee, amountCents);

    parsed.push({
      date: Timestamp.fromDate(dateObj),
      payee,
      amountCents,
      type,
      accountId,
      categoryId: null,            // resolved in importTransactions()
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
  const uniqueNames = [...new Set(
    candidates
      .map(c => c._categoryName ? c._categoryName.trim().toLowerCase() : "")
      .filter(n => n.length > 0)
  )];
  const nameToId = {};
  for (const nameLower of uniqueNames) {
    try {
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
