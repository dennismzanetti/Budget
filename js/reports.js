/**
 * reports.js — Reports page
 *
 * Displays:
 *   1. Period selector (last 3 / 6 / 12 months)
 *   2. KPI summary row (total income, total expenses, net savings, savings rate)
 *   3. Income vs Expense bar chart (monthly)
 *   4. Spending by Category doughnut chart
 *   5. Monthly Net Savings line chart
 *   6. Top-categories breakdown table
 *
 * Exports:
 *   initReportsPage(uid)
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getCategoriesMap } from "./categories.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

function getDateValue(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function fmt(cents) {
  return "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// Returns CSS variable value from :root
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let _chartInstances = {};

function destroyChart(key) {
  if (_chartInstances[key]) {
    _chartInstances[key].destroy();
    delete _chartInstances[key];
  }
}

export async function initReportsPage(uid) {
  const page = document.getElementById("reports");
  if (!page) return;

  // ── Period selector ────────────────────────────────────────────────
  const periodSelect = page.querySelector("#reportsPeriod");
  if (!periodSelect) return;

  periodSelect.addEventListener("change", () => loadAndRender(uid));
  await loadAndRender(uid);
}

async function loadAndRender(uid) {
  const page = document.getElementById("reports");
  const periodSelect = page.querySelector("#reportsPeriod");
  const months = parseInt(periodSelect?.value ?? "6", 10);

  // Date range: beginning of (months) ago → now
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  // Show loading state
  page.querySelector("#reportsContent")?.classList.add("reports-loading");

  try {
    // Load accounts to get all account IDs
    const accountSnap = await getDocs(collection(getDb(), "accounts"));
    const allAccountIds = accountSnap.docs.map(d => d.id);

    if (allAccountIds.length === 0) {
      renderEmpty(page, "No accounts found. Add an account to see reports.");
      return;
    }

    // Load transactions within date range
    const txnCol = collection(getDb(), "transactions");
    const IN_LIMIT = 30;
    const allTxns = [];

    for (let i = 0; i < allAccountIds.length; i += IN_LIMIT) {
      const chunk = allAccountIds.slice(i, i + IN_LIMIT);
      const q = query(txnCol, where("accountId", "in", chunk));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const t = { id: d.id, ...d.data() };
        const dt = getDateValue(t.date);
        if (dt && dt >= startDate) allTxns.push({ ...t, _date: dt });
      });
    }

    const catMap = await getCategoriesMap(uid);

    // Build month buckets
    const buckets = {}; // "YYYY-MM" -> { income: cents, expense: cents }
    for (let m = 0; m < months; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + m, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets[key] = { income: 0, expense: 0, label: monthLabel(d.getFullYear(), d.getMonth()) };
    }

    // Category spending map
    const catSpend = {}; // categoryId -> cents
    let totalIncome = 0, totalExpense = 0;

    allTxns.forEach(t => {
      const dt = t._date;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const cents = typeof t.amountCents === "number" ? t.amountCents : 0;
      if (buckets[key]) {
        if (t.type === "income") { buckets[key].income += cents; totalIncome += cents; }
        else                    { buckets[key].expense += cents; totalExpense += cents; }
      }
      if (t.type !== "income" && t.categoryId) {
        catSpend[t.categoryId] = (catSpend[t.categoryId] ?? 0) + cents;
      }
    });

    const netSavings = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.round((netSavings / totalIncome) * 100) : 0;

    // ── KPI Cards ─────────────────────────────────────────────────────
    const kpiIncome  = page.querySelector("#reportsKpiIncome");
    const kpiExpense = page.querySelector("#reportsKpiExpense");
    const kpiNet     = page.querySelector("#reportsKpiNet");
    const kpiRate    = page.querySelector("#reportsKpiRate");

    if (kpiIncome)  kpiIncome.textContent  = fmt(totalIncome);
    if (kpiExpense) kpiExpense.textContent = fmt(totalExpense);
    if (kpiNet) {
      kpiNet.textContent = (netSavings < 0 ? "-" : "+") + fmt(netSavings);
      kpiNet.className = "reports-kpi-value " + (netSavings >= 0 ? "positive" : "negative");
    }
    if (kpiRate) {
      kpiRate.textContent = savingsRate + "%";
      kpiRate.className = "reports-kpi-value " + (savingsRate >= 0 ? "positive" : "negative");
    }

    // ── Chart colours ─────────────────────────────────────────────────
    const colorIncome  = cssVar("--color-success")  || "#6daa45";
    const colorExpense = cssVar("--color-notification") || "#a13544";
    const colorPrimary = cssVar("--color-primary")  || "#01696f";
    const colorMuted   = cssVar("--color-text-muted") || "#7a7974";
    const colorSurface = cssVar("--color-surface-2") || "#fbfbf9";
    const colorBorder  = cssVar("--color-border")   || "#d4d1ca";
    const colorText    = cssVar("--color-text")      || "#28251d";

    const CAT_PALETTE = [
      cssVar("--color-primary")  || "#01696f",
      cssVar("--color-orange")   || "#da7101",
      cssVar("--color-blue")     || "#006494",
      cssVar("--color-purple")   || "#7a39bb",
      cssVar("--color-gold")     || "#d19900",
      cssVar("--color-error")    || "#a12c7b",
      cssVar("--color-success")  || "#437a22",
      cssVar("--color-warning")  || "#964219",
      cssVar("--color-notification") || "#a13544",
      colorMuted,
    ];

    const orderedKeys = Object.keys(buckets).sort();
    const labels = orderedKeys.map(k => buckets[k].label);
    const incomeData  = orderedKeys.map(k => buckets[k].income  / 100);
    const expenseData = orderedKeys.map(k => buckets[k].expense / 100);
    const netData     = orderedKeys.map(k => (buckets[k].income - buckets[k].expense) / 100);

    const chartDefaults = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colorText, font: { family: "Inter, sans-serif", size: 12 } } },
        tooltip: {
          backgroundColor: colorSurface,
          titleColor: colorText,
          bodyColor: colorMuted,
          borderColor: colorBorder,
          borderWidth: 1,
          callbacks: {
            label: ctx => " $" + Number(ctx.parsed.y ?? ctx.parsed).toLocaleString("en-US", { minimumFractionDigits: 2 })
          }
        }
      },
      scales: {
        x: { ticks: { color: colorMuted }, grid: { color: colorBorder + "44" } },
        y: {
          ticks: {
            color: colorMuted,
            callback: v => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })
          },
          grid: { color: colorBorder + "44" }
        }
      }
    };

    // ── 1. Income vs Expense Bar Chart ────────────────────────────────
    destroyChart("bar");
    const barCtx = page.querySelector("#reportsBarChart")?.getContext("2d");
    if (barCtx) {
      _chartInstances["bar"] = new Chart(barCtx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Income",  data: incomeData,  backgroundColor: colorIncome  + "cc", borderColor: colorIncome,  borderWidth: 1.5, borderRadius: 4 },
            { label: "Expense", data: expenseData, backgroundColor: colorExpense + "cc", borderColor: colorExpense, borderWidth: 1.5, borderRadius: 4 }
          ]
        },
        options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { ...chartDefaults.plugins.legend, position: "top" } } }
      });
    }

    // ── 2. Net Savings Line Chart ─────────────────────────────────────
    destroyChart("line");
    const lineCtx = page.querySelector("#reportsLineChart")?.getContext("2d");
    if (lineCtx) {
      _chartInstances["line"] = new Chart(lineCtx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Net Savings",
            data: netData,
            borderColor: colorPrimary,
            backgroundColor: colorPrimary + "22",
            borderWidth: 2.5,
            pointBackgroundColor: colorPrimary,
            pointRadius: 4,
            tension: 0.35,
            fill: true
          }]
        },
        options: {
          ...chartDefaults,
          plugins: {
            ...chartDefaults.plugins,
            tooltip: {
              ...chartDefaults.plugins.tooltip,
              callbacks: {
                label: ctx => {
                  const v = ctx.parsed.y;
                  return " " + (v < 0 ? "-" : "+") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2 });
                }
              }
            }
          }
        }
      });
    }

    // ── 3. Category Doughnut Chart ────────────────────────────────────
    destroyChart("doughnut");
    const donutCtx = page.querySelector("#reportsDoughnutChart")?.getContext("2d");
    const sortedCats = Object.entries(catSpend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (donutCtx && sortedCats.length > 0) {
      const donutLabels = sortedCats.map(([id]) => {
        const c = catMap[id];
        return c ? (c.emoji ? `${c.emoji} ${c.name}` : c.name) : id;
      });
      const donutData = sortedCats.map(([, cents]) => cents / 100);

      _chartInstances["doughnut"] = new Chart(donutCtx, {
        type: "doughnut",
        data: {
          labels: donutLabels,
          datasets: [{
            data: donutData,
            backgroundColor: CAT_PALETTE.map(c => c + "cc"),
            borderColor: CAT_PALETTE,
            borderWidth: 1.5,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "60%",
          plugins: {
            legend: { position: "right", labels: { color: colorText, font: { family: "Inter, sans-serif", size: 12 }, boxWidth: 14, padding: 12 } },
            tooltip: {
              backgroundColor: colorSurface,
              titleColor: colorText,
              bodyColor: colorMuted,
              borderColor: colorBorder,
              borderWidth: 1,
              callbacks: {
                label: ctx => {
                  const v = ctx.parsed;
                  const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                  return ` $${v.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    } else if (donutCtx) {
      // No categorised expenses
      const noDataEl = page.querySelector("#reportsDoughnutNoData");
      if (noDataEl) noDataEl.classList.remove("hidden");
    }

    // ── 4. Top Categories Table ───────────────────────────────────────
    const tbody = page.querySelector("#reportsCatTableBody");
    if (tbody) {
      if (sortedCats.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="reports-empty-row">No categorised expenses in this period.</td></tr>`;
      } else {
        const totalExpCents = sortedCats.reduce((s, [, c]) => s + c, 0);
        tbody.innerHTML = sortedCats.map(([id, cents], i) => {
          const c   = catMap[id];
          const lbl = c ? (c.emoji ? `${c.emoji} ${c.name}` : c.name) : "Uncategorised";
          const pct = totalExpCents > 0 ? Math.round((cents / totalExpCents) * 100) : 0;
          const color = CAT_PALETTE[i % CAT_PALETTE.length];
          return `
            <tr>
              <td>
                <span class="reports-cat-dot" style="background:${color}"></span>
                ${lbl}
              </td>
              <td class="reports-cat-amount">${fmt(cents)}</td>
              <td class="reports-cat-pct">
                <div class="reports-cat-bar-wrap">
                  <div class="reports-cat-bar" style="width:${pct}%;background:${color}"></div>
                </div>
                ${pct}%
              </td>
            </tr>`;
        }).join("");
      }
    }

  } catch (err) {
    console.error("[reports] loadAndRender error:", err);
    renderEmpty(page, "Error loading report data. Please try again.");
  } finally {
    page.querySelector("#reportsContent")?.classList.remove("reports-loading");
  }
}

function renderEmpty(page, msg) {
  const content = page.querySelector("#reportsContent");
  if (content) content.innerHTML = `<div class="reports-empty"><p>${msg}</p></div>`;
}
