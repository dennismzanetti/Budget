/**
 * dashboard.js — Dashboard page: month selector + KPI row + category donut chart
 *               + budget progress bars + recent transactions
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

/** Returns YYYY-MM for a given year+month (0-indexed month) */
function toPeriod(year, month) {
  return year + "-" + String(month + 1).padStart(2, "0");
}

/** Populate the month selector with last 12 months, default = current month */
function buildMonthOptions(selectEl) {
  const now = new Date();
  selectEl.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = toPeriod(d.getFullYear(), d.getMonth());
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }
}

/** Chart.js palette — distinct colours that work in light & dark */
const CHART_COLORS = [
  "#01696f", "#d97706", "#7c3aed", "#db2777", "#2563eb",
  "#059669", "#dc2626", "#0891b2", "#65a30d", "#9333ea",
  "#f59e0b", "#ef4444", "#06b6d4", "#84cc16", "#ec4899"
];

/** Build HTML for a single budget progress row */
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
let _chartInstance = null;

export function refreshDashboardPage() {
  if (_refresh) _refresh();
}

export async function initDashboardPage(uid) {
  _uid = uid;

  const page = document.getElementById("dashboard");
  if (!page) return;

  // Month selector
  const monthSelect = document.getElementById("dashMonthSelect");
  if (monthSelect) buildMonthOptions(monthSelect);

  // DOM refs
  const kpiIncome        = document.getElementById("dashKpiIncome");
  const kpiExpenses      = document.getElementById("dashKpiExpenses");
  const kpiNet           = document.getElementById("dashKpiNet");
  const kpiCount         = document.getElementById("dashKpiCount");
  const tbody            = document.getElementById("dashRecentTbody");
  const budgetProgressEl = document.getElementById("dashBudgetProgress");
  const chartCanvas      = document.getElementById("dashCategoryChart");
  const legendEl         = document.getElementById("dashCategoryLegend");
  const donutCenter      = document.getElementById("dashDonutCenter");

  async function load() {
    const selectedPeriod = monthSelect ? monthSelect.value : toPeriod(new Date().getFullYear(), new Date().getMonth());
    const [selYear, selMonth] = selectedPeriod.split("-").map(Number);
    const monthStart = new Date(selYear, selMonth - 1, 1);
    const monthEnd   = new Date(selYear, selMonth, 0, 23, 59, 59);

    if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-loading\">Loading\u2026</td></tr>";
    if (budgetProgressEl) budgetProgressEl.innerHTML = "<p class=\"dash-loading\">Loading\u2026</p>";
    if (legendEl) legendEl.innerHTML = "";
    if (donutCenter) donutCenter.textContent = "";

    // Load accounts
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

    // Fetch transactions
    let allTxns = [];
    try {
      const txnCol = collection(getDb(), "transactions");
      const IN_LIMIT = 30;
      for (let i = 0; i < allAccountIds.length; i += IN_LIMIT) {
        const chunk = allAccountIds.slice(i, i + IN_LIMIT);
        const q = query(txnCol, where("accountId", "in", chunk), orderBy("date", "desc"));
        const snap = await getDocs(q);
        snap.docs.forEach(d => allTxns.push({ id: d.id, ...d.data() }));
      }
    } catch (err) {
      console.error("[dashboard] load error:", err);
      if (tbody) tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-empty\">Error loading transactions.</td></tr>";
      return;
    }

    // Filter to selected month
    const monthTxns = allTxns.filter(t => {
      const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
      return !isNaN(d) && d >= monthStart && d <= monthEnd;
    });

    // KPI totals
    let incomeCents = 0, expenseCents = 0;
    monthTxns.forEach(t => {
      const cents = typeof t.amountCents === "number" ? t.amountCents : 0;
      if (t.type === "income") incomeCents  += cents;
      else                     expenseCents += cents;
    });
    const netCents = incomeCents - expenseCents;

    if (kpiIncome)   kpiIncome.textContent   = fmtDollars(incomeCents);
    if (kpiExpenses) kpiExpenses.textContent = "-" + fmtDollars(expenseCents);
    if (kpiCount)    kpiCount.textContent    = monthTxns.length.toLocaleString();
    if (kpiNet) {
      kpiNet.textContent = (netCents < 0 ? "-" : "+") + fmtDollars(netCents);
      kpiNet.className = "dash-kpi-value " + (netCents < 0 ? "dash-kpi-value--expense" : "dash-kpi-value--income");
    }

    // ── Spending by Category Donut Chart ─────────────────────────────────────
    if (chartCanvas && window.Chart) {
      // Aggregate expenses by category
      const catTotals = {};
      monthTxns.forEach(t => {
        if (t.type === "expense") {
          const cents = typeof t.amountCents === "number" ? t.amountCents : 0;
          const key   = t.categoryId || "__uncategorized__";
          catTotals[key] = (catTotals[key] || 0) + cents;
        }
      });

      const sorted = Object.entries(catTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12); // top 12 categories

      const labels = sorted.map(([id]) => {
        const cat = catMap[id];
        return cat ? (cat.emoji ? cat.emoji + " " + cat.name : cat.name) : "Other";
      });
      const dataVals = sorted.map(([, v]) => v / 100);
      const colors   = sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
      const totalExpenses = dataVals.reduce((a, b) => a + b, 0);

      // Destroy existing chart before re-rendering
      if (_chartInstance) {
        _chartInstance.destroy();
        _chartInstance = null;
      }

      if (sorted.length === 0) {
        if (legendEl) legendEl.innerHTML = "<p class=\"dash-empty\">No expense transactions for this period.</p>";
        if (donutCenter) donutCenter.textContent = "";
      } else {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        const textColor = isDark ? "#cdccca" : "#28251d";
        const mutedColor = isDark ? "#797876" : "#7a7974";

        _chartInstance = new window.Chart(chartCanvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data: dataVals,
              backgroundColor: colors,
              borderWidth: 2,
              borderColor: isDark ? "#1c1b19" : "#f9f8f5",
              hoverBorderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => {
                    const val = ctx.parsed;
                    const pct = totalExpenses > 0 ? ((val / totalExpenses) * 100).toFixed(1) : "0.0";
                    return " $" + val.toLocaleString("en-US", { minimumFractionDigits: 2 }) + " (" + pct + "%%)";
                  }
                },
                bodyColor: textColor,
                titleColor: textColor,
                backgroundColor: isDark ? "#2d2c2a" : "#ffffff",
                borderColor: isDark ? "#393836" : "#d4d1ca",
                borderWidth: 1
              }
            },
            animation: { animateRotate: true, duration: 500 }
          }
        });

        // Center label
        if (donutCenter) {
          donutCenter.innerHTML =
            '<span class="dash-donut-total">' + fmtDollars(totalExpenses * 100) + "</span>" +
            '<span class="dash-donut-label">Total Spent</span>';
        }

        // Custom legend
        if (legendEl) {
          legendEl.innerHTML = sorted.map(([id, cents], i) => {
            const cat = catMap[id];
            const name = cat ? (cat.emoji ? cat.emoji + " " + cat.name : cat.name) : "Other";
            const pct  = totalExpenses > 0 ? ((cents / 100 / totalExpenses) * 100).toFixed(1) : "0.0";
            return (
              '<div class="dash-legend-item">' +
                '<span class="dash-legend-dot" style="background:' + colors[i] + '"></span>' +
                '<span class="dash-legend-name">' + escHtml(name) + "</span>" +
                '<span class="dash-legend-pct">' + pct + "%</span>" +
              "</div>"
            );
          }).join("");
        }
      }
    }

    // ── Budget Progress Bars ──────────────────────────────────────────────────
    if (budgetProgressEl) {
      try {
        const { rows: actuals } = await buildBudgetActuals(selectedPeriod);
        const budgetRows = actuals.filter(r => r.type === "expense" && r.hasBudget);

        if (budgetRows.length === 0) {
          budgetProgressEl.innerHTML =
            "<p class=\"dash-empty\">No expense budgets set for " + escHtml(selectedPeriod) + "." +
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
    const recent = [...monthTxns]
      .sort((a, b) => {
        const da  = a.date?.toDate ? a.date.toDate() : new Date(a.date);
        const db2 = b.date?.toDate ? b.date.toDate() : new Date(b.date);
        return db2 - da;
      })
      .slice(0, 10);

    if (!tbody) return;

    if (recent.length === 0) {
      tbody.innerHTML = "<tr><td colspan=\"5\" class=\"dash-empty\">No transactions for this period.</td></tr>";
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

  // Re-load when month changes
  if (monthSelect) monthSelect.addEventListener("change", load);

  await load();
}
