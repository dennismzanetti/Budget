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

// Local lightweight categories map — avoids circular import with categories.js
async function fetchCategoriesMap() {
  const snap = await getDocs(query(collection(getDb(), "categories"), orderBy("name")));
  const map = {};
  snap.docs.forEach(d => {
    map[d.id] = { name: d.data().name, color: d.data().color, emoji: d.data().emoji };
  });
  return map;
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

// ── Returns a map of { accountId -> { name, type } } ─────────────────
export async function getAccountsMap(_uid) {
  const accounts = await fetchAccounts();
  const map = {};
  accounts.forEach(a => { map[a.id] = { name: a.name, type: a.type }; });
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

// ── Navigate to the categories page and expand the given category ─────
function navigateToCategory(categoryId) {
  window.location.hash = "categories";
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("expand-category", { detail: { categoryId } }));
  }, 300);
}

// ── Build expanded transaction list — same table structure as categories page ──
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
    liWrap.innerHTML = `<div class="cat-card-tx__wrapper"><div class="cat-breakdown__tx-empty">No transactions this period.</div></div>`;
    return liWrap;
  }

  const tbody = matching.map(tx => {
    const dateStr = fmtDate(tx.date);
    const amt     = parseFloat(tx.amount) || 0;
    const amtCls  = amt < 0 ? "cat-card-tx__amount--neg" : "cat-card-tx__amount--pos";
    const amtStr  = fmtCurrency(amt);
    const catName = catsMap[tx.categoryId]?.name || tx.categoryName || tx.categoryId || "—";
    const memo    = escHtml(tx.memo || tx.description || "");
    const catId   = tx.categoryId || "";

    return `
      <tr class="cat-card-tx__row" data-tx-id="${escHtml(tx.id)}">
        <td class="cat-card-tx__date">${escHtml(dateStr)}</td>
        <td class="cat-card-tx__payee">${memo || "&nbsp;"}</td>
        <td class="cat-card-tx__category${catId ? " cat-card-tx__category--link" : ""}"
            ${catId ? `data-cat-id="${escHtml(catId)}" title="Go to ${escHtml(catName)}"` : ""}
        >${escHtml(catName)}</td>
        <td class="cat-card-tx__amount ${amtCls}">${amtStr}</td>
      </tr>`;
  }).join("");

  liWrap.innerHTML = `
    <div class="cat-card-tx__wrapper">
      <table class="cat-card-tx__table">
        <thead>
          <tr>
            <th class="cat-card-tx__th">Date</th>
            <th class="cat-card-tx__th">Memo</th>
            <th class="cat-card-tx__th">Category</th>
            <th class="cat-card-tx__th cat-card-tx__th--amount">Amount</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;

  liWrap.querySelectorAll(".cat-card-tx__category--link").forEach(el => {
    el.addEventListener("click", () => navigateToCategory(el.dataset.catId));
  });

  return liWrap;
}

// ── Render account cards ──────────────────────────────────────────────
function renderAccountCards(accounts, txns, catsMap, container) {
  container.innerHTML = "";

  const groups = {};
  TYPE_ORDER.forEach(t => { groups[t] = []; });

  accounts.forEach(acct => {
    const t = acct.type || "other";
    if (!groups[t]) groups[t] = [];
    groups[t].push(acct);
  });

  TYPE_ORDER.forEach(type => {
    const list = groups[type];
    if (!list || list.length === 0) return;

    const section = document.createElement("section");
    section.className = "acct-type-section";
    section.innerHTML = `<h3 class="acct-type-heading">${escHtml(TYPE_LABELS[type] ?? type)}</h3>`;

    const ul = document.createElement("ul");
    ul.className = "cat-breakdown__list";

    list.forEach(acct => {
      const acctTxns = txns.filter(tx => tx.accountId === acct.id);
      const total = acctTxns.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
      const isAsset = ASSET_TYPES.includes(acct.type);
      const amtCls = isAsset
        ? (total >= 0 ? "tx-amount--positive" : "tx-amount--negative")
        : (total <= 0 ? "tx-amount--negative" : "tx-amount--positive");

      const li = document.createElement("li");
      li.className = "cat-breakdown__item";
      li.dataset.acctId = acct.id;
      li.innerHTML = `
        <div class="cat-breakdown__row cat-breakdown__row--clickable">
          <span class="cat-breakdown__name">${escHtml(acct.name)}</span>
          <span class="cat-breakdown__amount ${amtCls}">${fmtCurrency(total)}</span>
          <span class="cat-breakdown__toggle-icon">▶</span>
        </div>`;

      li.querySelector(".cat-breakdown__row--clickable").addEventListener("click", () => {
        const existing = ul.querySelector(`[data-tx-list-for="${acct.id}"]`);
        if (existing) {
          existing.remove();
          li.querySelector(".cat-breakdown__toggle-icon").textContent = "▶";
          return;
        }
        li.querySelector(".cat-breakdown__toggle-icon").textContent = "▼";
        const txList = buildCardTxList(acct.id, txns, catsMap);
        li.after(txList);
      });

      ul.appendChild(li);
    });

    section.appendChild(ul);
    container.appendChild(section);
  });
}

// ── Totals bar ────────────────────────────────────────────────────────
function renderTotalsBar(accounts, txns, container) {
  if (!container) return;

  const totalIncome  = txns.filter(tx => (parseFloat(tx.amount) || 0) > 0).reduce((s, tx) => s + parseFloat(tx.amount), 0);
  const totalExpense = txns.filter(tx => (parseFloat(tx.amount) || 0) < 0).reduce((s, tx) => s + parseFloat(tx.amount), 0);
  const net = totalIncome + totalExpense;
  const netCls = net >= 0 ? "tx-amount--positive" : "tx-amount--negative";

  container.innerHTML = `
    <div class="acct-totals__row">
      <span class="acct-totals__label">Income</span>
      <span class="acct-totals__amount tx-amount--positive">${fmtCurrency(totalIncome)}</span>
    </div>
    <div class="acct-totals__row">
      <span class="acct-totals__label">Expenses</span>
      <span class="acct-totals__amount tx-amount--negative">${fmtCurrency(Math.abs(totalExpense))}</span>
    </div>
    <div class="acct-totals__row acct-totals__row--net">
      <span class="acct-totals__label">Net</span>
      <span class="acct-totals__amount ${netCls}">${fmtCurrency(net)}</span>
    </div>`;
}

// ── Main page init ────────────────────────────────────────────────────
export async function initAccountsPage(uid) {
  const container   = document.getElementById("accounts-breakdown");
  const periodLabel = document.getElementById("acct-period-label");
  const prevBtn     = document.getElementById("acct-prev-month");
  const nextBtn     = document.getElementById("acct-next-month");
  const totalsBar   = document.getElementById("acct-totals-bar");

  if (!container) return;

  async function refresh() {
    if (periodLabel) periodLabel.textContent = acctPeriodLabel();
    container.innerHTML = '<div class="cat-breakdown__loading">Loading\u2026</div>';

    try {
      const [accounts, txns, catsMap] = await Promise.all([
        fetchAccounts(),
        fetchTxForPeriod(),
        fetchCategoriesMap(),
      ]);
      updateAccountsBadge(accounts);
      renderTotalsBar(accounts, txns, totalsBar);
      renderAccountCards(accounts, txns, catsMap, container);
    } catch (err) {
      console.error("[accounts] refresh error:", err);
      container.innerHTML = '<div class="cat-breakdown__error">Error loading accounts.</div>';
    }
  }

  prevBtn?.addEventListener("click", () => { acctMonth--; if (acctMonth < 0) { acctMonth = 11; acctYear--; } refresh(); });
  nextBtn?.addEventListener("click", () => { acctMonth++; if (acctMonth > 11) { acctMonth = 0; acctYear++; } refresh(); });

  await refresh();
}
