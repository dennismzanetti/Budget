/**
 * transactions.js — Transactions page
 *
 * Exports:
 *   initTransactionsPage(uid) — wires up the #transactions page UI
 *
 * Schema (written by import.js):
 *   Collection : transactions (global, root-level)
 *   Fields     : date (Timestamp), payee (string), amountCents (int),
 *                type ("expense"|"income"), accountId, categoryId,
 *                notes, sourceId, isActive, isCleared, source
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, updateDoc, deleteDoc,
  doc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { populateAccountSelect } from "./accounts.js";
import { getCategoriesMap } from "./categories.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(val) {
  if (!val) return "";
  if (val.toDate) return val.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const d = new Date(val);
  return isNaN(d) ? val : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Convert integer cents to a display dollar string (e.g. 1099 → "10.99") */
function centsToDisplay(amountCents) {
  const n = typeof amountCents === "number" ? amountCents : parseInt(amountCents, 10);
  if (isNaN(n)) return "0.00";
  return (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDateValue(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

/** Build a <select> for categories using the live categories map */
function categorySelect(currentCategoryId, rowId, catMap) {
  const opts = Object.entries(catMap).map(([id, cat]) =>
    `<option value="${escHtml(id)}"${id === currentCategoryId ? " selected" : ""}>${escHtml(cat.name)}</option>`
  ).join("");
  return `<select class="txn-category-select" data-id="${rowId}">
    <option value="">-- none --</option>
    ${opts}
  </select>`;
}

export async function initTransactionsPage(_uid) {
  console.debug("[txn] initTransactionsPage called, uid:", _uid);

  // ── NOTE: The page element ID in HTML is "page-transactions" ─────
  const page = document.getElementById("page-transactions");
  if (!page) { console.warn("[txn] #page-transactions element not found"); return; }

  // ── DOM refs ──────────────────────────────────────────────────────
  const acctFilter    = document.getElementById("txnFilterAccount");
  const catFilter     = document.getElementById("txnFilterCategory");
  const typeFilter    = document.getElementById("txnFilterType");
  const dateFrom      = document.getElementById("txnFilterDateFrom");
  const dateTo        = document.getElementById("txnFilterDateTo");
  const searchInput   = document.getElementById("txnSearch");
  const clearBtn      = document.getElementById("txnClearFilters");
  const tbody         = document.getElementById("txnTableBody");
  const summaryCount  = document.getElementById("txnSummaryCount");
  const summaryIncome = document.getElementById("txnSummaryIncome");
  const summaryExpense= document.getElementById("txnSummaryExpense");

  console.debug("[txn] DOM refs — tbody:", !!tbody, "acctFilter:", !!acctFilter, "catFilter:", !!catFilter, "typeFilter:", !!typeFilter);

  if (!tbody) { console.error("[txn] #txnTableBody not found — aborting"); return; }

  // Populate account filter
  if (acctFilter) {
    await populateAccountSelect(_uid, acctFilter);
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All Accounts";
    acctFilter.prepend(allOpt);
    acctFilter.value = "";
  }

  // ── Account name cache ────────────────────────────────────────────
  let accountMap = {};
  try {
    const snap = await getDocs(collection(getDb(), "accounts"));
    snap.docs.forEach(d => { accountMap[d.id] = d.data().name ?? d.id; });
    console.debug("[txn] accountMap loaded:", Object.keys(accountMap).length, "accounts", accountMap);
  } catch (e) {
    console.warn("[transactions] could not load account names", e);
  }

  // ── Category map: { id -> { name, color } } ───────────────────────
  let catMap = {};
  try {
    catMap = await getCategoriesMap(_uid);
    console.debug("[txn] catMap loaded:", Object.keys(catMap).length, "categories", catMap);
  } catch (e) {
    console.warn("[transactions] could not load categories", e);
  }

  // Populate category filter from the live catMap
  if (catFilter) {
    catFilter.innerHTML =
      '<option value="">All Categories</option>' +
      Object.entries(catMap)
        .map(([id, cat]) => `<option value="${escHtml(id)}">${escHtml(cat.name)}</option>`)
        .join("");
  }

  // ── Load all transactions ─────────────────────────────────────────
  let allTxns = [];

  async function loadTransactions() {
    tbody.innerHTML = `<tr><td colspan="7" class="txn-loading">Loading\u2026</td></tr>`;
    console.debug("[txn] loadTransactions — querying root collection: transactions");
    try {
      const txnCol = collection(getDb(), "transactions");
      const q = query(txnCol, orderBy("date", "desc"));
      const snap = await getDocs(q);
      console.debug("[txn] Firestore snap.size:", snap.size);
      if (snap.size > 0) {
        const first = snap.docs[0];
        console.debug("[txn] first doc id:", first.id, "data:", first.data());
      } else {
        console.warn("[txn] snapshot is EMPTY — no documents returned from root transactions collection");
      }
      allTxns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      console.debug("[txn] allTxns loaded:", allTxns.length);
      renderTable();
    } catch (err) {
      console.error("[transactions] loadTransactions error:", err);
      tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">Error loading transactions.</td></tr>`;
    }
  }

  // ── Filter + render ───────────────────────────────────────────────
  function renderTable() {
    const acctVal   = acctFilter?.value ?? "";
    const catVal    = catFilter?.value ?? "";
    const typeVal   = typeFilter?.value ?? "";
    const fromVal   = dateFrom?.value ? new Date(dateFrom.value) : null;
    const toVal     = dateTo?.value ? new Date(dateTo.value + "T23:59:59") : null;
    const searchVal = searchInput?.value.trim().toLowerCase() ?? "";

    console.debug("[txn] renderTable — allTxns:", allTxns.length, "active filters:", { acctVal, catVal, typeVal, fromVal, toVal, searchVal });

    const filtered = allTxns.filter(t => {
      if (acctVal && t.accountId !== acctVal) return false;
      if (catVal  && t.categoryId !== catVal) return false;
      if (typeVal && t.type !== typeVal) return false;
      const d = getDateValue(t.date);
      if (fromVal && d && d < fromVal) return false;
      if (toVal   && d && d > toVal)   return false;
      if (searchVal) {
        const payee   = (t.payee ?? "").toLowerCase();
        const catName = (catMap[t.categoryId]?.name ?? "").toLowerCase();
        const notes   = (t.notes ?? "").toLowerCase();
        if (!payee.includes(searchVal) && !catName.includes(searchVal) && !notes.includes(searchVal)) return false;
      }
      return true;
    });

    console.debug("[txn] filtered count:", filtered.length);
    if (allTxns.length > 0 && filtered.length === 0) {
      console.warn("[txn] allTxns has data but filtered is empty — check filter values above");
      console.debug("[txn] sample allTxns[0]:", JSON.stringify(allTxns[0]));
    }

    // Summary
    let totalIncomeCents = 0, totalExpenseCents = 0;
    filtered.forEach(t => {
      const cents = typeof t.amountCents === "number" ? t.amountCents : 0;
      if (t.type === "income")  totalIncomeCents  += cents;
      else                      totalExpenseCents += cents;
    });
    if (summaryCount)   summaryCount.textContent   = filtered.length.toLocaleString();
    if (summaryIncome)  summaryIncome.textContent  = "$" + (totalIncomeCents  / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (summaryExpense) summaryExpense.textContent = "-$" + (totalExpenseCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">No transactions match your filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(t => {
      const isIncome = t.type === "income";
      const acctName = accountMap[t.accountId] ?? (t.accountId ? t.accountId : "—");
      return `
        <tr class="txn-row" data-id="${t.id}">
          <td class="txn-col-date">${escHtml(formatDate(t.date))}</td>
          <td class="txn-col-desc">${escHtml(t.payee ?? "")}</td>
          <td class="txn-col-account txn-hide-mobile">${escHtml(acctName)}</td>
          <td class="txn-col-category">${categorySelect(t.categoryId ?? "", t.id, catMap)}</td>
          <td class="txn-col-type txn-hide-mobile">
            <span class="txn-type-badge txn-type-badge--${isIncome ? "income" : "expense"}">
              ${isIncome ? "Income" : "Expense"}
            </span>
          </td>
          <td class="txn-col-amount txn-amount--${isIncome ? "income" : "expense"}">
            ${isIncome ? "" : "-"}$${centsToDisplay(t.amountCents)}
          </td>
          <td class="txn-col-actions">
            <button class="btn btn-ghost btn-sm txn-delete-btn" data-id="${t.id}" title="Delete transaction" aria-label="Delete transaction">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </td>
        </tr>`;
    }).join("");

    // ── Category inline-save ──────────────────────────────────────────
    tbody.querySelectorAll(".txn-category-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const id    = sel.dataset.id;
        const catId = sel.value;
        console.debug("[txn] category change — txn id:", id, "new categoryId:", catId);
        try {
          await updateDoc(doc(getDb(), "transactions", id), { categoryId: catId, updatedAt: new Date() });
          const txn = allTxns.find(t => t.id === id);
          if (txn) txn.categoryId = catId;
          sel.classList.add("txn-category-saved");
          setTimeout(() => sel.classList.remove("txn-category-saved"), 900);
        } catch (err) {
          console.error("[transactions] category update error:", err);
          sel.classList.add("txn-category-error");
          setTimeout(() => sel.classList.remove("txn-category-error"), 900);
        }
      });
    });

    // ── Delete with confirm ───────────────────────────────────────────
    tbody.querySelectorAll(".txn-delete-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id  = btn.dataset.id;
        const row = tbody.querySelector(`tr[data-id="${id}"]`);
        if (!confirm("Delete this transaction? This cannot be undone.")) return;
        console.debug("[txn] deleting transaction id:", id);
        try {
          await deleteDoc(doc(getDb(), "transactions", id));
          allTxns = allTxns.filter(t => t.id !== id);
          row?.remove();
          renderTable();
        } catch (err) {
          console.error("[transactions] deleteDoc error:", err);
          alert("Delete failed. Please try again.");
        }
      });
    });
  }

  // ── Filter event listeners ────────────────────────────────────────
  [acctFilter, catFilter, typeFilter, dateFrom, dateTo].forEach(el => {
    el?.addEventListener("change", renderTable);
  });
  searchInput?.addEventListener("input", renderTable);

  clearBtn?.addEventListener("click", () => {
    if (acctFilter)  acctFilter.value  = "";
    if (catFilter)   catFilter.value   = "";
    if (typeFilter)  typeFilter.value  = "";
    if (dateFrom)    dateFrom.value    = "";
    if (dateTo)      dateTo.value      = "";
    if (searchInput) searchInput.value = "";
    renderTable();
  });

  await loadTransactions();
}
