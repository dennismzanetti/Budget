/**
 * accounts.js — Firestore accounts layer + UI for the Accounts page
 *
 * Exports:
 *   seedAccountsIfEmpty(uid)           — seeds default accounts on first login
 *   initAccountsPage(uid)              — wires up the #accounts page UI
 *   populateAccountSelect(uid, select) — fills a <select> with account options
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, updateDoc,
  deleteDoc, doc, getDoc, setDoc, serverTimestamp, query, orderBy, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getCategoriesMap } from "./categories.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

const SEED_VERSION = 2;

const DEFAULT_ACCOUNTS = [
  { name: "Dennis Checking",               type: "checking",     institution: "" },
  { name: "Joint Bill Pay",                type: "checking",     institution: "" },
  { name: "Nicole Checking",               type: "checking",     institution: "" },
  { name: "Long Term Savings",             type: "savings",      institution: "" },
  { name: "Advantage Savings",             type: "savings",      institution: "" },
  { name: "Travel Rewards Visa Signature", type: "credit",       institution: "" },
  { name: "Mortgage",                      type: "mortgage",     institution: "" },
  { name: "Toyota",                        type: "vehicle_loan", institution: "" },
];

export const TYPE_LABELS = {
  checking:     "Checking",
  savings:      "Savings",
  credit:       "Credit Card",
  investment:   "Investment",
  mortgage:     "Mortgage",
  vehicle_loan: "Vehicle Loan",
  other:        "Other",
};

// Order in which type groups appear
const TYPE_ORDER = ["checking", "savings", "credit", "investment", "mortgage", "vehicle_loan", "other"];

function accountsRef() {
  return collection(getDb(), "accounts");
}

async function fetchAccounts() {
  const q = query(accountsRef(), orderBy("createdAt"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Nav badge ─────────────────────────────────────────────────────────
function updateAccountsBadge(accounts) {
  const badge = document.getElementById("accounts-count-badge");
  if (!badge) return;
  if (!accounts || accounts.length === 0) {
    badge.textContent = "";
    return;
  }
  const active = accounts.filter(a => a.isActive !== false).length;
  const total  = accounts.length;
  badge.textContent = active === total ? `(${total})` : `${active} (${total})`;
}

// ── Seed ──────────────────────────────────────────────────────────────
export async function seedAccountsIfEmpty(_uid) {
  try {
    const metaRef = doc(getDb(), "meta", "accounts");
    const metaSnap = await getDoc(metaRef);
    const currentVersion = metaSnap.exists() ? (metaSnap.data().seedVersion ?? 0) : 0;
    const snap = await getDocs(accountsRef());
    const hasRealData = snap.docs.some(d => d.data().name);

    if (hasRealData && currentVersion >= SEED_VERSION) {
      console.log("[accounts] up to date (v" + currentVersion + "), skipping seed");
      return;
    }

    if (!snap.empty) {
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }
    await Promise.all(
      DEFAULT_ACCOUNTS.map(a =>
        addDoc(accountsRef(), { ...a, isActive: true, createdAt: serverTimestamp() })
      )
    );
    await setDoc(metaRef, { seedVersion: SEED_VERSION });
    console.log("[accounts] seeded default accounts (v" + SEED_VERSION + ")");
  } catch (err) {
    console.error("[accounts] seed error:", err);
    throw err;
  }
}

// ── Populate a <select> element ───────────────────────────────────────
export async function populateAccountSelect(_uid, selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Loading accounts\u2026</option>';
  try {
    const accounts = await fetchAccounts();
    if (accounts.length === 0) {
      selectEl.innerHTML = '<option value="">No accounts found</option>';
      return;
    }
    selectEl.innerHTML =
      '<option value="">Select account\u2026</option>' +
      accounts
        .filter(a => a.isActive !== false)
        .map(a => `<option value="${a.id}">${a.name} (${TYPE_LABELS[a.type] ?? a.type})</option>`)
        .join("");
  } catch (err) {
    console.error("[accounts] populateAccountSelect error:", err);
    selectEl.innerHTML = '<option value="">Error loading accounts</option>';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtCurrency(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Month navigation state ────────────────────────────────────────────
const now = new Date();
let acctYear  = now.getFullYear();
let acctMonth = now.getMonth(); // 0-indexed

function acctPeriodLabel() {
  return new Date(acctYear, acctMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function acctPeriodStart() { return new Date(acctYear, acctMonth, 1); }
function acctPeriodEnd()   { return new Date(acctYear, acctMonth + 1, 1); }

// ── Fetch ALL transactions for the current period ─────────────────────
async function fetchTxForPeriod() {
  try {
    const txRef = collection(getDb(), "transactions");
    const start = acctPeriodStart();
    const end   = acctPeriodEnd();
    const q = query(
      txRef,
      where("date", ">=", Timestamp.fromDate(start)),
      where("date", "<",  Timestamp.fromDate(end)),
      orderBy("date", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[accounts] fetchTxForPeriod error:", err);
    return [];
  }
}

// ── Build expanded transaction list (mirrors categories buildCardTxList) ─
function buildCardTxList(accountId, txns, catsMap) {
  const matching = txns
    .filter(tx => tx.accountId === accountId)
    .sort((a, b) => {
      const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
      const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
      return db - da;
    });

  const liWrap = document.createElement("li");
  liWrap.className = "cat-breakdown__tx-list-row";
  liWrap.dataset.txListFor = accountId;

  if (matching.length === 0) {
    liWrap.innerHTML = `<div class="cat-breakdown__tx-list cat-card-tx__wrapper"><div class="cat-breakdown__tx-empty">No transactions this period.</div></div>`;
    return liWrap;
  }

  const rows = matching.map(tx => {
    const isIncome = tx.amountCents !== undefined ? tx.type === "income" : (parseFloat(tx.amount) || 0) > 0;
    const absAmt   = tx.amountCents !== undefined
      ? tx.amountCents / 100
      : Math.abs(parseFloat(tx.amount) || 0);
    const payee    = tx.payee || tx.description || "\u2014";
    const catInfo  = catsMap[tx.categoryId] || { name: "Uncategorized", emoji: "" };
    const catLabel = catInfo.emoji ? `${catInfo.emoji} ${catInfo.name}` : catInfo.name;
    const amtClass  = isIncome ? "cat-card-tx__amount--income" : "cat-card-tx__amount--expense";
    const typeClass = isIncome ? "txn-type-badge--income" : "txn-type-badge--expense";
    const typeLabel = isIncome ? "Income" : "Expense";
    const amtSign   = isIncome ? "" : "-";
    return `
      <tr class="cat-card-tx__row">
        <td class="cat-card-tx__date">${escHtml(fmtDate(tx.date))}</td>
        <td class="cat-card-tx__payee" title="${escHtml(payee)}">${escHtml(payee)}</td>
        <td class="cat-card-tx__category">${escHtml(catLabel)}</td>
        <td class="cat-card-tx__type">
          <span class="txn-type-badge ${typeClass}">${typeLabel}</span>
        </td>
        <td class="cat-card-tx__amount ${amtClass}">${amtSign}${fmtCurrency(absAmt)}</td>
      </tr>`;
  }).join("");

  liWrap.innerHTML = `
    <div class="cat-breakdown__tx-list cat-card-tx__wrapper">
      <table class="cat-card-tx__table">
        <thead>
          <tr>
            <th class="cat-card-tx__th">Date</th>
            <th class="cat-card-tx__th">Payee</th>
            <th class="cat-card-tx__th">Category</th>
            <th class="cat-card-tx__th">Type</th>
            <th class="cat-card-tx__th cat-card-tx__th--amount">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return liWrap;
}

// ── SVG icons ─────────────────────────────────────────────────────────
const ICON_EDIT   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_DELETE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICON_CHEVRON = `<svg class="cat-card__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

// ── Render a single account card ──────────────────────────────────────
function renderCard(a, periodTotal) {
  const typeLabel = TYPE_LABELS[a.type] ?? a.type;
  const hasPeriodTotal = periodTotal !== undefined && periodTotal > 0;
  return `
    <li class="account-card account-card--expandable" data-id="${a.id}" role="button" tabindex="0" aria-expanded="false">
      <div class="account-card__info">
        <span class="account-card__name">${escHtml(a.name)}</span>
        <span class="account-card__type">${escHtml(typeLabel)}</span>
        ${ICON_CHEVRON}
      </div>
      <div class="account-card__meta">
        ${a.institution ? `<span class="account-card__institution">${escHtml(a.institution)}</span>` : ""}
        ${hasPeriodTotal ? `<span class="account-card__period-total">${fmtCurrency(periodTotal)}</span>` : ""}
      </div>
      <div class="account-card__actions">
        <button class="btn btn-ghost btn-sm js-edit-account" data-id="${a.id}" title="Edit account" aria-label="Edit account">${ICON_EDIT}</button>
        <button class="btn btn-ghost btn-sm js-delete-account" data-id="${a.id}" title="Delete account" aria-label="Delete account">${ICON_DELETE}</button>
      </div>
    </li>
    <li class="account-edit-row js-acct-edit-row hidden" data-id="${a.id}">
      <form class="account-edit-form" data-id="${a.id}" novalidate>
        <div class="account-edit-fields">
          <div class="form-field">
            <label class="form-label" for="acct-edit-name-${a.id}">Name</label>
            <input id="acct-edit-name-${a.id}" class="form-input" type="text" value="${escHtml(a.name)}" required />
          </div>
          <div class="form-field">
            <label class="form-label" for="acct-edit-type-${a.id}">Type</label>
            <select id="acct-edit-type-${a.id}" class="form-input form-select">
              ${Object.entries(TYPE_LABELS).map(([v, l]) =>
                `<option value="${v}"${a.type === v ? " selected" : ""}>${l}</option>`
              ).join("")}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="acct-edit-inst-${a.id}">Institution</label>
            <input id="acct-edit-inst-${a.id}" class="form-input" type="text" value="${escHtml(a.institution || "")}" />
          </div>
        </div>
        <div class="account-edit-error js-acct-edit-error hidden"></div>
        <div class="account-form__actions">
          <button type="button" class="btn btn-ghost btn-sm js-cancel-acct-edit" data-id="${a.id}">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>
    </li>`;
}

function renderDeleteConfirm(id) {
  return `
    <li class="account-delete-confirm" data-confirm-id="${id}">
      <span class="subtle">Delete this account?</span>
      <button class="btn btn-ghost btn-sm js-cancel-acct-delete" data-id="${id}">Cancel</button>
      <button class="account-delete-confirm-btn js-confirm-acct-delete" data-id="${id}">Yes, Delete</button>
    </li>`;
}

// ── Accounts Page UI ──────────────────────────────────────────────────
export async function initAccountsPage(_uid) {
  const listEl    = document.getElementById("accountsList");
  const addForm   = document.getElementById("addAccountForm");
  const addBtn    = document.getElementById("addAccountBtn");
  const cancelBtn = document.getElementById("cancelAddAccount");
  const saveBtn   = document.getElementById("saveAccountBtn");
  const nameInput = document.getElementById("newAccountName");
  const typeInput = document.getElementById("newAccountType");
  const instInput = document.getElementById("newAccountInstitution");
  const addErrEl  = document.getElementById("addAccountError");
  const periodEl  = document.getElementById("acctBreakdownPeriod");
  const prevBtn   = document.getElementById("acctBreakdownPrev");
  const nextBtn   = document.getElementById("acctBreakdownNext");

  if (!listEl) return;

  // ── Cached data for expand ──────────────────────────────────────────
  let _lastTxns    = [];
  let _lastCatsMap = {};
  // Map of accountId -> total spent this period
  let _periodTotals = {};

  // ── Period label ────────────────────────────────────────────────────
  function updatePeriodLabel() {
    if (periodEl) periodEl.textContent = acctPeriodLabel();
  }

  // ── Fetch txns + catsMap for current period ─────────────────────────
  async function refreshData() {
    updatePeriodLabel();
    [_lastTxns, _lastCatsMap] = await Promise.all([
      fetchTxForPeriod(),
      getCategoriesMap(_uid),
    ]);
    // Build per-account totals (absolute sum of all txns regardless of type)
    _periodTotals = {};
    _lastTxns.forEach(tx => {
      const id = tx.accountId;
      if (!id) return;
      const amt = tx.amountCents !== undefined
        ? Math.abs(tx.amountCents / 100)
        : Math.abs(parseFloat(tx.amount) || 0);
      _periodTotals[id] = (_periodTotals[id] || 0) + amt;
    });
    await renderList();
  }

  prevBtn?.addEventListener("click", () => {
    acctMonth--;
    if (acctMonth < 0) { acctMonth = 11; acctYear--; }
    refreshData();
  });

  nextBtn?.addEventListener("click", () => {
    acctMonth++;
    if (acctMonth > 11) { acctMonth = 0; acctYear++; }
    refreshData();
  });

  function showAddError(msg) {
    if (!addErrEl) return;
    addErrEl.textContent = msg;
    addErrEl.classList.remove("hidden");
  }
  function clearAddError() {
    if (!addErrEl) return;
    addErrEl.textContent = "";
    addErrEl.classList.add("hidden");
  }

  async function renderList() {
    listEl.innerHTML = '<li class="accounts-loading">Loading\u2026</li>';
    try {
      const accounts = await fetchAccounts();
      updateAccountsBadge(accounts);

      if (accounts.length === 0) {
        listEl.innerHTML = `
          <li class="accounts-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <p>No accounts yet.<br/>Click <strong>Add Account</strong> to get started.</p>
          </li>`;
        return;
      }

      // Group by type
      const groups = {};
      TYPE_ORDER.forEach(t => { groups[t] = []; });
      accounts.forEach(a => {
        const key = TYPE_ORDER.includes(a.type) ? a.type : "other";
        groups[key].push(a);
      });

      let html = "";
      TYPE_ORDER.forEach(type => {
        if (groups[type].length === 0) return;
        html += `<li class="account-group-header">${escHtml(TYPE_LABELS[type])}</li>`;
        html += groups[type].map(a => renderCard(a, _periodTotals[a.id])).join("");
      });
      listEl.innerHTML = html;

      // ── Wire expand/collapse on each card ───────────────────────────
      function collapseCard(card) {
        card.classList.remove("is-expanded");
        card.setAttribute("aria-expanded", "false");
        const existing = listEl.querySelector(`.cat-breakdown__tx-list-row[data-tx-list-for="${card.dataset.id}"]`);
        if (existing) existing.remove();
      }

      listEl.querySelectorAll(".account-card--expandable").forEach(card => {
        card.addEventListener("click", e => {
          if (e.target.closest(".js-edit-account, .js-delete-account")) return;

          const isExpanded = card.classList.contains("is-expanded");

          // Collapse any other open cards
          listEl.querySelectorAll(".account-card--expandable.is-expanded").forEach(open => {
            if (open !== card) collapseCard(open);
          });

          if (isExpanded) {
            collapseCard(card);
          } else {
            card.classList.add("is-expanded");
            card.setAttribute("aria-expanded", "true");
            // Insert after the edit row if present, else after the card itself
            const editRow = listEl.querySelector(`.js-acct-edit-row[data-id="${card.dataset.id}"]`);
            const anchor  = editRow || card;
            const txListItem = buildCardTxList(card.dataset.id, _lastTxns, _lastCatsMap);
            anchor.insertAdjacentElement("afterend", txListItem);
          }
        });

        card.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") {
            if (e.target.closest(".js-edit-account, .js-delete-account")) return;
            e.preventDefault();
            card.click();
          }
        });
      });

      // ── Edit ────────────────────────────────────────────────────────
      listEl.querySelectorAll(".js-edit-account").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          listEl.querySelectorAll(".js-acct-edit-row").forEach(r => r.classList.add("hidden"));
          const row = listEl.querySelector(`.js-acct-edit-row[data-id="${id}"]`);
          if (row) { row.classList.remove("hidden"); row.querySelector(".form-input")?.focus(); }
        });
      });

      listEl.querySelectorAll(".js-cancel-acct-edit").forEach(btn => {
        btn.addEventListener("click", () => {
          listEl.querySelector(`.js-acct-edit-row[data-id="${btn.dataset.id}"]`)?.classList.add("hidden");
        });
      });

      listEl.querySelectorAll(".account-edit-form").forEach(form => {
        form.addEventListener("submit", async e => {
          e.preventDefault();
          const id   = form.dataset.id;
          const nameEl = form.querySelector(`#acct-edit-name-${id}`);
          const typeEl = form.querySelector(`#acct-edit-type-${id}`);
          const instEl = form.querySelector(`#acct-edit-inst-${id}`);
          const errEl  = form.querySelector(".js-acct-edit-error");
          const name = nameEl?.value.trim();
          if (!name) {
            if (errEl) { errEl.textContent = "Name is required."; errEl.classList.remove("hidden"); }
            nameEl?.focus();
            return;
          }
          const submitBtn = form.querySelector("[type='submit']");
          if (submitBtn) submitBtn.disabled = true;
          try {
            await updateDoc(doc(getDb(), "accounts", id), {
              name,
              type: typeEl?.value || "other",
              institution: instEl?.value.trim() || "",
              updatedAt: serverTimestamp(),
            });
            await refreshData();
          } catch (err) {
            console.error("[accounts] updateDoc error:", err);
            if (errEl) { errEl.textContent = "Save failed. Try again."; errEl.classList.remove("hidden"); }
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      });

      // ── Delete ──────────────────────────────────────────────────────
      listEl.querySelectorAll(".js-delete-account").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          listEl.querySelectorAll(`[data-confirm-id]`).forEach(r => r.remove());
          const card = listEl.querySelector(`.account-card[data-id="${id}"]`);
          if (card) card.insertAdjacentHTML("afterend", renderDeleteConfirm(id));

          listEl.querySelector(`.js-cancel-acct-delete[data-id="${id}"]`)?.addEventListener("click", () => {
            listEl.querySelector(`[data-confirm-id="${id}"]`)?.remove();
          });
          listEl.querySelector(`.js-confirm-acct-delete[data-id="${id}"]`)?.addEventListener("click", async () => {
            await deleteDoc(doc(getDb(), "accounts", id));
            await refreshData();
          });
        });
      });

    } catch (err) {
      console.error("[accounts] renderList error:", err);
      listEl.innerHTML = '<li class="accounts-empty"><p>Error loading accounts.</p></li>';
    }
  }

  // ── Add account form ────────────────────────────────────────────────
  addBtn?.addEventListener("click", () => {
    addForm?.classList.remove("hidden");
    addBtn.classList.add("hidden");
    clearAddError();
    nameInput?.focus();
  });

  cancelBtn?.addEventListener("click", () => {
    addForm?.classList.add("hidden");
    addBtn?.classList.remove("hidden");
    if (nameInput) nameInput.value = "";
    clearAddError();
  });

  saveBtn?.addEventListener("click", async () => {
    clearAddError();
    const name = nameInput?.value.trim();
    const type = typeInput?.value || "checking";
    const institution = instInput?.value.trim() || "";
    if (!name) {
      showAddError("Account name is required.");
      nameInput?.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await addDoc(accountsRef(), {
        name, type, institution,
        isActive: true,
        createdAt: serverTimestamp(),
      });
      addForm?.classList.add("hidden");
      addBtn?.classList.remove("hidden");
      if (nameInput) nameInput.value = "";
      await refreshData();
    } catch (err) {
      console.error("[accounts] addDoc error:", err);
      showAddError("Failed to save. Please try again.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Initial load
  await refreshData();
}
