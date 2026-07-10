/**
 * categories.js — Firestore categories layer + UI for the Categories page
 *
 * Categories are stored in the global top-level "categories" collection and
 * shared across all users (uid params are accepted for API compatibility but ignored).
 *
 * Exports:
 *   initCategoriesPage(uid)                        — wires up the #categories page UI
 *   populateCategorySelect(uid, selectEl, opts)     — fills a <select> with category options
 *   getCategoriesMap(uid)                           — returns { id -> { name, color } }
 *   ensureCategoryExists(uid, name)                 — finds or auto-creates a category by name
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy,
  where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

// ── Default palette for auto-created categories ───────────────────────
const AUTO_PALETTE = [
  "#4f98a3", // teal
  "#6daa45", // green
  "#da7101", // orange
  "#a86fdf", // purple
  "#d19900", // gold
  "#006494", // blue
  "#a12c7b", // pink
  "#a13544", // red
  "#964219", // brown
  "#437a22", // dark green
];

let _autoPaletteIndex = 0;
function nextAutoColor() {
  const color = AUTO_PALETTE[_autoPaletteIndex % AUTO_PALETTE.length];
  _autoPaletteIndex++;
  return color;
}

// Global categories collection — shared across all users
function categoriesRef() {
  return collection(getDb(), "categories");
}

async function fetchCategories() {
  const q = query(categoriesRef(), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Public helpers ────────────────────────────────────────────────────

/**
 * Returns a map of { categoryId -> { name, color } }.
 */
export async function getCategoriesMap(_uid) {
  const cats = await fetchCategories();
  const map = {};
  cats.forEach(c => { map[c.id] = { name: c.name, color: c.color || "#888888" }; });
  return map;
}

/**
 * Finds an existing active category by name (case-insensitive) or creates a new one.
 */
export async function ensureCategoryExists(_uid, name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const cats = await fetchCategories();
  const existing = cats.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  const ref = await addDoc(categoriesRef(), {
    name: trimmed,
    color: nextAutoColor(),
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Populates a <select> element with categories.
 */
export async function populateCategorySelect(_uid, selectEl, opts = {}) {
  if (!selectEl) return;
  const { includeBlank = true, currentId = null } = opts;
  selectEl.innerHTML = '<option value="">Loading categories\u2026</option>';
  try {
    const cats = await fetchCategories();
    const options = cats
      .filter(c => c.isActive !== false)
      .map(c => `<option value="${c.id}"${c.id === currentId ? " selected" : ""}>${escHtml(c.name)}</option>`)
      .join("");
    selectEl.innerHTML =
      (includeBlank ? '<option value="">\u2014 No category \u2014</option>' : "") + options;
  } catch (err) {
    console.error("[categories] populateCategorySelect error:", err);
    selectEl.innerHTML = '<option value="">Error loading categories</option>';
  }
}

// ── SVG icons ─────────────────────────────────────────────────────────
const ICON_EDIT   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_DELETE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICON_CHEVRON = `<svg class="cat-breakdown__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtCurrency(n) {
  return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Fetch transactions for a given period from global collection ───────
async function fetchTransactionsForPeriod(year, month) {
  // month is 0-based (JS Date)
  const start = new Date(year, month, 1);
  const end   = new Date(year, month + 1, 1);
  const txRef = collection(getDb(), "transactions");
  const q = query(
    txRef,
    where("date", ">=", Timestamp.fromDate(start)),
    where("date", "<",  Timestamp.fromDate(end))
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Donut chart instances (kept so we can destroy/recreate) ────────────
let _incomeChart   = null;
let _expenseChart  = null;

function buildDonut(canvasId, labels, data, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (canvasId === "catIncomeChart"  && _incomeChart)  { _incomeChart.destroy();  _incomeChart  = null; }
  if (canvasId === "catExpenseChart" && _expenseChart) { _expenseChart.destroy(); _expenseChart = null; }

  const isEmpty = data.length === 0 || data.every(v => v === 0);
  const chartData = isEmpty ? [1] : data;
  const chartColors = isEmpty
    ? [getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#d9e2ec"]
    : colors;

  const chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: isEmpty ? ["No data"] : labels,
      datasets: [{
        data: chartData,
        backgroundColor: chartColors,
        borderWidth: 2,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff",
        hoverOffset: isEmpty ? 0 : 6,
      }]
    },
    options: {
      cutout: "68%",
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !isEmpty,
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmtCurrency(ctx.parsed)}`
          }
        }
      },
      animation: { animateRotate: true, duration: 500 }
    }
  });

  if (canvasId === "catIncomeChart")  _incomeChart  = chart;
  if (canvasId === "catExpenseChart") _expenseChart = chart;
  return chart;
}

// ── Build expanded transactions sub-list for a category ───────────────
function buildTxList(catId, type, txns, catsMap) {
  const matching = txns.filter(tx => {
    const txCatId = tx.categoryId || "__none__";
    let isIncome;
    if (tx.amountCents !== undefined) {
      isIncome = tx.type === "income";
    } else {
      const legacy = parseFloat(tx.amount) || 0;
      isIncome = legacy > 0;
    }
    const txType = isIncome ? "income" : "expense";
    return txCatId === catId && txType === type;
  });

  // Sort by date descending
  matching.sort((a, b) => {
    const da = a.date?.toDate ? a.date.toDate() : new Date(a.date);
    const db = b.date?.toDate ? b.date.toDate() : new Date(b.date);
    return db - da;
  });

  const ul = document.createElement("ul");
  ul.className = "cat-breakdown__tx-list";

  if (matching.length === 0) {
    ul.innerHTML = `<li class="cat-breakdown__tx-empty">No transactions found.</li>`;
    return ul;
  }

  const amtClass = type === "income" ? "cat-breakdown__tx-amount--income" : "cat-breakdown__tx-amount--expense";

  matching.forEach(tx => {
    const absAmt = tx.amountCents !== undefined
      ? tx.amountCents / 100
      : Math.abs(parseFloat(tx.amount) || 0);
    const payee = tx.payee || tx.description || "";
    const li = document.createElement("li");
    li.className = "cat-breakdown__tx-item";
    li.innerHTML = `
      <span class="cat-breakdown__tx-date">${escHtml(fmtDate(tx.date))}</span>
      <span class="cat-breakdown__tx-payee" title="${escHtml(payee)}">${escHtml(payee)}</span>
      <span class="cat-breakdown__tx-amount ${amtClass}">${fmtCurrency(absAmt)}</span>`;
    ul.appendChild(li);
  });

  return ul;
}

// ── Render rows for one panel (income or expense) ─────────────────────
function renderBreakdownRows(rowsEl, totalsMap, total, chart, type, txns, catsMap) {
  rowsEl.innerHTML = "";
  if (!totalsMap || Object.keys(totalsMap).length === 0) {
    rowsEl.innerHTML = `<li class="cat-breakdown__empty">No transactions this period.</li>`;
    return;
  }

  const amtClass = type === "income" ? "cat-breakdown__row-amount--income" : "cat-breakdown__row-amount--expense";
  const sorted = Object.entries(totalsMap).sort((a, b) => b[1].amount - a[1].amount);

  sorted.forEach(([catId, entry], idx) => {
    const pct = total > 0 ? (entry.amount / total) * 100 : 0;

    // ── Row item
    const li = document.createElement("li");
    li.className = "cat-breakdown__row";
    li.dataset.index = idx;
    li.dataset.catId = catId;
    li.dataset.type  = type;
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-expanded", "false");
    li.innerHTML = `
      <span class="cat-breakdown__swatch" style="background:${escHtml(entry.color)}"></span>
      <span class="cat-breakdown__row-name" title="${escHtml(entry.name)}">${escHtml(entry.name)}</span>
      <span class="cat-breakdown__bar-wrap">
        <span class="cat-breakdown__bar" style="width:${pct.toFixed(1)}%;background:${escHtml(entry.color)}"></span>
      </span>
      <span class="cat-breakdown__row-amount ${amtClass}">${fmtCurrency(entry.amount)}</span>
      ${ICON_CHEVRON}`;

    // ── Hover: highlight chart slice
    li.addEventListener("mouseenter", () => {
      if (!li.classList.contains("is-expanded")) li.classList.add("is-highlighted");
      if (chart) {
        chart.setDatasetVisibility(0, true);
        chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 });
        chart.update();
      }
    });
    li.addEventListener("mouseleave", () => {
      li.classList.remove("is-highlighted");
      if (chart) {
        chart.tooltip.setActiveElements([], {});
        chart.update();
      }
    });

    // ── Click / keyboard: toggle expanded transactions
    function toggleExpand(e) {
      // Don't fire if clicking a child button
      if (e.target.closest("button")) return;
      const isExpanded = li.classList.contains("is-expanded");

      // Collapse any other open row in this panel
      rowsEl.querySelectorAll(".cat-breakdown__row.is-expanded").forEach(open => {
        if (open !== li) {
          open.classList.remove("is-expanded");
          open.setAttribute("aria-expanded", "false");
          open.nextElementSibling?.remove();
        }
      });

      if (isExpanded) {
        li.classList.remove("is-expanded");
        li.setAttribute("aria-expanded", "false");
        li.nextElementSibling?.remove();
      } else {
        li.classList.add("is-expanded");
        li.setAttribute("aria-expanded", "true");
        const txList = buildTxList(catId, type, txns, catsMap);
        li.insertAdjacentElement("afterend", txList);
      }
    }

    li.addEventListener("click", toggleExpand);
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(e); }
    });

    rowsEl.appendChild(li);
  });
}

// ── Main breakdown renderer ────────────────────────────────────────────
// Returns { incomeTotals, expenseTotals } so the card list can reflect period data
async function renderBreakdown(year, month, catsMap) {
  const periodEl      = document.getElementById("catBreakdownPeriod");
  const incomeTotalEl = document.getElementById("catIncomeTotalLabel");
  const expTotalEl    = document.getElementById("catExpenseTotalLabel");
  const incomeRowsEl  = document.getElementById("catIncomeRows");
  const expRowsEl     = document.getElementById("catExpenseRows");

  if (!periodEl) return { incomeTotals: {}, expenseTotals: {} };

  const monthName = new Date(year, month, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  periodEl.textContent = monthName;

  let txns;
  try {
    txns = await fetchTransactionsForPeriod(year, month);
  } catch (err) {
    console.error("[categories] breakdown fetch error:", err);
    txns = [];
  }

  // Aggregate by category
  const incomeTotals  = {}; // catId -> { name, color, amount }
  const expenseTotals = {};

  txns.forEach(tx => {
    let absAmount, isIncome;
    if (tx.amountCents !== undefined) {
      absAmount = tx.amountCents / 100;
      isIncome  = tx.type === "income";
    } else {
      const legacy = parseFloat(tx.amount) || 0;
      if (legacy === 0) return;
      absAmount = Math.abs(legacy);
      isIncome  = legacy > 0;
    }
    if (absAmount === 0) return;
    const catId   = tx.categoryId || "__none__";
    const catInfo = catsMap[catId] || { name: catId === "__none__" ? "Uncategorized" : catId, color: "#888888" };
    const bucket  = isIncome ? incomeTotals : expenseTotals;
    if (!bucket[catId]) bucket[catId] = { name: catInfo.name, color: catInfo.color, amount: 0 };
    bucket[catId].amount += absAmount;
  });

  const incomeTotal  = Object.values(incomeTotals).reduce((s, v) => s + v.amount, 0);
  const expenseTotal = Object.values(expenseTotals).reduce((s, v) => s + v.amount, 0);

  if (incomeTotalEl)  incomeTotalEl.textContent  = fmtCurrency(incomeTotal);
  if (expTotalEl)     expTotalEl.textContent      = fmtCurrency(expenseTotal);

  const incomeSorted  = Object.entries(incomeTotals).sort((a, b) => b[1].amount - a[1].amount);
  const expenseSorted = Object.entries(expenseTotals).sort((a, b) => b[1].amount - a[1].amount);

  const incomeChart  = buildDonut(
    "catIncomeChart",
    incomeSorted.map(([, v]) => v.name),
    incomeSorted.map(([, v]) => v.amount),
    incomeSorted.map(([, v]) => v.color)
  );
  const expenseChart = buildDonut(
    "catExpenseChart",
    expenseSorted.map(([, v]) => v.name),
    expenseSorted.map(([, v]) => v.amount),
    expenseSorted.map(([, v]) => v.color)
  );

  if (incomeRowsEl)  renderBreakdownRows(incomeRowsEl,  incomeTotals,  incomeTotal,  incomeChart,  "income",  txns, catsMap);
  if (expRowsEl)     renderBreakdownRows(expRowsEl,     expenseTotals, expenseTotal, expenseChart, "expense", txns, catsMap);

  return { incomeTotals, expenseTotals };
}

// ── Render a single category card (with optional period total) ────────
function renderCard(c, periodTotal, type) {
  const color = c.color || "#888888";
  const hasPeriodTotal = periodTotal !== undefined && periodTotal > 0;
  const amtClass = type === "income"
    ? "category-card__period-total--income"
    : type === "expense"
      ? "category-card__period-total--expense"
      : "";
  return `
    <li class="account-card" data-id="${c.id}">
      <div class="account-card__info">
        <span class="category-swatch" style="background:${escHtml(color)}" aria-hidden="true"></span>
        <span class="account-card__name">${escHtml(c.name)}</span>
      </div>
      <div class="account-card__meta category-card__meta">
        ${hasPeriodTotal ? `<span class="category-card__period-total ${amtClass}">${fmtCurrency(periodTotal)}</span>` : ""}
      </div>
      <div class="account-card__actions">
        <button class="btn btn-ghost btn-sm js-edit-category" data-id="${c.id}" title="Edit category">${ICON_EDIT}</button>
        <button class="btn btn-ghost btn-sm js-delete-category" data-id="${c.id}" title="Delete category">${ICON_DELETE}</button>
      </div>
    </li>
    <li class="account-edit-row js-cat-edit-row hidden" data-id="${c.id}">
      <form class="account-edit-form" data-id="${c.id}" novalidate>
        <div class="account-edit-fields">
          <div class="form-field">
            <label class="form-label" for="cat-edit-name-${c.id}">Name</label>
            <input id="cat-edit-name-${c.id}" class="form-input" type="text" value="${escHtml(c.name)}" required />
          </div>
          <div class="form-field form-field--color">
            <label class="form-label" for="cat-edit-color-${c.id}">Color</label>
            <input id="cat-edit-color-${c.id}" class="form-input form-input--color" type="color" value="${escHtml(color)}" />
          </div>
        </div>
        <div class="account-edit-error js-cat-edit-error hidden"></div>
        <div class="account-form__actions">
          <button type="button" class="btn btn-ghost btn-sm js-cancel-cat-edit" data-id="${c.id}">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Save</button>
        </div>
      </form>
    </li>`;
}

function renderDeleteConfirm(id) {
  return `
    <li class="account-delete-confirm" data-confirm-id="${id}">
      <span class="subtle">Delete this category?</span>
      <button class="btn btn-ghost btn-sm js-cancel-cat-delete" data-id="${id}">Cancel</button>
      <button class="account-delete-confirm-btn js-confirm-cat-delete" data-id="${id}">Yes, Delete</button>
    </li>`;
}

// ── Categories Page UI ────────────────────────────────────────────────
export async function initCategoriesPage(_uid) {
  const listEl    = document.getElementById("categoriesList");
  const addForm   = document.getElementById("addCategoryForm");
  const addBtn    = document.getElementById("addCategoryBtn");
  const cancelBtn = document.getElementById("cancelAddCategory");
  const saveBtn   = document.getElementById("saveCategoryBtn");
  const nameInput = document.getElementById("newCategoryName");
  const colorInput= document.getElementById("newCategoryColor");
  const addErrEl  = document.getElementById("addCategoryError");
  const prevBtn   = document.getElementById("catBreakdownPrev");
  const nextBtn   = document.getElementById("catBreakdownNext");

  if (!listEl) return;

  // ── Breakdown period state ────────────────────────────────────────
  const now = new Date();
  let breakdownYear  = now.getFullYear();
  let breakdownMonth = now.getMonth(); // 0-based

  // Holds the latest period totals so renderList can annotate cards
  let _lastIncomeTotals  = {};
  let _lastExpenseTotals = {};

  async function refreshBreakdown() {
    const catsMap = await getCategoriesMap(_uid);
    const { incomeTotals, expenseTotals } = await renderBreakdown(breakdownYear, breakdownMonth, catsMap);
    _lastIncomeTotals  = incomeTotals;
    _lastExpenseTotals = expenseTotals;
    // Re-render cards so period totals update
    renderList();
  }

  prevBtn?.addEventListener("click", () => {
    breakdownMonth--;
    if (breakdownMonth < 0) { breakdownMonth = 11; breakdownYear--; }
    refreshBreakdown();
  });

  nextBtn?.addEventListener("click", () => {
    breakdownMonth++;
    if (breakdownMonth > 11) { breakdownMonth = 0; breakdownYear++; }
    refreshBreakdown();
  });

  function showAddError(msg) {
    if (!addErrEl) return;
    addErrEl.textContent = msg;
    addErrEl.classList.remove("hidden");
  }
  function clearAddError() {
    if (!addErrEl) return;
    addErrEl.textContent = "";
    addErrEl.classList.add("hidden");
  }

  async function renderList() {
    listEl.innerHTML = '<li class="accounts-loading">Loading\u2026</li>';
    try {
      const cats = await fetchCategories();
      if (cats.length === 0) {
        listEl.innerHTML = `
          <li class="accounts-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <p>No categories yet.<br/>Click <strong>Add Category</strong> to get started.</p>
          </li>`;
        return;
      }

      // Determine type for color: expense takes priority over income
      listEl.innerHTML = cats.map(c => {
        const expTotal = _lastExpenseTotals[c.id]?.amount;
        const incTotal = _lastIncomeTotals[c.id]?.amount;
        const periodTotal = expTotal ?? incTotal;
        const type = expTotal !== undefined ? "expense" : incTotal !== undefined ? "income" : null;
        return renderCard(c, periodTotal, type);
      }).join("");

      listEl.querySelectorAll(".js-edit-category").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          listEl.querySelectorAll(".js-cat-edit-row").forEach(r => r.classList.add("hidden"));
          const row = listEl.querySelector(`.js-cat-edit-row[data-id="${id}"]`);
          if (row) { row.classList.remove("hidden"); row.querySelector(".form-input")?.focus(); }
        });
      });

      listEl.querySelectorAll(".js-cancel-cat-edit").forEach(btn => {
        btn.addEventListener("click", () => {
          listEl.querySelector(`.js-cat-edit-row[data-id="${btn.dataset.id}"]`)?.classList.add("hidden");
        });
      });

      listEl.querySelectorAll(".account-edit-form").forEach(form => {
        form.addEventListener("submit", async e => {
          e.preventDefault();
          const id = form.dataset.id;
          const nameEl  = form.querySelector(`#cat-edit-name-${id}`);
          const colorEl = form.querySelector(`#cat-edit-color-${id}`);
          const errEl   = form.querySelector(".js-cat-edit-error");
          const name = nameEl?.value.trim();
          if (!name) {
            if (errEl) { errEl.textContent = "Name is required."; errEl.classList.remove("hidden"); }
            nameEl?.focus();
            return;
          }
          const submitBtn = form.querySelector("[type='submit']");
          if (submitBtn) submitBtn.disabled = true;
          try {
            await updateDoc(doc(getDb(), "categories", id), {
              name,
              color: colorEl?.value || "#888888",
              updatedAt: serverTimestamp(),
            });
            renderList();
            refreshBreakdown();
          } catch (err) {
            console.error("[categories] updateDoc error:", err);
            if (errEl) { errEl.textContent = "Save failed. Try again."; errEl.classList.remove("hidden"); }
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      });

      listEl.querySelectorAll(".js-delete-category").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          listEl.querySelectorAll(`[data-confirm-id]`).forEach(r => r.remove());
          const card = listEl.querySelector(`.account-card[data-id="${id}"]`);
          if (card) card.insertAdjacentHTML("afterend", renderDeleteConfirm(id));

          listEl.querySelector(`.js-cancel-cat-delete[data-id="${id}"]`)?.addEventListener("click", () => {
            listEl.querySelector(`[data-confirm-id="${id}"]`)?.remove();
          });
          listEl.querySelector(`.js-confirm-cat-delete[data-id="${id}"]`)?.addEventListener("click", async () => {
            await deleteDoc(doc(getDb(), "categories", id));
            renderList();
            refreshBreakdown();
          });
        });
      });

    } catch (err) {
      console.error("[categories] renderList error:", err);
      listEl.innerHTML = '<li class="accounts-empty"><p>Error loading categories.</p></li>';
    }
  }

  addBtn?.addEventListener("click", () => {
    addForm?.classList.remove("hidden");
    addBtn.classList.add("hidden");
    clearAddError();
    nameInput?.focus();
  });

  cancelBtn?.addEventListener("click", () => {
    addForm?.classList.add("hidden");
    addBtn?.classList.remove("hidden");
    if (nameInput) nameInput.value = "";
    clearAddError();
  });

  saveBtn?.addEventListener("click", async () => {
    clearAddError();
    const name  = nameInput?.value.trim();
    const color = colorInput?.value || nextAutoColor();
    if (!name) {
      showAddError("Category name is required.");
      nameInput?.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await addDoc(categoriesRef(), {
        name, color,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      addForm?.classList.add("hidden");
      addBtn?.classList.remove("hidden");
      if (nameInput) nameInput.value = "";
      renderList();
      refreshBreakdown();
    } catch (err) {
      console.error("[categories] addDoc error:", err);
      showAddError("Failed to save. Please try again.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Initial load — breakdown first so cards have period totals on first render
  await refreshBreakdown();
}
