import { db } from "./app.js";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  deleteDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Collection registry ────────────────────────────────────────────────────────
// Add new collection names here as the app grows — export/import picks them up automatically.
const COLLECTIONS = [
  "transactions",
  "accounts",
  "categories",
  "budgets"
];

const EXPORT_VERSION = 1;

// ── Serialization helpers ──────────────────────────────────────────────────────
function serializeValue(val) {
  if (val instanceof Timestamp) {
    return { __type: "Timestamp", seconds: val.seconds, nanoseconds: val.nanoseconds };
  }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return serializeDoc(val);
  }
  if (Array.isArray(val)) {
    return val.map(serializeValue);
  }
  return val;
}

function serializeDoc(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = serializeValue(v);
  }
  return out;
}

function deserializeValue(val) {
  if (val && typeof val === "object" && val.__type === "Timestamp") {
    return new Timestamp(val.seconds, val.nanoseconds);
  }
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return deserializeDoc(val);
  }
  if (Array.isArray(val)) {
    return val.map(deserializeValue);
  }
  return val;
}

function deserializeDoc(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = deserializeValue(v);
  }
  return out;
}

// ── Export ─────────────────────────────────────────────────────────────────────
export async function exportDatabase() {
  const statusEl = document.getElementById("importExportStatus");
  statusEl.textContent = "Exporting…";

  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: EXPORT_VERSION,
      collections: {}
    };

    for (const colName of COLLECTIONS) {
      const snap = await getDocs(collection(db, colName));
      payload.collections[colName] = snap.docs.map(d => ({
        id: d.id,
        ...serializeDoc(d.data())
      }));
    }

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `budget-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const total = COLLECTIONS.reduce((sum, c) => sum + (payload.collections[c]?.length || 0), 0);
    statusEl.textContent = `✓ Exported ${total} records on ${date}.`;
  } catch (err) {
    console.error("[export] failed:", err);
    statusEl.textContent = `Export failed: ${err.message}`;
  }
}

// ── Import ─────────────────────────────────────────────────────────────────────
export async function importDatabase(file) {
  const statusEl  = document.getElementById("importExportStatus");
  const modal     = document.getElementById("importConfirmModal");
  const summaryEl = document.getElementById("importSummary");
  const confirmBtn = document.getElementById("importConfirmBtn");
  const cancelBtn  = document.getElementById("importCancelBtn");

  statusEl.textContent = "Reading file…";

  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch {
    statusEl.textContent = "Import failed: could not parse JSON file.";
    return;
  }

  if (!payload.collections || typeof payload.collections !== "object") {
    statusEl.textContent = "Import failed: unrecognized backup format.";
    return;
  }

  // Build summary for confirmation modal
  const lines = [];
  for (const colName of Object.keys(payload.collections)) {
    const count = payload.collections[colName]?.length || 0;
    lines.push(`${count} ${colName}`);
  }
  // Also list any known collections that will be wiped but are absent in the backup
  for (const colName of COLLECTIONS) {
    if (!(colName in payload.collections)) {
      lines.push(`0 ${colName} (will be cleared)`);
    }
  }

  summaryEl.innerHTML = lines.map(l => `<li>${l}</li>`).join("");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  statusEl.textContent = "";

  // Wait for user confirmation
  await new Promise((resolve, reject) => {
    confirmBtn.onclick = () => { modal.classList.add("hidden"); modal.setAttribute("aria-hidden", "true"); resolve(); };
    cancelBtn.onclick  = () => { modal.classList.add("hidden"); modal.setAttribute("aria-hidden", "true"); reject(new Error("cancelled")); };
  }).catch(err => {
    if (err.message === "cancelled") { statusEl.textContent = "Import cancelled."; }
    throw err;
  });

  statusEl.textContent = "Importing — please wait…";

  try {
    let totalWritten = 0;

    for (const colName of COLLECTIONS) {
      // 1. Delete all existing docs in this collection
      const existingSnap = await getDocs(collection(db, colName));
      const deleteBatches = [];
      let batch = writeBatch(db);
      let opCount = 0;
      for (const d of existingSnap.docs) {
        batch.delete(doc(db, colName, d.id));
        opCount++;
        if (opCount === 500) {
          deleteBatches.push(batch.commit());
          batch = writeBatch(db);
          opCount = 0;
        }
      }
      if (opCount > 0) deleteBatches.push(batch.commit());
      await Promise.all(deleteBatches);

      // 2. Write incoming docs
      const docs = payload.collections[colName] || [];
      let writeBatchObj = writeBatch(db);
      let writeCount = 0;
      for (const docData of docs) {
        const { id, ...fields } = docData;
        writeBatchObj.set(doc(db, colName, id), deserializeDoc(fields));
        writeCount++;
        totalWritten++;
        if (writeCount === 500) {
          await writeBatchObj.commit();
          writeBatchObj = writeBatch(db);
          writeCount = 0;
        }
      }
      if (writeCount > 0) await writeBatchObj.commit();
    }

    statusEl.textContent = `✓ Import complete — ${totalWritten} records restored. Reload the page to see updated data.`;
  } catch (err) {
    console.error("[import] failed:", err);
    statusEl.textContent = `Import failed: ${err.message}`;
  }
}

// ── Page init ──────────────────────────────────────────────────────────────────
export function initDbExportImport() {
  const exportBtn  = document.getElementById("exportDbBtn");
  const importFile = document.getElementById("importDbFile");

  exportBtn && exportBtn.addEventListener("click", exportDatabase);

  importFile && importFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await importDatabase(file);
    // Reset input so the same file can be re-selected
    importFile.value = "";
  });
}
