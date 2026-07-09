/**
 * transactions.js — Firestore transactions layer + UI for the Transactions page
 *
 * Exports:
 *   initTransactionsPage(uid) — wires up the #page-transactions UI
 *
 * Transactions are stored in the top-level "transactions" collection.
 * Schema (set by import.js):
 *   date        Firestore Timestamp
 *   description string
 *   amountCents number (positive integer, cents)
 *   type        "expense" | "income"
 *   accountId   string (ref to accounts/{id})
 *   category    string | undefined
 *   sourceId    string (dedup key)
 *   importedAt  Timestamp
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { populateAccountSelect } from "./accounts.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

const CATEGORIES = [
  "Groceries",
  "Dining",
  "Gas",
  "Auto",
  "Mortgage",
  "Utilities",
  "Subscriptions",
  "Healthcare",
  "Shopping",
  "Travel",
  "Entertainment",
  "Income",
  "Transfer",
  "Other",
];

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(cents, type) {
  const dollars = (cents / 100).toFixed(2);
  const formatted = Number(dollars).toLocaleString("en-US", { minimumFractionDigits: 2 });
  return (type === "expense" ? "-" : "+") + "$" + formatted;
}

function transactionsRef() {
  return collection(getDb(), "transactions");
}

async function fetchAccountMap() {
  const snap = await getDocs(collection(getDb(), "accounts"));
  const map = {};
  snap.docs.forEach(d => { map[d.id] = d.data().name || d.id; });
  return map;
}

export async function initTransactionsPage(_uid) {
  const page = document.getElementById("page-transactions");
  if (!page) return;

  // Build UI if not yet rendered
  if (!page.querySelector(".txn-toolbar")) {
    page.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Transactions</h2>
      </div>

      <!-- Filter / Search toolbar -->
      <div class="txn-toolbar card">
        <div class="txn-filters">
          <div class="form-field">
            <label class="form-label" for="txnFilterAccount">Account</label>
            <select id="txnFilterAccount" class="form-input txn-filter-select">
              <option value="">All accounts</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="txnFilterCategory">Category</label>
            <select id="txnFilterCategory" class="form-input txn-filter-select">
              <option value="">All categories</option>
              <option value="__uncategorized__">Uncategorized</option>
              ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="txnFilterType">Type</label>
            <select id="txnFilterType" class="form-input txn-filter-select">
              <option value="">All types</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="txnFilterDateFrom">From</label>
            <input id="txnFilterDateFrom" class="form-input" type="date" />
          </div>
          <div class="form-field">
            <label class="form-label" for="txnFilterDateTo">To</label>
            <input id="txnFilterDateTo" class="form-input" type="date" />
          </div>
        </div>
        <div class="txn-search-row">
          <div class="txn-search-wrap">
            <svg class="txn-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input id="txnSearch" class="form-input txn-search-input" type="search" placeholder="Search description…" />
          </div>
          <button id="txnClearFilters" class="btn btn-ghost btn-sm">Clear filters</button>
        </div>
      </div>

      <!-- Summary bar -->
      <div id="txnSummary" class="txn-summary"></div>

      <!-- Transaction list -->
      <div id="txnList" aria-live="polite" class="txn-list-container"></div>
    `;
  }

  // Populate account filter (populateAccountSelect replaces innerHTML, so re-add All option)
  const accountFilter = page.querySelector("#txnFilterAccount");
  await populateAccountSelect(_uid, accountFilter);
  accountFilter.insertAdjacentHTML("afterbegin", '<option value="">All accounts</option>');
  accountFilter.value = "";

  const categoryFilter = page.querySelector("#txnFilterCategory");
  const typeFilter     = page.querySelector("#txnFilterType");
  const dateFrom       = page.querySelector("#txnFilterDateFrom");
  const dateTo         = page.querySelector("#txnFilterDateTo");
  const searchInput    = page.querySelector("#txnSearch");
  const clearBtn       = page.querySelector("#txnClearFilters");
  const listEl         = page.querySelector("#txnList");
  const summaryEl      = page.querySelector("#txnSummary");

  let allTxns    = [];
  let accountMap = {};

  async function loadData() {
    listEl.innerHTML = '<div class="txn-loading">Loading transactions…</div>';
    try {
      const [snap, aMap] = await Promise.all([
        getDocs(query(transactionsRef(), orderBy("date", "desc"))),
        fetchAccountMap(),
      ]);
      accountMap = aMap;
      allTxns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderList();
    } catch (err) {
      console.error("[transactions] load error:", err);
      listEl.innerHTML = '<div class="txn-empty"><p>Error loading transactions. Check console.</p></div>';
    }
  }

  function getFiltered() {
    const acct   = accountFilter.value;
    const cat    = categoryFilter.value;
    const type   = typeFilter.value;
    const from   = dateFrom.value ? new Date(dateFrom.value + "T00:00:00") : null;
    const to     = dateTo.value   ? new Date(dateTo.value   + "T23:59:59") : null;
    const search = searchInput.value.trim().toLowerCase();

    return allTxns.filter(t => {
      if (acct && t.accountId !== acct) return false;
      if (cat === "__uncategorized__" && t.category) return false;
      if (cat && cat !== "__uncategorized__" && t.category !== cat) return false;
      if (type && t.type !== type) return false;
      if (from || to) {
        const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        if (from && d < from) return false;
        if (to   && d > to)   return false;
      }
      if (search && !t.description?.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function renderSummary(txns) {
    const expenses = txns.filter(t => t.type === "expense").reduce((s, t) => s + (t.amountCents || 0), 0);
    const income   = txns.filter(t => t.type === "income") .reduce((s, t) => s + (t.amountCents || 0), 0);
    summaryEl.innerHTML = `
      <span class="txn-summary-item">${txns.length} transaction${txns.length !== 1 ? "s" : ""}</span>
      <span class="txn-summary-sep">·</span>
      <span class="txn-summary-item txn-summary--income">Income: +$${(income  /100).toLocaleString("en-US",{minimumFractionDigits:2})}</span>
      <span class="txn-summary-sep">·</span>
      <span class="txn-summary-item txn-summary--expense">Expenses: -$${(expenses/100).toLocaleString("en-US",{minimumFractionDigits:2})}</span>
    `;
  }

  function renderList() {
    const txns = getFiltered();
    renderSummary(txns);

    if (txns.length === 0) {
      listEl.innerHTML = `
        <div class="txn-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          <p>No transactions match your filters.</p>
        </div>`;
      return;
    }

    listEl.innerHTML = `
      <div class="txn-table-wrap">
        <table class="txn-table" role="table">
          <thead>
            <tr>
              <th class="txn-th txn-col-date">Date</th>
              <th class="txn-th txn-col-desc">Description</th>
              <th class="txn-th txn-col-account">Account</th>
              <th class="txn-th txn-col-category">Category</th>
              <th class="txn-th txn-col-amount">Amount</th>
              <th class="txn-th txn-col-actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody id="txnTbody">
            ${txns.map(t => `
              <tr class="txn-row" data-id="${t.id}">
                <td class="txn-td txn-col-date">${formatDate(t.date)}</td>
                <td class="txn-td txn-col-desc">
                  <span class="txn-desc" title="${(t.description || "").replace(/"/g, "&quot;")}">${t.description || "—"}</span>
                </td>
                <td class="txn-td txn-col-account txn-muted">${accountMap[t.accountId] || "—"}</td>
                <td class="txn-td txn-col-category">
                  <select class="txn-category-select js-category-select" data-id="${t.id}" aria-label="Category">
                    <option value="">Uncategorized</option>
                    ${CATEGORIES.map(c => `<option value="${c}" ${t.category === c ? "selected" : ""}>${c}</option>`).join("")}
                  </select>
                </td>
                <td class="txn-td txn-col-amount">
                  <span class="txn-amount txn-amount--${t.type}">${formatAmount(t.amountCents || 0, t.type)}</span>
                </td>
                <td class="txn-td txn-col-actions">
                  <button class="btn btn-ghost btn-sm js-delete-txn" data-id="${t.id}" title="Delete" aria-label="Delete transaction">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Category inline edit
    listEl.querySelectorAll(".js-category-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const id  = sel.dataset.id;
        const val = sel.value;
        try {
          await updateDoc(doc(getDb(), "transactions", id), { category: val || null });
          const t = allTxns.find(x => x.id === id);
          if (t) t.category = val || null;
          sel.classList.add("txn-category-saved");
          setTimeout(() => sel.classList.remove("txn-category-saved"), 1200);
        } catch (err) {
          console.error("[transactions] category update error:", err);
        }
      });
    });

    // Delete
    listEl.querySelectorAll(".js-delete-txn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this transaction? This cannot be undone.")) return;
        try {
          await deleteDoc(doc(getDb(), "transactions", btn.dataset.id));
          allTxns = allTxns.filter(t => t.id !== btn.dataset.id);
          renderList();
        } catch (err) {
          console.error("[transactions] delete error:", err);
        }
      });
    });
  }

  // Wire up filter/search events
  [accountFilter, categoryFilter, typeFilter, dateFrom, dateTo].forEach(el => {
    el.addEventListener("change", renderList);
  });
  searchInput.addEventListener("input", renderList);

  clearBtn.addEventListener("click", () => {
    accountFilter.value  = "";
    categoryFilter.value = "";
    typeFilter.value     = "";
    dateFrom.value       = "";
    dateTo.value         = "";
    searchInput.value    = "";
    renderList();
  });

  loadData();
}
