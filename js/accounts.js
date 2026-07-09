/**
 * accounts.js — Firestore accounts layer + UI for the Accounts page
 *
 * Exports:
 *   seedAccountsIfEmpty(uid)           — seeds default accounts on first login (uid ignored, global collection)
 *   initAccountsPage(uid)              — wires up the #accounts page UI
 *   populateAccountSelect(uid, select) — fills a <select> with account options
 *
 * NOTE: Accounts are stored in the top-level "accounts" collection (not user-scoped).
 *       uid params are kept for API compatibility but not used in Firestore paths.
 *
 * NOTE: db is resolved lazily (on first use) via getApp() so this module can be
 *       imported before initializeApp() runs in app.js without throwing no-app.
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, updateDoc,
  deleteDoc, doc, getDoc, setDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Lazily resolved — not called until the first exported function runs,
// by which point app.js has already called initializeApp().
let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

// Increment this any time DEFAULT_ACCOUNTS changes to force a re-seed.
const SEED_VERSION = 2;

// ── Default seed data ─────────────────────────────────────────────────
const DEFAULT_ACCOUNTS = [
  { name: "Dennis Checking",             type: "checking",     institution: "" },
  { name: "Joint Bill Pay",              type: "checking",     institution: "" },
  { name: "Nicole Checking",             type: "checking",     institution: "" },
  { name: "Long Term Savings",           type: "savings",      institution: "" },
  { name: "Advantage Savings",           type: "savings",      institution: "" },
  { name: "Travel Rewards Visa Signature", type: "credit",     institution: "" },
  { name: "Mortgage",                    type: "mortgage",     institution: "" },
  { name: "Toyota",                      type: "vehicle_loan", institution: "" },
];

const TYPE_LABELS = {
  checking:     "Checking",
  savings:      "Savings",
  credit:       "Credit Card",
  investment:   "Investment",
  mortgage:     "Mortgage",
  vehicle_loan: "Vehicle Loan",
  other:        "Other",
};

// ── Helpers ───────────────────────────────────────────────────────────
function accountsRef() {
  return collection(getDb(), "accounts");
}

async function fetchAccounts() {
  const q = query(accountsRef(), orderBy("createdAt"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
      console.log("[accounts] accounts up to date (v" + currentVersion + "), skipping seed");
      return;
    }

    // Delete all existing docs (clears stale data and Firestore tombstones)
    if (!snap.empty) {
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
      console.log("[accounts] cleared " + snap.size + " existing account doc(s)");
    }

    // Re-seed with current DEFAULT_ACCOUNTS
    await Promise.all(
      DEFAULT_ACCOUNTS.map(a =>
        addDoc(accountsRef(), { ...a, isActive: true, createdAt: serverTimestamp() })
      )
    );

    // Record seed version so we don't re-seed on next load
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

  if (!listEl) return; // page not in DOM yet

  async function renderList() {
    listEl.innerHTML = '<div class="accounts-loading">Loading\u2026</div>';
    try {
      const accounts = await fetchAccounts();
      if (accounts.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p>No accounts yet.</p>
            <p>Click <strong>Add Account</strong> to get started.</p>
          </div>`;
        return;
      }
      listEl.innerHTML = accounts.map(a => `
        <div class="account-card" data-id="${a.id}">
          <div class="account-card__info">
            <span class="account-card__name">${a.name}</span>
            <span class="account-card__meta">${TYPE_LABELS[a.type] ?? a.type}${a.institution ? " \u00b7 " + a.institution : ""}</span>
          </div>
          <div class="account-card__actions">
            <button class="btn btn-ghost btn-sm js-toggle-active"
              data-id="${a.id}" data-active="${a.isActive !== false}"
              title="${a.isActive !== false ? 'Deactivate' : 'Activate'}">
              ${a.isActive !== false
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 12H7"/><path d="M12 7l-5 5 5 5"/></svg> Deactivate'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 12h10"/><path d="M12 17l5-5-5-5"/></svg> Activate'}
            </button>
            <button class="btn btn-ghost btn-sm js-delete-account" data-id="${a.id}" title="Delete account">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>
      `).join("");

      listEl.querySelectorAll(".js-toggle-active").forEach(btn => {
        btn.addEventListener("click", async () => {
          const isActive = btn.dataset.active === "true";
          await updateDoc(doc(getDb(), "accounts", btn.dataset.id), { isActive: !isActive });
          renderList();
        });
      });

      listEl.querySelectorAll(".js-delete-account").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this account? This won't delete imported transactions.")) return;
          await deleteDoc(doc(getDb(), "accounts", btn.dataset.id));
          renderList();
        });
      });
    } catch (err) {
      console.error("[accounts] renderList error:", err);
      listEl.innerHTML = '<div class="empty-state"><p>Error loading accounts. Check console for details.</p></div>';
    }
  }

  // ── Add account form ────────────────────────────────────────────────
  if (addBtn && addForm) {
    addBtn.addEventListener("click", () => {
      addForm.classList.remove("hidden");
      addBtn.classList.add("hidden");
      nameInput?.focus();
    });
  }
  if (cancelBtn && addForm) {
    cancelBtn.addEventListener("click", () => {
      addForm.classList.add("hidden");
      addBtn?.classList.remove("hidden");
      if (nameInput) nameInput.value = "";
      if (instInput) instInput.value = "";
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const name = nameInput?.value.trim();
      const type = typeInput?.value || "checking";
      const inst = instInput?.value.trim();
      if (!name) { nameInput?.focus(); return; }
      saveBtn.disabled = true;
      try {
        await addDoc(accountsRef(), {
          name,
          type,
          institution: inst || "",
          isActive: true,
          createdAt: serverTimestamp(),
        });
        addForm.classList.add("hidden");
        addBtn?.classList.remove("hidden");
        if (nameInput) nameInput.value = "";
        if (instInput) instInput.value = "";
        renderList();
      } catch (err) {
        console.error("[accounts] addDoc error:", err);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  renderList();
}
