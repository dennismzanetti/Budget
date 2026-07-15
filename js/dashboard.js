/**
 * dashboard.js — Dashboard page: KPI row + recent transactions
 *
 * Exports:
 *   initDashboardPage(uid)
 *   refreshDashboardPage()
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, orderBy, where, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
  const d = val.toDate ? val.toDate() : new Date(val);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDollars(cents) {
  return "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let _uid = null;
let _refresh = null;

export function refreshDashboardPage() {
  if (_refresh) _refresh();
}

export async function initDashboardPage(uid) {
  _uid = uid;

  const page = document.getElementById("dashboard");
  if (!page) return;

  // DOM refs
  const kpiIncome   = document.getElementById("dashKpiIncome");
  const kpiExpenses = document.getElementById("dashKpiExpenses");
  const kpiNet      = document.getElementById("dashKpiNet");
  const kpiCount    = document.getElementById("dashKpiCount");
  const tbody       = document.getElementById("dashRecentTbody");

  async function load() {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="dash-loading">Loading\u2026</td></tr>`;

    // Load account IDs
    let allAccountIds = [];
    let accountMap = {};
    try {
      const snap = await getDocs(collection(getDb(), "accounts"));
      snap.docs.forEach(d => {
        allAccountIds.push(d.id);
        accountMap[d.id] = d.data().name ?? d.id;
      });
    } catch (e) {
      console.warn("[dashboard] could not load accounts", e);
    }

    if (allAccountIds.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="dash-empty">No accounts found.</td></tr>`;
      return;
    }

    // Category map
    let catMap = {};
    try { catMap = await getCategoriesMap(uid); } catch (e) { /* ignore */ }

    // Current month bounds
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Fetch transactions in batches of 30 (Firestore `in` limit)
    let allTxns = [];
    try {
      const txnCol = collection(getDb(), "transactions");
      const IN_LIMIT = 30;
      for (let i = 0; i < allAccountIds.length; i += IN_LIMIT) {
        const chunk = allAccountIds.slice(i, i + IN_LIMIT);
        const q = query(
          txnCol,
          where("accountId", "in", chunk),
          orderBy("date", "desc")
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => allTxns.push({ id: d.id, ...d.data() }));
      }
    } catch (err) {
      console.error("[dashboard] load error:", err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="dash-empty">Error loading transactions.</td></tr>`;
      return;
    }

    // KPI: current-month totals
    let incomeCents = 0, expenseCents = 0, monthCount = 0;
    allTxns.forEach(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      if (!isNaN(d) && d >= monthStart && d <= monthEnd) {
        monthCount++;
        const cents = typeof t.amountCents === "number" ? t.amountCents : 0;
        if (t.type === "income") incomeCents  += cents;
        else                     expenseCents += cents;
      }
    });

    const netCents = incomeCents - expenseCents;

    if (kpiIncome)   kpiIncome.textContent   = fmtDollars(incomeCents);
    if (kpiExpenses) kpiExpenses.textContent = "-" + fmtDollars(expenseCents);
    if (kpiCount)    kpiCount.textContent    = monthCount.toLocaleString();
    if (kpiNet) {
      kpiNet.textContent = (netCents < 0 ? "-" : "+") + fmtDollars(netCents);
      kpiNet.className = "dash-kpi-value " + (netCents < 0 ? "dash-kpi-value--expense" : "dash-kpi-value--income");
    }

    // Recent: latest 10 across all accounts
    const recent = [...allTxns]
      .sort((a, b) => {
        const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
        const db2 = b.date?.toDate ? b.date.toDate() : new Date(b.date);
        return db2 - da;
      })
      .slice(0, 10);

    if (!tbody) return;

    if (recent.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="dash-empty">No transactions yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = recent.map(t => {
      const isIncome = t.type === "income";
      const catObj   = catMap[t.categoryId];
      const catLabel = catObj ? (catObj.emoji ? `${catObj.emoji} ${catObj.name}` : catObj.name) : "—";
      const acctName = accountMap[t.accountId] ?? "—";
      return `<tr>
        <td class="dash-col-date">${escHtml(formatDate(t.date))}</td>
        <td class="dash-col-payee">${escHtml(t.payee ?? "—")}</td>
        <td class="dash-col-account dash-hide-mobile">${escHtml(acctName)}</td>
        <td class="dash-col-category dash-hide-mobile">${escHtml(catLabel)}</td>
        <td class="dash-col-amount dash-amount--${isIncome ? "income" : "expense"}">
          ${isIncome ? "+" : "-"}${escHtml(fmtDollars(t.amountCents))}
        </td>
      </tr>`;
    }).join("");
  }

  _refresh = load;
  await load();
}
