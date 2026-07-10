/**
 * bofa-import-page.js — UI controller for the Bank of America import page (#import)
 *
 * Wires up:
 *  - File input for CSV selection
 *  - Account dropdown populated from Firestore via accounts.js
 *  - Import button → calls importBofAFile() with progress feedback
 *  - Results card with stats and any parse/write errors
 *  - "Import another file" reset flow
 *
 * NOTE: All DOM queries and event bindings are deferred inside initImportPage()
 * because this module loads before partials.js has injected the #import HTML.
 */

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { importBofAFile } from "./import.js";
import { populateAccountSelect } from "./accounts.js";

// ── State ──────────────────────────────────────────────────────────────
let currentUid  = null;

const auth = getAuth();
onAuthStateChanged(auth, (user) => {
  currentUid = user ? user.uid : null;
});

// ── File selection helpers ────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Page init — deferred until #import is active ─────────────────────────
export function initImportPage() {
  const fileInput        = document.getElementById("importFileInput");
  const filePreview      = document.getElementById("importFilePreview");
  const fileNameEl       = document.getElementById("importFileName");
  const fileSizeEl       = document.getElementById("importFileSize");
  const fileClearBtn     = document.getElementById("importFileClear");
  const errorBanner      = document.getElementById("importError");
  const submitBtn        = document.getElementById("importSubmitBtn");
  const accountSelect    = document.getElementById("importAccountSelect");
  const progressCard     = document.getElementById("importProgressCard");
  const progressFill     = document.getElementById("importProgressFill");
  const progressMsg      = document.getElementById("importProgressMsg");
  const progressBar      = document.getElementById("importProgressBar");
  const resultCard       = document.getElementById("importResultCard");
  const resultIcon       = document.getElementById("importResultIcon");
  const resultTitle      = document.getElementById("importResultTitle");
  const resultSummary    = document.getElementById("importResultSummary");
  const resultStats      = document.getElementById("importResultStats");
  const resultErrors     = document.getElementById("importResultErrors");
  const importAgainBtn   = document.getElementById("importAgainBtn");
  const uploadCard       = document.querySelector(".import-upload-card");

  if (!fileInput) {
    console.warn("[import] #importFileInput not found — partial may not have loaded yet");
    return;
  }

  // Populate accounts dropdown — wait for a valid uid before querying Firestore
  if (currentUid) {
    populateAccountSelect(currentUid, accountSelect);
  } else {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        populateAccountSelect(user.uid, accountSelect);
        unsubscribe();
      }
    });
  }

  let selectedFile = null;

  function setFile(file) {
    if (!file || !file.name.toLowerCase().endsWith(".csv")) {
      showError("Please select a .csv file exported from Bank of America.");
      return;
    }
    selectedFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    filePreview.classList.remove("hidden");
    hideError();
    updateSubmitState();
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = "";
    filePreview.classList.add("hidden");
    updateSubmitState();
  }

  function updateSubmitState() {
    const ready = selectedFile !== null && accountSelect.value !== "";
    submitBtn.disabled = !ready;
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
  }

  function hideError() {
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
  }

  // ── File input event ────────────────────────────────────────────────────
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });
  fileClearBtn.addEventListener("click", () => clearFile());
  accountSelect.addEventListener("change", updateSubmitState);

  // ── Progress helpers ────────────────────────────────────────────────
  const STEPS = { read: 15, parse: 45, write: 85, done: 100 };

  function setProgress(step, message) {
    const pct = STEPS[step] ?? 50;
    progressFill.style.width = `${pct}%`;
    progressBar.setAttribute("aria-valuenow", pct);
    progressMsg.textContent = message;
  }

  // ── Import flow ───────────────────────────────────────────────────────
  submitBtn.addEventListener("click", async () => {
    if (!selectedFile || !accountSelect.value || !currentUid) return;
    hideError();
    uploadCard.classList.add("hidden");
    progressCard.classList.remove("hidden");
    resultCard.classList.add("hidden");
    setProgress("read", "Reading file…");
    try {
      const result = await importBofAFile(
        currentUid,
        selectedFile,
        accountSelect.value,
        ({ step, message }) => setProgress(step, message)
      );
      showResult(result);
    } catch (err) {
      progressCard.classList.add("hidden");
      uploadCard.classList.remove("hidden");
      showError(`Import failed: ${err.message}`);
    }
  });

  // ── Results display ──────────────────────────────────────────────────────
  function showResult({ imported, duplicates, skippedRows, parseErrors, writeErrors }) {
    progressCard.classList.add("hidden");
    resultCard.classList.remove("hidden");
    const hasErrors = (parseErrors?.length || 0) + (writeErrors?.length || 0) > 0;
    const success = imported > 0 || (!hasErrors);
    resultIcon.innerHTML = success
      ? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="import-result-icon--success"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
      : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="import-result-icon--warn"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    resultTitle.textContent = imported > 0
      ? `${imported} transaction${imported !== 1 ? 's' : ''} imported`
      : "No new transactions imported";
    resultSummary.textContent = duplicates > 0
      ? `${duplicates} duplicate${duplicates !== 1 ? 's' : ''} skipped — already in your database.`
      : "";
    const stats = [
      { label: "Imported",     value: imported,        cls: "stat--green" },
      { label: "Duplicates",   value: duplicates,      cls: "stat--muted" },
      { label: "Skipped rows", value: skippedRows ?? 0, cls: "stat--muted" },
    ];
    resultStats.innerHTML = stats.map(s =>
      `<div class="import-stat ${s.cls}"><dt>${s.label}</dt><dd>${s.value}</dd></div>`
    ).join("");
    const allErrors = [...(parseErrors || []), ...(writeErrors || [])];
    if (allErrors.length) {
      resultErrors.classList.remove("hidden");
      resultErrors.innerHTML =
        `<p class="import-error-heading">Issues encountered (${allErrors.length}):</p>` +
        `<ul>${allErrors.map(e => `<li>${e}</li>`).join("")}</ul>`;
    } else {
      resultErrors.classList.add("hidden");
    }
  }

  // ── Reset / import again ────────────────────────────────────────────────
  importAgainBtn.addEventListener("click", () => {
    clearFile();
    hideError();
    resultCard.classList.add("hidden");
    progressCard.classList.add("hidden");
    uploadCard.classList.remove("hidden");
    progressFill.style.width = "0%";
    progressBar.setAttribute("aria-valuenow", 0);
    progressMsg.textContent = "";
    resultErrors.classList.add("hidden");
    resultStats.innerHTML = "";
  });
}

// ── Trigger init on hashchange to #import ────────────────────────────────
window.addEventListener("hashchange", () => {
  if (window.location.hash === "#import") {
    initImportPage();
  }
});
