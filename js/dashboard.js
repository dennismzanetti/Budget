/**
 * dashboard.js — Dashboard page: KPI row + budget progress bars + recent transactions
 *
 * Exports:
 *   initDashboardPage(uid)
 *   refreshDashboardPage()
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getCategoriesMap } from "./categories.js";
import { buildBudgetActuals } from "./budgets.js";

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

function currentPeriod() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return now.getFullYear() + "-" + mm;
}

/** Build HTML for a single budget progress row — uses concatenation to avoid nested template literal issues */
function buildBudgetRow(r) {
  const pct         = Math.min(r.percentUsed, 100);
  const isOver      = r.isOverBudget;
  const isWarn      = !isOver && r.percentUsed >= 75;
  const statusClass = isOver ? "dash-bp-bar--over" : isWarn ? "dash-bp-bar--warn" : "dash-bp-bar--ok";
  const spentClass  = isOver ? "dash-bp-spent dash-bp-spent--over" : "dash-bp-spent";
  const pctClass    = isOver ? "dash-bp-pct dash-bp-pct--over" : "dash-bp-pct";
  const emoji       = r.categoryEmoji ? escHtml(r.categoryEmoji) + " " : "";
  const pctLabel    = r.percentUsed > 0 ? Math.round(r.percentUsed) + "%" : "0%";
  const widthStyle  = pct.toFixed(1) + "%";

  return (
    '<div class="dash-bp-row">' +
      '<div class="dash-bp-labels">' +
        '<span class="dash-bp-name">' + emoji + escHtml(r.categoryName) + "</span>" +
        '<span class="dash-bp-amounts">' +
          '<span class="' + spentClass + '">' + escHtml(fmtDollars(r.actualAmountCents)) + "</span>" +
          '<span class="dash-bp-sep">/</span>' +
          '<span class="dash-bp-budget">' + escHtml(fmtDollars(r.budgetAmountCents)) + "</span>" +
          '<span class="' + pctClass + '"> &middot; ' + escHtml(pctLabel) + "</span>" +
        "</span>" +
      "</div>" +
      '<div class="dash-bp-track">' +
        '<div class="dash-bp-bar ' + statusClass + '" style="width:' + widthStyle + '"></div>' +
      "</div>" +
    "</div>"
  );
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
  const kpiIncome        = document.getElementById("dashKpiIncome");
  const kpiExpenses      = document.getElementById("dashKpiExpenses");
  const kpiNet           = document.getElementById("dashKpiNet");
  const kpiCount         = document.getElementById("dashKpiCount");
  const tbody            = document.getElementById("dashRecentTbody");
  const budgetProgressEl = document.getElementById("dashBudgetProgress");

  async function load() {
    if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-loading\">Loading\u2026</td></tr>";
    if (budgetProgressEl) budgetProgressEl.innerHTML = "<p class=\"dash-loading\">Loading\u2026</p>";

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
      if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-empty\">No accounts found.</td></tr>";
      if (budgetProgressEl) budgetProgressEl.innerHTML = "<p class=\"dash-empty\">No accounts found.</p>";
      return;
    }

    // Category map
    let catMap = {};
    try { catMap = await getCategoriesMap(uid); } catch (e) { /* ignore */ }

    // Current month bounds
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const period     = currentPeriod();

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
      if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-empty\">Error loading transactions.</td></tr>";
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

    // ── Budget Progress Bars ──────────────────────────────────────────────────
    if (budgetProgressEl) {
      try {
        const actuals = await buildBudgetActuals(period);
        const budgetRows = actuals.filter(r => r.type === "expense" && r.hasBudget);

        if (budgetRows.length === 0) {
          budgetProgressEl.innerHTML =
            "<p class=\"dash-empty\">No expense budgets set for " + escHtml(period) + "." +
            " <a href=\"#budgets\" class=\"dash-view-all\" style=\"margin-left:0.4rem\">Add budgets \u2192</a></p>";
        } else {
          budgetRows.sort((a, b) => {
            if (a.isOverBudget !== b.isOverBudget) return a.isOverBudget ? -1 : 1;
            return b.percentUsed - a.percentUsed;
          });
          budgetProgressEl.innerHTML = budgetRows.map(buildBudgetRow).join("");
        }
      } catch (e) {
        console.error("[dashboard] budget progress error:", e);
        budgetProgressEl.innerHTML = "<p class=\"dash-empty\">Could not load budget data.</p>";
      }
    }

    // ── Recent Transactions ───────────────────────────────────────────────────
    const recent = [...allTxns]
      .sort((a, b) => {
        const da  = a.date?.toDate ? a.date.toDate() : new Date(a.date);
        const db2 = b.date?.toDate ? b.date.toDate() : new Date(b.date);
        return db2 - da;
      })
      .slice(0, 10);

    if (!tbody) return;

    if (recent.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-empty\">No transactions yet.</td></tr>";
      return;
    }

    tbody.innerHTML = recent.map(t => {
      const isIncome = t.type === "income";
      const catObj   = catMap[t.categoryId];
      const catLabel = catObj
        ? (catObj.emoji ? catObj.emoji + " " + catObj.name : catObj.name)
        : "\u2014";
      const acctName = accountMap[t.accountId] ?? "\u2014";
      const amtSign  = isIncome ? "+" : "-";
      const amtClass = isIncome ? "income" : "expense";
      return (
        "<tr>" +
          "<td class=\"dash-col-date\">"     + escHtml(formatDate(t.date))         + "</td>" +
          "<td class=\"dash-col-payee\">"    + escHtml(t.payee ?? "\u2014")        + "</td>" +
          "<td class=\"dash-col-account dash-hide-mobile\">" + escHtml(acctName)   + "</td>" +
          "<td class=\"dash-col-category dash-hide-mobile\">" + escHtml(catLabel)  + "</td>" +
          "<td class=\"dash-col-amount dash-amount--" + amtClass + "\">" +
            amtSign + escHtml(fmtDollars(t.amountCents)) +
          "</td>" +
        "</tr>"
      );
    }).join("");
  }

  _refresh = load;
  await load();
}
