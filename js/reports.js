/**
 * reports.js — Reports page
 *
 * Exports:
 *   initReportsPage()    — wires up the #reports page UI (called once on login)
 *   refreshReportsPage() — re-fetches and re-renders (called on every navigation)
 *
 * Reads from root-level shared collections:
 *   transactions  — date (Timestamp), amountCents, type, categoryId, payee, isActive
 *   budgets       — period (YYYY-MM), categoryId, amountCents, type, isActive
 *   categories    — id, name
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, where, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getCategoriesMap } from "./categories.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

// ── Chart instances (kept so we can destroy before re-render) ──────────────
let _categoryChart = null;
let _incomeExpenseChart = null;

// ── Chart.js palette ───────────────────────────────────────────────────────
const PALETTE = [
  "#0f766e","#2563eb","#7c3aed","#db2777","#ea580c",
  "#ca8a04","#16a34a","#0891b2","#9333ea","#be185d",
  "#65a30d","#0284c7","#c2410c","#15803d","#1d4ed8"
];

function esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function formatCents(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatDate(val) {
  if (!val) return "";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Period helpers ─────────────────────────────────────────────────────────
function currentYYYYMM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthToRange(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 1);
  return { start, end };
}

function yearToRange(year) {
  const start = new Date(year, 0, 1);
  const end   = new Date(year + 1, 0, 1);
  return { start, end };
}

function last12Months() {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

// ── Firestore fetchers ─────────────────────────────────────────────────────
async function fetchTransactionsInRange(start, end) {
  const q = query(
    collection(getDb(), "transactions"),
    where("date", ">=", Timestamp.fromDate(start)),
    where("date", "<",  Timestamp.fromDate(end)),
    orderBy("date", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchBudgetsForPeriod(period) {
  const q = query(
    collection(getDb(), "budgets"),
    where("period", "==", period),
    where("isActive", "==", true)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Chart helpers ──────────────────────────────────────────────────────────
function destroyCharts() {
  if (_categoryChart)      { _categoryChart.destroy();      _categoryChart = null; }
  if (_incomeExpenseChart) { _incomeExpenseChart.destroy(); _incomeExpenseChart = null; }
}

function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
function chartTextColor()  { return isDark() ? "#a8b5c2" : "#5e6a77"; }
function chartGridColor()  { return isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"; }

// ── KPI strip ──────────────────────────────────────────────────────────────
function renderKPIs(txns) {
  let income = 0, expense = 0;
  txns.forEach(t => {
    if (t.type === "income")  income  += (t.amountCents ?? 0);
    if (t.type === "expense") expense += (t.amountCents ?? 0);
  });
  const net = income - expense;

  document.getElementById("rptKpiIncome").textContent  = formatCents(income);
  document.getElementById("rptKpiExpense").textContent = formatCents(expense);
  document.getElementById("rptKpiTxns").textContent    = txns.length.toLocaleString();

  const netEl = document.getElementById("rptKpiNet");
  netEl.textContent = formatCents(net);
  netEl.className = "rpt-kpi-value " + (net >= 0 ? "rpt-kpi-value--positive" : "rpt-kpi-value--negative");
}

// ── Donut chart — spending by category ────────────────────────────────────
function renderCategoryChart(txns, catMap) {
  const expenses = txns.filter(t => t.type === "expense");
  const totals = {};
  expenses.forEach(t => {
    const name = catMap[t.categoryId] ?? "Uncategorized";
    totals[name] = (totals[name] ?? 0) + (t.amountCents ?? 0);
  });

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const data   = sorted.map(([, v]) => v / 100);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);

  const ctx = document.getElementById("rptCategoryChart").getContext("2d");
  _categoryChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: isDark() ? "#1a232d" : "#fff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(ctx.parsed)}`
          }
        }
      }
    }
  });

  const legend = document.getElementById("rptCategoryLegend");
  if (labels.length === 0) {
    legend.innerHTML = `<span class="rpt-empty">No expense data for this period.</span>`;
    return;
  }
  legend.innerHTML = labels.slice(0, 10).map((lbl, i) =>
    `<span class="rpt-legend-item"><span class="rpt-legend-dot" style="background:${colors[i]}"></span>${esc(lbl)}</span>`
  ).join("");
}

// ── Bar chart — income vs expenses trend ───────────────────────────────────
function renderIncomeExpenseChart(allTxns, periodType, selectedValue) {
  let periods;
  if (periodType === "year") {
    periods = last12Months().filter(m => m.startsWith(selectedValue));
    if (periods.length === 0) periods = [`${selectedValue}-01`];
  } else {
    const [y, mo] = selectedValue.split("-").map(Number);
    periods = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, mo - 1 - i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  }

  const incomeByMonth  = {};
  const expenseByMonth = {};
  periods.forEach(p => { incomeByMonth[p] = 0; expenseByMonth[p] = 0; });

  allTxns.forEach(t => {
    const d = t.date?.toDate ? t.date.toDate() : new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!(key in incomeByMonth)) return;
    if (t.type === "income")  incomeByMonth[key]  += (t.amountCents ?? 0) / 100;
    if (t.type === "expense") expenseByMonth[key] += (t.amountCents ?? 0) / 100;
  });

  const labels = periods.map(p => {
    const [yr, mo] = p.split("-").map(Number);
    return new Date(yr, mo - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  });

  const tc = chartTextColor();
  const gc = chartGridColor();
  const ctx = document.getElementById("rptIncomeExpenseChart").getContext("2d");

  _incomeExpenseChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Income",   data: periods.map(p => incomeByMonth[p]),  backgroundColor: "#16a34a", borderRadius: 4 },
        { label: "Expenses", data: periods.map(p => expenseByMonth[p]), backgroundColor: "#dc2626", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tc, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: {
          ticks: {
            color: tc,
            callback: v => "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v)
          },
          grid: { color: gc }
        }
      }
    }
  });
}

// ── Budget vs Actual table ─────────────────────────────────────────────────
function renderBudgetVsActual(txns, budgets, catMap) {
  const tbody = document.getElementById("rptBvaBody");
  const actualByCategory = {};
  txns.filter(t => t.type === "expense").forEach(t => {
    actualByCategory[t.categoryId] = (actualByCategory[t.categoryId] ?? 0) + (t.amountCents ?? 0);
  });

  const expenseBudgets = budgets.filter(b => b.type === "expense");
  if (expenseBudgets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="rpt-empty">No expense budgets set for this period.</td></tr>`;
    return;
  }

  const rows = expenseBudgets
    .map(b => ({
      name:   catMap[b.categoryId] ?? b.categoryName ?? "Unknown",
      budget: b.amountCents ?? 0,
      actual: actualByCategory[b.categoryId] ?? 0
    }))
    .sort((a, b) => b.actual - a.actual);

  tbody.innerHTML = rows.map(r => {
    const remaining = r.budget - r.actual;
    const pct = r.budget > 0 ? Math.min((r.actual / r.budget) * 100, 100) : 0;
    const over = r.actual > r.budget;
    const warn = !over && pct >= 80;
    const barClass = over ? "rpt-progress-bar--over" : warn ? "rpt-progress-bar--warn" : "rpt-progress-bar--ok";
    const remClass = remaining >= 0 ? "rpt-amount--positive" : "rpt-amount--negative";
    return `<tr>
      <td>${esc(r.name)}</td>
      <td class="rpt-num-col">${formatCents(r.budget)}</td>
      <td class="rpt-num-col">${formatCents(r.actual)}</td>
      <td class="rpt-num-col ${remClass}">${formatCents(Math.abs(remaining))} ${remaining < 0 ? "over" : "left"}</td>
      <td class="rpt-progress-col">
        <div class="rpt-progress-bar-wrap">
          <div class="rpt-progress-bar ${barClass}" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── Top transactions table ─────────────────────────────────────────────────
function renderTopTransactions(txns, catMap) {
  const tbody = document.getElementById("rptTopTxnBody");
  const top = [...txns]
    .filter(t => t.type === "expense")
    .sort((a, b) => (b.amountCents ?? 0) - (a.amountCents ?? 0))
    .slice(0, 15);

  if (top.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="rpt-empty">No transactions for this period.</td></tr>`;
    return;
  }

  tbody.innerHTML = top.map(t => {
    const cat = catMap[t.categoryId] ?? "Uncategorized";
    return `<tr>
      <td>${esc(formatDate(t.date))}</td>
      <td>${esc(t.payee ?? "")}</td>
      <td class="rpt-hide-mobile">${esc(cat)}</td>
      <td class="rpt-num-col rpt-amount--negative">${formatCents(t.amountCents ?? 0)}</td>
    </tr>`;
  }).join("");
}

// ── Main render ────────────────────────────────────────────────────────────
async function renderReports() {
  const periodType = document.getElementById("rptPeriodType")?.value ?? "month";
  const monthInput = document.getElementById("rptMonth");
  const yearSelect = document.getElementById("rptYear");

  let start, end, budgetPeriod;
  if (periodType === "month") {
    const yyyymm = monthInput.value || currentYYYYMM();
    ({ start, end } = monthToRange(yyyymm));
    budgetPeriod = yyyymm;
  } else {
    const year = parseInt(yearSelect.value || new Date().getFullYear(), 10);
    ({ start, end } = yearToRange(year));
    budgetPeriod = null;
  }

  // Loading state
  document.getElementById("rptBvaBody").innerHTML    = `<tr><td colspan="5" class="rpt-loading">Loading&#8230;</td></tr>`;
  document.getElementById("rptTopTxnBody").innerHTML  = `<tr><td colspan="4" class="rpt-loading">Loading&#8230;</td></tr>`;
  ["rptKpiIncome","rptKpiExpense","rptKpiNet","rptKpiTxns"].forEach(id => {
    document.getElementById(id).textContent = "\u2014";
  });
  document.getElementById("rptCategoryLegend").innerHTML = "";
  destroyCharts();

  // Fetch a wider window for the trend chart (last 6 months)
  const trendStart = new Date(start);
  trendStart.setMonth(trendStart.getMonth() - 5);

  const [txns, trendTxns, budgets, catMap] = await Promise.all([
    fetchTransactionsInRange(start, end),
    periodType === "month"
      ? fetchTransactionsInRange(trendStart, end)
      : fetchTransactionsInRange(start, end),
    budgetPeriod ? fetchBudgetsForPeriod(budgetPeriod) : Promise.resolve([]),
    getCategoriesMap()
  ]);

  const selectedValue = periodType === "month"
    ? (monthInput.value || currentYYYYMM())
    : String(yearSelect.value || new Date().getFullYear());

  renderKPIs(txns);
  renderCategoryChart(txns, catMap);
  renderIncomeExpenseChart(trendTxns, periodType, selectedValue);
  renderBudgetVsActual(txns, budgets, catMap);
  renderTopTransactions(txns, catMap);
}

// ── Page init — called ONCE on login to wire up controls ──────────────────
export function initReportsPage() {
  if (typeof Chart === "undefined") {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
    script.onload = () => _initControls();
    document.head.appendChild(script);
  } else {
    _initControls();
  }
}

function _initControls() {
  const periodType = document.getElementById("rptPeriodType");
  const monthInput = document.getElementById("rptMonth");
  const yearSelect = document.getElementById("rptYear");

  if (monthInput && !monthInput.value) monthInput.value = currentYYYYMM();

  if (yearSelect && yearSelect.children.length <= 1) {
    const thisYear = new Date().getFullYear();
    for (let y = thisYear; y >= thisYear - 4; y--) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    }
  }

  periodType?.addEventListener("change", () => {
    const isYear = periodType.value === "year";
    monthInput?.classList.toggle("rpt-hidden", isYear);
    yearSelect?.classList.toggle("rpt-hidden", !isYear);
    renderReports();
  });

  monthInput?.addEventListener("change", renderReports);
  yearSelect?.addEventListener("change", renderReports);

  renderReports();
}

// ── Refresh — called on every navigation to re-fetch and re-render ─────────
export function refreshReportsPage() {
  renderReports();
}
