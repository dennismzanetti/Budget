/**
 * transactions.js — Transactions page
 *
 * Exports:
 *   initTransactionsPage(uid) — wires up the #transactions page UI
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, updateDoc, deleteDoc,
  doc, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { populateAccountSelect } from "./accounts.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

const CATEGORIES = [
  "Auto & Transport",
  "Bills & Utilities",
  "Education",
  "Entertainment",
  "Food & Dining",
  "Gifts & Donations",
  "Health & Fitness",
  "Home",
  "Income",
  "Insurance",
  "Kids",
  "Personal Care",
  "Pets",
  "Shopping",
  "Taxes",
  "Transfer",
  "Travel",
  "Uncategorized",
];

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(val) {
  if (!val) return "";
  if (val.toDate) return val.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const d = new Date(val);
  return isNaN(d) ? val : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDateValue(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function categorySelect(current, rowId) {
  const opts = CATEGORIES.map(c =>
    `<option value="${escHtml(c)}"${c === current ? " selected" : ""}>${escHtml(c)}</option>`
  ).join("");
  return `<select class="txn-category-select" data-id="${rowId}">
    <option value="">-- none --</option>
    ${opts}
  </select>`;
}

export async function initTransactionsPage(_uid) {
  const page = document.getElementById("transactions");
  if (!page) return;

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

  if (!tbody) return;

  // Populate account filter
  if (acctFilter) {
    await populateAccountSelect(_uid, acctFilter);
    // Prepend "All Accounts" option
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All Accounts";
    acctFilter.prepend(allOpt);
    acctFilter.value = "";
  }

  // Populate category filter
  if (catFilter) {
    catFilter.innerHTML =
      '<option value="">All Categories</option>' +
      CATEGORIES.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join("");
  }

  // ── Account name cache ────────────────────────────────────────────
  let accountMap = {};
  try {
    const snap = await getDocs(collection(getDb(), "accounts"));
    snap.docs.forEach(d => { accountMap[d.id] = d.data().name ?? d.id; });
  } catch (e) {
    console.warn("[transactions] could not load account names", e);
  }

  // ── Load all transactions ─────────────────────────────────────────
  let allTxns = [];

  async function loadTransactions() {
    tbody.innerHTML = `<tr><td colspan="7" class="txn-loading">Loading…</td></tr>`;
    try {
      const q = query(collection(getDb(), "transactions"), orderBy("date", "desc"));
      const snap = await getDocs(q);
      allTxns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

    const filtered = allTxns.filter(t => {
      if (acctVal && t.accountId !== acctVal) return false;
      if (catVal  && t.category !== catVal)   return false;
      const amt = parseFloat(t.amount ?? 0);
      if (typeVal === "income"  && amt <= 0)  return false;
      if (typeVal === "expense" && amt >= 0)  return false;
      const d = getDateValue(t.date);
      if (fromVal && d && d < fromVal) return false;
      if (toVal   && d && d > toVal)   return false;
      if (searchVal) {
        const desc = (t.description ?? "").toLowerCase();
        const cat  = (t.category ?? "").toLowerCase();
        if (!desc.includes(searchVal) && !cat.includes(searchVal)) return false;
      }
      return true;
    });

    // Summary
    let totalIncome = 0, totalExpense = 0;
    filtered.forEach(t => {
      const amt = parseFloat(t.amount ?? 0);
      if (amt > 0) totalIncome  += amt;
      else         totalExpense += amt;
    });
    if (summaryCount)   summaryCount.textContent   = filtered.length.toLocaleString();
    if (summaryIncome)  summaryIncome.textContent  = "$" + totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (summaryExpense) summaryExpense.textContent = "-$" + Math.abs(totalExpense).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">No transactions match your filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(t => {
      const amt = parseFloat(t.amount ?? 0);
      const isIncome = amt > 0;
      const acctName = accountMap[t.accountId] ?? (t.accountId ? t.accountId : "—");
      return `
        <tr class="txn-row" data-id="${t.id}">
          <td class="txn-col-date">${escHtml(formatDate(t.date))}</td>
          <td class="txn-col-desc">${escHtml(t.description ?? "")}</td>
          <td class="txn-col-account txn-hide-mobile">${escHtml(acctName)}</td>
          <td class="txn-col-category">${categorySelect(t.category ?? "", t.id)}</td>
          <td class="txn-col-type txn-hide-mobile">
            <span class="txn-type-badge txn-type-badge--${isIncome ? "income" : "expense"}">
              ${isIncome ? "Income" : "Expense"}
            </span>
          </td>
          <td class="txn-col-amount txn-amount--${isIncome ? "income" : "expense"}">
            ${isIncome ? "" : "-"}$${formatAmount(t.amount)}
          </td>
          <td class="txn-col-actions">
            <button class="btn btn-ghost btn-sm txn-delete-btn" data-id="${t.id}" title="Delete transaction" aria-label="Delete transaction">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </td>
        </tr>`;
    }).join("");

    // ── Category inline-save ─────────────────────────────────────────
    tbody.querySelectorAll(".txn-category-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const id  = sel.dataset.id;
        const cat = sel.value;
        try {
          await updateDoc(doc(getDb(), "transactions", id), { category: cat });
          const txn = allTxns.find(t => t.id === id);
          if (txn) txn.category = cat;
          // Green flash feedback
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
        const id = btn.dataset.id;
        const row = tbody.querySelector(`tr[data-id="${id}"]`);
        if (!confirm("Delete this transaction? This cannot be undone.")) return;
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
