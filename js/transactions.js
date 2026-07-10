/**
 * transactions.js — Transactions page
 *
 * Exports:
 *   initTransactionsPage(uid) — wires up the #transactions page UI
 *
 * Schema (written by import.js):
 *   Collection : users/{uid}/transactions (per-user subcollection)
 *   Fields     : date (Timestamp), payee (string), amountCents (int),
 *                type ("expense"|"income"), accountId, categoryId,
 *                notes, sourceId, isActive, isCleared, source
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, updateDoc, deleteDoc,
  doc, query, orderBy, where
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

function categorySelect(currentCategoryId, rowId, catMap) {
  const opts = Object.entries(catMap).map(([id, cat]) =>
    `<option value="${escHtml(id)}"${id === currentCategoryId ? " selected" : ""}>${escHtml(cat.name)}</option>`
  ).join("");
  return `<select class="txn-category-select" data-id="${rowId}">
    <option value="">-- none --</option>
    ${opts}
  </select>`;
}

/** Returns true if any filter is currently active */
function hasActiveFilters(acctFilter, catFilter, typeFilter, dateFrom, dateTo, searchInput) {
  return !!((acctFilter?.value) || (catFilter?.value) || (typeFilter?.value) ||
    (dateFrom?.value) || (dateTo?.value) || (searchInput?.value.trim()));
}

export async function initTransactionsPage(_uid) {
  console.debug("[txn] initTransactionsPage called, uid:", _uid);

  const page = document.getElementById("transactions");
  if (!page) { console.warn("[txn] #transactions element not found"); return; }

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
  const summaryNet    = document.getElementById("txnSummaryNet");

  if (!tbody) { console.error("[txn] #txnTableBody not found — aborting"); return; }

  // ── Sort state ────────────────────────────────────────────────────
  let sortCol = "date";
  let sortDir = "desc";

  const sortableHeaders = document.querySelectorAll(".txn-th--sortable");
  sortableHeaders.forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = col === "amount" ? "desc" : "asc";
      }
      updateSortHeaders();
      renderTable();
    });
  });

  function updateSortHeaders() {
    sortableHeaders.forEach(th => {
      const col = th.dataset.col;
      const icon = th.querySelector(".txn-sort-icon");
      th.classList.toggle("txn-th--sorted", col === sortCol);
      th.setAttribute("aria-sort", col === sortCol ? (sortDir === "asc" ? "ascending" : "descending") : "none");
      if (icon) {
        icon.textContent = col !== sortCol ? "\u2195" : sortDir === "asc" ? "\u2191" : "\u2193";
      }
    });
  }

  updateSortHeaders();

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
  let allAccountIds = [];
  try {
    const snap = await getDocs(collection(getDb(), "accounts"));
    snap.docs.forEach(d => {
      accountMap[d.id] = d.data().name ?? d.id;
      allAccountIds.push(d.id);
    });
  } catch (e) {
    console.warn("[transactions] could not load account names", e);
  }

  // ── Category map ─────────────────────────────────────────────────
  let catMap = {};
  try {
    // FIX 4: use getCategoriesMap with uid to resolve categoryId → name
    catMap = await getCategoriesMap(_uid);
  } catch (e) {
    console.warn("[transactions] could not load categories", e);
  }

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

    if (allAccountIds.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">No accounts found. Please add an account first.</td></tr>`;
      return;
    }

    try {
      // FIX 1: use per-user subcollection users/{uid}/transactions
      const txnCol = collection(getDb(), "users", _uid, "transactions");
      const IN_LIMIT = 30;
      const allDocs = [];

      for (let i = 0; i < allAccountIds.length; i += IN_LIMIT) {
        const chunk = allAccountIds.slice(i, i + IN_LIMIT);
        const q = query(txnCol, where("accountId", "in", chunk), orderBy("date", "desc"));
        const snap = await getDocs(q);
        snap.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
      }

      allTxns = allDocs;
      renderTable();
    } catch (err) {
      console.error("[transactions] loadTransactions error:", err);
      tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">Error loading transactions.</td></tr>`;
    }
  }

  // ── Sort helper ───────────────────────────────────────────────────
  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      let av, bv;
      switch (sortCol) {
        case "date":
          av = getDateValue(a.date)?.getTime() ?? 0;
          bv = getDateValue(b.date)?.getTime() ?? 0;
          break;
        case "payee":
          // FIX 2: sort on t.payee (not t.description)
          av = (a.payee ?? "").toLowerCase();
          bv = (b.payee ?? "").toLowerCase();
          break;
        case "account":
          av = (accountMap[a.accountId] ?? "").toLowerCase();
          bv = (accountMap[b.accountId] ?? "").toLowerCase();
          break;
        case "category":
          // FIX 4: resolve categoryId via catMap
          av = (catMap[a.categoryId]?.name ?? "").toLowerCase();
          bv = (catMap[b.categoryId]?.name ?? "").toLowerCase();
          break;
        case "type":
          av = a.type ?? "";
          bv = b.type ?? "";
          break;
        case "amount":
          // FIX 3: use amountCents directly
          av = typeof a.amountCents === "number" ? a.amountCents : 0;
          bv = typeof b.amountCents === "number" ? b.amountCents : 0;
          break;
        default:
          return 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }

  // ── Update clear button visibility ───────────────────────────────
  function updateClearBtn() {
    if (!clearBtn) return;
    clearBtn.classList.toggle("hidden", !hasActiveFilters(acctFilter, catFilter, typeFilter, dateFrom, dateTo, searchInput));
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
      if (catVal  && t.categoryId !== catVal) return false;
      // FIX 5: filter by t.type string, not by sign of amount
      if (typeVal && t.type !== typeVal) return false;
      const d = getDateValue(t.date);
      if (fromVal && d && d < fromVal) return false;
      if (toVal   && d && d > toVal)   return false;
      if (searchVal) {
        // FIX 2: search on t.payee (not t.description)
        const payee   = (t.payee ?? "").toLowerCase();
        const catName = (catMap[t.categoryId]?.name ?? "").toLowerCase();
        const notes   = (t.notes ?? "").toLowerCase();
        if (!payee.includes(searchVal) && !catName.includes(searchVal) && !notes.includes(searchVal)) return false;
      }
      return true;
    });

    // ── Update summary cards ─────────────────────────────────────────
    let totalIncomeCents = 0, totalExpenseCents = 0;
    filtered.forEach(t => {
      // FIX 3 & 5: use amountCents and t.type
      const cents = typeof t.amountCents === "number" ? t.amountCents : 0;
      if (t.type === "income") totalIncomeCents  += cents;
      else                     totalExpenseCents += cents;
    });
    const netCents = totalIncomeCents - totalExpenseCents;
    const fmt = cents => "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (summaryCount)   summaryCount.textContent   = filtered.length.toLocaleString();
    if (summaryIncome)  summaryIncome.textContent  = fmt(totalIncomeCents);
    if (summaryExpense) summaryExpense.textContent = "-" + fmt(totalExpenseCents);
    if (summaryNet) {
      summaryNet.textContent = (netCents < 0 ? "-" : "") + fmt(netCents);
      summaryNet.classList.toggle("negative", netCents < 0);
    }

    updateClearBtn();

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="txn-empty">No transactions match your filters.</td></tr>`;
      return;
    }

    const sorted = sortRows(filtered);

    tbody.innerHTML = sorted.map(t => {
      // FIX 5: use t.type for income/expense classification
      const isIncome = t.type === "income";
      const acctName = accountMap[t.accountId] ?? (t.accountId ? t.accountId : "\u2014");
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

    // ── Category inline-save ─────────────────────────────────────────
    tbody.querySelectorAll(".txn-category-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const id    = sel.dataset.id;
        const catId = sel.value;
        try {
          // FIX 1: write to the correct subcollection path
          await updateDoc(doc(getDb(), "users", _uid, "transactions", id), { categoryId: catId, updatedAt: new Date() });
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
        try {
          // FIX 1: delete from correct subcollection path
          await deleteDoc(doc(getDb(), "users", _uid, "transactions", id));
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
