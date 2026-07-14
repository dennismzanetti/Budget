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
  return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    liWrap.innerHTML = `<div class="cat-breakdown__tx-list cat-card-tx__wrapper"><div class="cat-breakdown__tx-empty">No transactions this period.</div></div>`;
    return liWrap;
  }

  const rows = matching.map(tx => {
    const isIncome = tx.amountCents !== undefined ? tx.type === "income" : (parseFloat(tx.amount) || 0) > 0;
    const absAmt = tx.amountCents !== undefined
      ? tx.amountCents / 100
      : Math.abs(parseFloat(tx.amount) || 0);
    const payee = tx.payee || tx.description || "\u2014";
    const catInfo = catsMap[tx.categoryId] || { name: "Uncategorized", emoji: "" };
    const catLabel = catInfo.emoji ? `${catInfo.emoji} ${catInfo.name}` : catInfo.name;
    const amtClass = isIncome ? "cat-card-tx__amount--income" : "cat-card-tx__amount--expense";
    const typeClass = isIncome ? "txn-type-badge--income" : "txn-type-badge--expense";
    const typeLabel = isIncome ? "Income" : "Expense";
    const amtSign = isIncome ? "" : "-";
    const catId = tx.categoryId || "";

    return `
      <tr class="cat-card-tx__row" data-tx-id="${escHtml(tx.id)}">
        <td class="cat-card-tx__date">${escHtml(fmtDate(tx.date))}</td>
        <td class="cat-card-tx__payee" title="${escHtml(payee)}">${escHtml(payee)}</td>
        <td class="cat-card-tx__category${catId ? " cat-card-tx__category--link" : ""}"
            ${catId ? `data-cat-id="${escHtml(catId)}" title="Go to ${escHtml(catLabel)}"` : ""}
        >${escHtml(catLabel)}</td>
        <td class="cat-card-tx__account">&nbsp;</td>
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
            <th class="cat-card-tx__th">Account</th>
            <th class="cat-card-tx__th">Type</th>
            <th class="cat-card-tx__th cat-card-tx__th--amount">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
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
    section.innerHTML = `<h3 class="acct-type-section__title">${escHtml(TYPE_LABELS[type] ?? type)}</h3>`;

    const ul = document.createElement("ul");
    ul.className = "accounts-list";

    list.forEach(acct => {
      const acctTxns = txns.filter(tx => tx.accountId === acct.id);
      let balance = 0;
      acctTxns.forEach(tx => {
        if (tx.amountCents !== undefined) {
          balance += tx.type === "income" ? tx.amountCents / 100 : -(tx.amountCents / 100);
        } else {
          balance += parseFloat(tx.amount) || 0;
        }
      });

      const isAsset = ASSET_TYPES.includes(acct.type);
      const balanceClass = isAsset
        ? (balance >= 0 ? "account-card__amount--income" : "account-card__amount--expense")
        : (balance <= 0 ? "account-card__amount--expense" : "account-card__amount--income");

      const li = document.createElement("li");
      li.className = "account-card account-card--expandable";
      li.dataset.id = acct.id;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-expanded", "false");
      li.innerHTML = `
        <svg class="cat-breakdown__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="account-card__name">${escHtml(acct.name)}</span>
        <span class="account-card__amount ${balanceClass}">${fmtCurrency(balance)}</span>
        <div class="account-card__actions">
          <button class="btn btn-ghost btn-sm js-edit-account" data-id="${escHtml(acct.id)}" title="Edit account" aria-label="Edit account">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>`;

      li.addEventListener("click", e => {
        if (e.target.closest(".js-edit-account")) return;
        const isExpanded = li.classList.contains("is-expanded");

        ul.querySelectorAll(".account-card--expandable.is-expanded").forEach(open => {
          if (open !== li) {
            open.classList.remove("is-expanded");
            open.setAttribute("aria-expanded", "false");
            const existing = ul.querySelector(`.cat-breakdown__tx-list-row[data-tx-list-for="${open.dataset.id}"]`);
            if (existing) existing.remove();
          }
        });

        if (isExpanded) {
          li.classList.remove("is-expanded");
          li.setAttribute("aria-expanded", "false");
          const existing = ul.querySelector(`.cat-breakdown__tx-list-row[data-tx-list-for="${acct.id}"]`);
          if (existing) existing.remove();
        } else {
          li.classList.add("is-expanded");
          li.setAttribute("aria-expanded", "true");
          const txListItem = buildCardTxList(acct.id, txns, catsMap);
          li.insertAdjacentElement("afterend", txListItem);
        }
      });

      li.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          if (e.target.closest(".js-edit-account")) return;
          e.preventDefault();
          li.click();
        }
      });

      ul.appendChild(li);
    });

    section.appendChild(ul);
    container.appendChild(section);
  });
}

// ── Accounts Page UI ──────────────────────────────────────────────────
export async function initAccountsPage(_uid) {
  const container = document.getElementById("accounts-breakdown");
  const periodEl  = document.getElementById("acct-period-label");
  const prevBtn   = document.getElementById("acct-prev-month");
  const nextBtn   = document.getElementById("acct-next-month");

  if (!container) return;

  async function refresh() {
    if (periodEl) periodEl.textContent = acctPeriodLabel();
    container.innerHTML = '<p class="accounts-loading">Loading\u2026</p>';
    try {
      const [accounts, txns, catsMap] = await Promise.all([
        fetchAccounts(),
        fetchTxForPeriod(),
        fetchCategoriesMap(),
      ]);
      updateAccountsBadge(accounts);
      if (accounts.length === 0) {
        container.innerHTML = `<p class="accounts-empty">No accounts found.</p>`;
        return;
      }
      renderAccountCards(accounts, txns, catsMap, container);
    } catch (err) {
      console.error("[accounts] refresh error:", err);
      container.innerHTML = '<p class="accounts-empty">Error loading accounts.</p>';
    }
  }

  prevBtn?.addEventListener("click", () => {
    acctMonth--;
    if (acctMonth < 0) { acctMonth = 11; acctYear--; }
    refresh();
  });

  nextBtn?.addEventListener("click", () => {
    acctMonth++;
    if (acctMonth > 11) { acctMonth = 0; acctYear++; }
    refresh();
  });

  // ── expand-account event: expand a specific account card ──────────────
  window.addEventListener("expand-account", e => {
    const { accountId } = e.detail || {};
    if (!accountId) return;
    let attempts = 0;
    const tryExpand = () => {
      const card = container.querySelector(`.account-card--expandable[data-id="${accountId}"]`);
      if (card) {
        if (!card.classList.contains("is-expanded")) card.click();
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (attempts++ < 10) {
        setTimeout(tryExpand, 150);
      }
    };
    tryExpand();
  });

  await refresh();
}
