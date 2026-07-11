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
  deleteDoc, doc, getDoc, setDoc, serverTimestamp, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// ── Fetch transactions for one account in the current period ──────────
async function fetchTxForAccount(accountId) {
  try {
    const txRef = collection(getDb(), "transactions");
    const start = acctPeriodStart();
    const end   = acctPeriodEnd();
    const q = query(
      txRef,
      where("accountId", "==", accountId),
      where("date", ">=", start),
      where("date", "<",  end),
      orderBy("date", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[accounts] fetchTxForAccount error:", err);
    return [];
  }
}

// ── Build expanded transaction list HTML (mirrors categories pattern) ─
async function buildCardTxList(accountId, containerEl) {
  containerEl.innerHTML = '<div class="cat-card-tx__loading">Loading\u2026</div>';
  const txs = await fetchTxForAccount(accountId);

  if (txs.length === 0) {
    containerEl.innerHTML = '<div class="cat-card-tx__empty">No transactions this period.</div>';
    return;
  }

  const rows = txs.map(tx => {
    const isExpense = tx.type === "expense";
    const amtClass  = isExpense ? "cat-card-tx__amount--expense" : "cat-card-tx__amount--income";
    const sign      = isExpense ? "\u2212" : "+";
    return `
      <div class="cat-breakdown__tx-list-row">
        <span class="cat-card-tx__date">${escHtml(fmtDate(tx.date))}</span>
        <span class="cat-card-tx__desc">${escHtml(tx.description || tx.payee || "\u2014")}</span>
        <span class="cat-card-tx__amount ${amtClass}">${sign}${fmtCurrency(tx.amount)}</span>
      </div>`;
  }).join("");

  containerEl.innerHTML = `<div class="cat-card-tx__list">${rows}</div>`;
}

// ── SVG icons ─────────────────────────────────────────────────────────
const ICON_EDIT   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_DELETE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICON_TOGGLE_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="8" cy="12" r="3" fill="currentColor"/></svg>`;
const ICON_TOGGLE_ON  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3" fill="currentColor"/></svg>`;
const ICON_CHEVRON    = `<svg class="account-card__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;

// ── Type badge HTML ───────────────────────────────────────────────────
function typeBadge(type) {
  return `<span class="account-type-badge account-type-badge--${type}">${TYPE_LABELS[type] ?? type}</span>`;
}

// ── Render a single account card (expandable) ─────────────────────────
function renderCard(a) {
  const active = a.isActive !== false;
  return `
    <li class="account-card account-card--expandable${active ? "" : " account-card--inactive"}" data-id="${a.id}" role="button" tabindex="0" aria-expanded="false">
      <div class="account-card__main">
        <div class="account-card__info">
          <span class="account-card__name">${escHtml(a.name)}</span>
          <span class="account-card__meta">
            ${typeBadge(a.type)}
            ${a.institution ? `<span class="account-card__institution">${escHtml(a.institution)}</span>` : ""}
            ${active ? "" : '<span class="account-inactive-badge">Inactive</span>'}
          </span>
        </div>
        <div class="account-card__actions">
          <button class="btn btn-ghost btn-sm js-edit-account" data-id="${a.id}" title="Edit account">${ICON_EDIT}</button>
          <button class="btn btn-ghost btn-sm js-toggle-active" data-id="${a.id}" data-active="${active}" title="${active ? "Deactivate" : "Activate"}">
            ${active ? ICON_TOGGLE_ON : ICON_TOGGLE_OFF}
          </button>
          <button class="btn btn-ghost btn-sm js-delete-account" data-id="${a.id}" title="Delete account">${ICON_DELETE}</button>
          ${ICON_CHEVRON}
        </div>
      </div>
      <div class="account-card__tx-panel" hidden></div>
    </li>
    <li class="account-edit-row js-edit-row hidden" data-id="${a.id}">
      <form class="account-edit-form" data-id="${a.id}" novalidate>
        <div class="account-edit-fields">
          <div class="form-field">
            <label class="form-label" for="edit-name-${a.id}">Name</label>
            <input id="edit-name-${a.id}" class="form-input" type="text" value="${escHtml(a.name)}" required />
          </div>
          <div class="form-field">
            <label class="form-label" for="edit-type-${a.id}">Type</label>
            <select id="edit-type-${a.id}" class="form-select">
              ${Object.entries(TYPE_LABELS).map(([v, l]) =>
                `<option value="${v}"${a.type === v ? " selected" : ""}>${l}</option>`
              ).join("")}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="edit-inst-${a.id}">Institution</label>
            <input id="edit-inst-${a.id}" class="form-input" type="text" value="${escHtml(a.institution ?? "")}" placeholder="Optional" />
          </div>
        </div>
        <div class="account-edit-error js-edit-error hidden"></div>
        <div class="account-form__actions">
          <button type="button" class="btn btn-ghost btn-sm js-cancel-edit" data-id="${a.id}">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm js-save-edit" data-id="${a.id}">Save</button>
        </div>
      </form>
    </li>`;
}

// ── Inline delete confirm row ─────────────────────────────────────────
function renderDeleteConfirm(id) {
  return `
    <li class="account-delete-confirm" data-confirm-id="${id}">
      <span class="subtle">Delete this account?</span>
      <button class="btn btn-ghost btn-sm js-cancel-delete" data-id="${id}">Cancel</button>
      <button class="account-delete-confirm-btn js-confirm-delete" data-id="${id}">Yes, Delete</button>
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

  // ── Month nav ───────────────────────────────────────────────────────
  function updatePeriodLabel() {
    if (periodEl) periodEl.textContent = acctPeriodLabel();
  }
  updatePeriodLabel();

  prevBtn?.addEventListener("click", () => {
    acctMonth--;
    if (acctMonth < 0) { acctMonth = 11; acctYear--; }
    updatePeriodLabel();
    // Collapse all open panels when month changes
    listEl.querySelectorAll(".account-card--expandable[aria-expanded='true']").forEach(card => {
      card.setAttribute("aria-expanded", "false");
      const panel = card.querySelector(".account-card__tx-panel");
      if (panel) panel.hidden = true;
    });
  });

  nextBtn?.addEventListener("click", () => {
    acctMonth++;
    if (acctMonth > 11) { acctMonth = 0; acctYear++; }
    updatePeriodLabel();
    listEl.querySelectorAll(".account-card--expandable[aria-expanded='true']").forEach(card => {
      card.setAttribute("aria-expanded", "false");
      const panel = card.querySelector(".account-card__tx-panel");
      if (panel) panel.hidden = true;
    });
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

  // ── Toggle expand on a card ─────────────────────────────────────────
  function wireExpandToggle(card) {
    const accountId = card.dataset.id;
    const panel = card.querySelector(".account-card__tx-panel");
    let loaded = false;

    function toggle(e) {
      // Don't expand when clicking action buttons
      if (e.target.closest(".account-card__actions button")) return;
      const expanded = card.getAttribute("aria-expanded") === "true";
      if (expanded) {
        card.setAttribute("aria-expanded", "false");
        panel.hidden = true;
      } else {
        card.setAttribute("aria-expanded", "true");
        panel.hidden = false;
        if (!loaded) {
          loaded = true;
          buildCardTxList(accountId, panel);
        } else {
          // Reload for current period (month may have changed)
          buildCardTxList(accountId, panel);
        }
      }
    }

    card.addEventListener("click", toggle);
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); }
    });
  }

  async function renderList() {
    listEl.innerHTML = '<li class="accounts-loading">Loading\u2026</li>';
    try {
      const accounts = await fetchAccounts();
      updateAccountsBadge(accounts);

      if (accounts.length === 0) {
        listEl.innerHTML = `
          <li class="accounts-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            <p>No accounts yet.<br/>Click <strong>Add Account</strong> to get started.</p>
          </li>`;
        return;
      }

      // Group by type
      const groups = {};
      accounts.forEach(a => {
        const key = TYPE_ORDER.includes(a.type) ? a.type : "other";
        if (!groups[key]) groups[key] = [];
        groups[key].push(a);
      });

      let html = "";
      TYPE_ORDER.forEach(type => {
        if (!groups[type] || groups[type].length === 0) return;
        html += `<li class="accounts-group-header"><span class="accounts-group-title">${TYPE_LABELS[type]}</span></li>`;
        groups[type].forEach(a => { html += renderCard(a); });
      });

      listEl.innerHTML = html;

      // Wire expand toggles
      listEl.querySelectorAll(".account-card--expandable").forEach(wireExpandToggle);

      // ── Edit ──────────────────────────────────────────────────────────
      listEl.querySelectorAll(".js-edit-account").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const id = btn.dataset.id;
          listEl.querySelectorAll(".js-edit-row").forEach(r => r.classList.add("hidden"));
          const row = listEl.querySelector(`.js-edit-row[data-id="${id}"]`);
          if (row) {
            row.classList.remove("hidden");
            row.querySelector(".form-input")?.focus();
          }
        });
      });

      listEl.querySelectorAll(".js-cancel-edit").forEach(btn => {
        btn.addEventListener("click", () => {
          const row = listEl.querySelector(`.js-edit-row[data-id="${btn.dataset.id}"]`);
          if (row) row.classList.add("hidden");
        });
      });

      listEl.querySelectorAll(".account-edit-form").forEach(form => {
        form.addEventListener("submit", async e => {
          e.preventDefault();
          const id = form.dataset.id;
          const nameEl = form.querySelector(`#edit-name-${id}`);
          const typeEl = form.querySelector(`#edit-type-${id}`);
          const instEl = form.querySelector(`#edit-inst-${id}`);
          const errEl  = form.querySelector(".js-edit-error");
          const name = nameEl?.value.trim();
          if (!name) {
            if (errEl) { errEl.textContent = "Name is required."; errEl.classList.remove("hidden"); }
            nameEl?.focus();
            return;
          }
          const sb = form.querySelector(".js-save-edit");
          if (sb) sb.disabled = true;
          try {
            await updateDoc(doc(getDb(), "accounts", id), {
              name,
              type: typeEl?.value || "checking",
              institution: instEl?.value.trim() || "",
            });
            renderList();
          } catch (err) {
            console.error("[accounts] updateDoc error:", err);
            if (errEl) { errEl.textContent = "Save failed. Try again."; errEl.classList.remove("hidden"); }
            if (sb) sb.disabled = false;
          }
        });
      });

      // ── Toggle active ──────────────────────────────────────────────────
      listEl.querySelectorAll(".js-toggle-active").forEach(btn => {
        btn.addEventListener("click", async e => {
          e.stopPropagation();
          const isActive = btn.dataset.active === "true";
          await updateDoc(doc(getDb(), "accounts", btn.dataset.id), { isActive: !isActive });
          renderList();
        });
      });

      // ── Delete (inline confirm) ────────────────────────────────────────
      listEl.querySelectorAll(".js-delete-account").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const id = btn.dataset.id;
          listEl.querySelectorAll(`[data-confirm-id]`).forEach(r => r.remove());
          const card = listEl.querySelector(`.account-card[data-id="${id}"]`);
          if (card) card.insertAdjacentHTML("afterend", renderDeleteConfirm(id));

          listEl.querySelector(`.js-cancel-delete[data-id="${id}"]`)?.addEventListener("click", () => {
            listEl.querySelector(`[data-confirm-id="${id}"]`)?.remove();
          });
          listEl.querySelector(`.js-confirm-delete[data-id="${id}"]`)?.addEventListener("click", async () => {
            await deleteDoc(doc(getDb(), "accounts", id));
            renderList();
          });
        });
      });

    } catch (err) {
      console.error("[accounts] renderList error:", err);
      listEl.innerHTML = '<li class="accounts-empty"><p>Error loading accounts.</p></li>';
    }
  }

  // ── Add account form ──────────────────────────────────────────────────
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
    if (instInput) instInput.value = "";
    clearAddError();
  });

  saveBtn?.addEventListener("click", async () => {
    clearAddError();
    const name = nameInput?.value.trim();
    const type = typeInput?.value || "checking";
    const inst = instInput?.value.trim();
    if (!name) {
      showAddError("Account name is required.");
      nameInput?.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await addDoc(accountsRef(), {
        name, type, institution: inst || "",
        isActive: true, createdAt: serverTimestamp(),
      });
      addForm?.classList.add("hidden");
      addBtn?.classList.remove("hidden");
      if (nameInput) nameInput.value = "";
      if (instInput) instInput.value = "";
      renderList();
    } catch (err) {
      console.error("[accounts] addDoc error:", err);
      showAddError("Failed to save. Please try again.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  renderList();
}
