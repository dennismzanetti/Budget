/**
 * accounts.js — Firestore accounts layer + UI for the Accounts page
 *
 * Exports:
 *   seedAccountsIfEmpty(uid)           — seeds default accounts on first login
 *   initAccountsPage(uid)              — wires up the #accounts page UI
 *   populateAccountSelect(uid, select) — fills a <select> with account options
 *   getAccountsMap(uid)                — returns { id -> { name, type } }
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

// Asset types show amount in green; liability types in red
const ASSET_TYPES = ["checking", "savings", "investment"];

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

// ── Public map helper ─────────────────────────────────────────────────
/**
 * Returns a map of { accountId -> { name, type } }.
 * Mirrors the getCategoriesMap() pattern in categories.js.
 */
export async function getAccountsMap(_uid) {
  const accounts = await fetchAccounts();
  const map = {};
  accounts.forEach(a => {
    map[a.id] = { name: a.name, type: a.type };
  });
  return map;
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
