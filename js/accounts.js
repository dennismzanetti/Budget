/**
 * accounts.js — Firestore accounts layer
 *
 * Responsibilities:
 *  1. Seed 8 default BofA accounts on first login (skips if any exist)
 *  2. Render the Accounts page with grouped account cards
 *  3. Add / Edit / Delete account UI
 *  4. Export populateAccountSelect() for use by the import page
 *
 * Firestore path: users/{uid}/accounts/{accountId}
 * Document schema:
 *   name:        string
 *   type:        'checking' | 'savings' | 'credit' | 'mortgage' | 'loan'
 *   institution: string
 *   isActive:    boolean
 *   createdAt:   Timestamp
 *   updatedAt:   Timestamp
 */

import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./app.js";

// ── Seed data ─────────────────────────────────────────────────────────────
const SEED_ACCOUNTS = [
  { name: "Dennis Checking",             type: "checking", institution: "Bank of America" },
  { name: "Joint Bill Pay Checking",     type: "checking", institution: "Bank of America" },
  { name: "Nicole Checking",             type: "checking", institution: "Bank of America" },
  { name: "Long Term Savings",           type: "savings",  institution: "Bank of America" },
  { name: "Advantage Savings",           type: "savings",  institution: "Bank of America" },
  { name: "Travel Rewards Visa Signature", type: "credit", institution: "Bank of America" },
  { name: "Mortgage",                    type: "mortgage", institution: "Bank of America" },
  { name: "Toyota",                      type: "loan",     institution: "Bank of America" },
];

const TYPE_LABELS = {
  checking: "Checking",
  savings:  "Savings",
  credit:   "Credit Card",
  mortgage: "Mortgage",
  loan:     "Loan",
};

const TYPE_ORDER = ["checking", "savings", "credit", "mortgage", "loan"];

// ── Helpers ───────────────────────────────────────────────────────────────
function accountsCol(uid) {
  return collection(db, "users", uid, "accounts");
}

/**
 * Fetch all active accounts for a user, ordered by name.
 */
async function fetchAccounts(uid) {
  const snap = await getDocs(query(accountsCol(uid), orderBy("name")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Seed (runs once) ──────────────────────────────────────────────────────
/**
 * Seeds default accounts if the user has none yet.
 * Safe to call on every login — no-ops after first run.
 */
export async function seedAccountsIfEmpty(uid) {
  const snap = await getDocs(accountsCol(uid));
  if (!snap.empty) return; // already seeded

  const writes = SEED_ACCOUNTS.map(acct =>
    addDoc(accountsCol(uid), {
      ...acct,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  await Promise.all(writes);
  console.log("[accounts] Seeded", SEED_ACCOUNTS.length, "default accounts.");
}

// ── Import-page helper ────────────────────────────────────────────────────
/**
 * Populate a <select> element with active accounts.
 * Called by bofa-import-page.js.
 */
export async function populateAccountSelect(uid, selectEl) {
  selectEl.innerHTML = '<option value="">Loading accounts…</option>';
  try {
    const accounts = await fetchAccounts(uid);
    const active = accounts.filter(a => a.isActive !== false);
    if (!active.length) {
      selectEl.innerHTML = '<option value="">No accounts found</option>';
      return;
    }
    selectEl.innerHTML = '<option value="">Select an account…</option>';
    active.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.name}${a.institution ? ` — ${a.institution}` : ''}`;
      selectEl.appendChild(opt);
    });
  } catch (e) {
    selectEl.innerHTML = '<option value="">Could not load accounts</option>';
    console.warn("[accounts] populateAccountSelect error:", e.message);
  }
}

// ── Accounts Page UI ──────────────────────────────────────────────────────

let _uid = null;

/**
 * Initialise the accounts page.
 * Call once after login with the user's UID.
 */
export function initAccountsPage(uid) {
  _uid = uid;
  renderAccountsPage();

  // Re-render when navigating to accounts tab
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#accounts") renderAccountsPage();
  });
}

async function renderAccountsPage() {
  const container = document.getElementById("accountsContent");
  if (!container) return;

  container.innerHTML = `<p class="subtle accounts-loading">Loading accounts…</p>`;

  try {
    const accounts = await fetchAccounts(_uid);
    container.innerHTML = "";

    // ── Add Account button ──
    const addBar = document.createElement("div");
    addBar.className = "accounts-toolbar";
    addBar.innerHTML = `
      <button class="btn btn-primary btn--sm" id="addAccountBtn" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Account
      </button>`;
    container.appendChild(addBar);
    document.getElementById("addAccountBtn").addEventListener("click", () => showAccountForm(container, null));

    if (!accounts.length) {
      const empty = document.createElement("div");
      empty.className = "accounts-empty";
      empty.innerHTML = `
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
        <p>No accounts yet. Click <strong>Add Account</strong> to get started.</p>`;
      container.appendChild(empty);
      return;
    }

    // ── Group by type ──
    const grouped = {};
    TYPE_ORDER.forEach(t => { grouped[t] = []; });
    accounts.forEach(a => {
      const t = a.type || "checking";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(a);
    });

    TYPE_ORDER.forEach(type => {
      const group = grouped[type];
      if (!group.length) return;

      const section = document.createElement("section");
      section.className = "accounts-group";
      section.innerHTML = `<h3 class="accounts-group-title">${TYPE_LABELS[type] || type}</h3>`;

      const list = document.createElement("ul");
      list.className = "accounts-list";
      list.setAttribute("role", "list");

      group.forEach(acct => {
        const li = document.createElement("li");
        li.className = "account-card";
        li.dataset.id = acct.id;
        li.innerHTML = `
          <div class="account-card__info">
            <span class="account-card__name">${escHtml(acct.name)}</span>
            <span class="account-card__institution subtle">${escHtml(acct.institution || "")}</span>
          </div>
          <div class="account-card__actions">
            <button class="btn btn-ghost btn--sm account-edit-btn" type="button" aria-label="Edit ${escHtml(acct.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <button class="btn btn-ghost btn--sm account-delete-btn" type="button" aria-label="Delete ${escHtml(acct.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Delete
            </button>
          </div>`;

        li.querySelector(".account-edit-btn").addEventListener("click", () => showAccountForm(container, acct));
        li.querySelector(".account-delete-btn").addEventListener("click", () => confirmDelete(acct, li));
        list.appendChild(li);
      });

      section.appendChild(list);
      container.appendChild(section);
    });

  } catch (e) {
    container.innerHTML = `<p class="subtle">Could not load accounts: ${e.message}</p>`;
    console.error("[accounts] render error:", e);
  }
}

// ── Add / Edit Form ───────────────────────────────────────────────────────

function showAccountForm(container, existingAccount) {
  // Remove any existing form
  document.getElementById("accountFormCard")?.remove();

  const isEdit = !!existingAccount;
  const card = document.createElement("div");
  card.id = "accountFormCard";
  card.className = "card account-form-card";
  card.innerHTML = `
    <h3>${isEdit ? "Edit Account" : "Add Account"}</h3>
    <div class="account-form">
      <div class="form-field">
        <label class="form-label" for="acctName">Account Name</label>
        <input class="form-input" id="acctName" type="text" placeholder="e.g. Dennis Checking" value="${escHtml(existingAccount?.name || '')}" maxlength="80" required />
      </div>
      <div class="form-field">
        <label class="form-label" for="acctType">Account Type</label>
        <select class="form-select" id="acctType">
          ${TYPE_ORDER.map(t =>
            `<option value="${t}"${existingAccount?.type === t ? " selected" : ""}>${TYPE_LABELS[t]}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label" for="acctInstitution">Institution</label>
        <input class="form-input" id="acctInstitution" type="text" placeholder="e.g. Bank of America" value="${escHtml(existingAccount?.institution || '')}" maxlength="80" />
      </div>
      <div class="account-form__error hidden" id="acctFormError" role="alert"></div>
      <div class="account-form__actions">
        <button class="btn btn-ghost btn--sm" id="acctCancelBtn" type="button">Cancel</button>
        <button class="btn btn-primary btn--sm" id="acctSaveBtn" type="button">${isEdit ? "Save Changes" : "Add Account"}</button>
      </div>
    </div>`;

  // Insert before first group or at end
  const firstGroup = container.querySelector(".accounts-group, .accounts-empty");
  if (firstGroup) container.insertBefore(card, firstGroup);
  else container.appendChild(card);

  card.querySelector("#acctName").focus();

  card.querySelector("#acctCancelBtn").addEventListener("click", () => card.remove());
  card.querySelector("#acctSaveBtn").addEventListener("click", () =>
    saveAccount(card, existingAccount?.id || null)
  );
}

async function saveAccount(card, existingId) {
  const nameEl    = card.querySelector("#acctName");
  const typeEl    = card.querySelector("#acctType");
  const instEl    = card.querySelector("#acctInstitution");
  const errEl     = card.querySelector("#acctFormError");
  const saveBtn   = card.querySelector("#acctSaveBtn");

  const name        = nameEl.value.trim();
  const type        = typeEl.value;
  const institution = instEl.value.trim();

  if (!name) {
    errEl.textContent = "Account name is required.";
    errEl.classList.remove("hidden");
    nameEl.focus();
    return;
  }

  errEl.classList.add("hidden");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    if (existingId) {
      await updateDoc(doc(db, "users", _uid, "accounts", existingId), {
        name, type, institution,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(accountsCol(_uid), {
        name, type, institution,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    card.remove();
    renderAccountsPage();
  } catch (e) {
    errEl.textContent = `Save failed: ${e.message}`;
    errEl.classList.remove("hidden");
    saveBtn.disabled = false;
    saveBtn.textContent = existingId ? "Save Changes" : "Add Account";
  }
}

// ── Delete ────────────────────────────────────────────────────────────────

function confirmDelete(acct, liEl) {
  // Inline confirm inside the card
  const existing = liEl.querySelector(".account-delete-confirm");
  if (existing) { existing.remove(); return; }

  const confirm = document.createElement("div");
  confirm.className = "account-delete-confirm";
  confirm.innerHTML = `
    <span class="subtle">Delete <strong>${escHtml(acct.name)}</strong>?</span>
    <button class="btn btn-ghost btn--sm" id="deleteCancelBtn" type="button">Cancel</button>
    <button class="btn btn--sm account-delete-confirm-btn" type="button">Delete</button>`;

  liEl.appendChild(confirm);

  confirm.querySelector("#deleteCancelBtn").addEventListener("click", () => confirm.remove());
  confirm.querySelector(".account-delete-confirm-btn").addEventListener("click", async () => {
    try {
      await deleteDoc(doc(db, "users", _uid, "accounts", acct.id));
      renderAccountsPage();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  });
}

// ── Utility ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
