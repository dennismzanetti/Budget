/**
 * budgets.js — Firestore budgets layer + Budget page UI
 *
 * Budget schema:
 * {
 *   categoryId: string,
 *   categoryName: string,
 *   period: "YYYY-MM",
 *   amountCents: number,
 *   type: "expense" | "income",
 *   isActive: boolean,
 *   createdAt: Timestamp,
 *   updatedAt: Timestamp
 * }
 */

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { getCategoriesMap } from "./categories.js";

let _db = null;
function getDb() {
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

function fmt(cents) {
  const n = typeof cents === "number" ? cents : parseInt(cents, 10);
  if (isNaN(n)) return "$0.00";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function budgetsRef()      { return collection(getDb(), "budgets"); }
function transactionsRef() { return collection(getDb(), "transactions"); }

function parsePeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Invalid period "${period}".`);
  const [y, m] = period.split("-").map(Number);
  if (m < 1 || m > 12) throw new Error(`Invalid month in period "${period}".`);
  return { year: y, monthIndex: m - 1 };
}

function periodToRange(period) {
  const { year, monthIndex } = parsePeriod(period);
  const start = new Date(year, monthIndex, 1);
  const end   = new Date(year, monthIndex + 1, 1);
  return { startTs: Timestamp.fromDate(start), endTs: Timestamp.fromDate(end) };
}

function makeBudgetKey(categoryId, period, type) {
  return `${categoryId}__${period}__${type}`;
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Firestore read/write ──────────────────────────────────────────────────────

export async function fetchBudgetsForPeriod(period) {
  const q = query(budgetsRef(), where("period", "==", period), orderBy("categoryName"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchTransactionsForBudgetPeriod(period) {
  const { startTs, endTs } = periodToRange(period);
  const q = query(transactionsRef(), where("date", ">=", startTs), where("date", "<", endTs));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function findExistingBudget(categoryId, period, type) {
  const q = query(budgetsRef(),
    where("categoryId", "==", categoryId),
    where("period",     "==", period),
    where("type",       "==", type)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const first = snap.docs[0];
  return { id: first.id, ...first.data() };
}

export async function saveBudget(input) {
  const { id = null, categoryId, categoryName, period, amountCents, type = "expense", isActive = true } = input || {};
  if (!categoryId) throw new Error("categoryId is required.");
  if (!categoryName?.trim()) throw new Error("categoryName is required.");
  if (type !== "expense" && type !== "income") throw new Error('type must be "expense" or "income".');
  const normalizedCents = Math.round(Math.max(0, Number(amountCents)));
  if (!Number.isFinite(normalizedCents)) throw new Error("amountCents must be a non-negative number.");
  parsePeriod(period);

  const payload = {
    categoryId,
    categoryName: String(categoryName).trim(),
    period,
    amountCents: normalizedCents,
    type,
    isActive: isActive !== false,
    updatedAt: serverTimestamp()
  };

  const db = getDb();
  if (id) { await updateDoc(doc(db, "budgets", id), payload); return id; }

  const existing = await findExistingBudget(categoryId, period, type);
  if (existing) { await updateDoc(doc(db, "budgets", existing.id), payload); return existing.id; }

  const ref = await addDoc(budgetsRef(), { ...payload, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteBudgetById(id) {
  if (!id) throw new Error("Budget id is required.");
  await deleteDoc(doc(getDb(), "budgets", id));
}

export async function copyBudgets(fromPeriod, toPeriod) {
  if (fromPeriod === toPeriod) return { copied: 0 };
  const source = await fetchBudgetsForPeriod(fromPeriod);
  let copied = 0;
  for (const b of source) {
    await saveBudget({ categoryId: b.categoryId, categoryName: b.categoryName, period: toPeriod, amountCents: b.amountCents, type: b.type, isActive: b.isActive !== false });
    copied++;
  }
  return { copied };
}

// ── Data builders ─────────────────────────────────────────────────────────────

export async function buildBudgetActuals(period) {
  const [catMap, budgets, txns] = await Promise.all([
    getCategoriesMap(null),
    fetchBudgetsForPeriod(period),
    fetchTransactionsForBudgetPeriod(period)
  ]);

  const categories = Object.entries(catMap).map(([id, cat]) => ({
    id, name: cat.name, color: cat.color || "#888888", emoji: cat.emoji || ""
  }));

  const budgetByKey = new Map();
  budgets.forEach(b => budgetByKey.set(makeBudgetKey(b.categoryId, b.period, b.type), b));

  const actualsByKey = new Map();
  txns.forEach(tx => {
    if (tx.isActive === false || !tx.categoryId || typeof tx.amountCents !== "number") return;
    const type = tx.type === "income" ? "income" : "expense";
    const amt  = Math.abs(tx.amountCents);
    if (amt === 0) return;
    const key = makeBudgetKey(tx.categoryId, period, type);
    actualsByKey.set(key, (actualsByKey.get(key) || 0) + amt);
  });

  const rows = [];
  categories.forEach(cat => {
    ["expense", "income"].forEach(type => {
      const key    = makeBudgetKey(cat.id, period, type);
      const budget = budgetByKey.get(key);
      const budgetCents = budget?.amountCents || 0;
      const actualCents = actualsByKey.get(key) || 0;
      rows.push({
        key,
        budgetId:        budget?.id || null,
        categoryId:      cat.id,
        categoryName:    cat.name,
        categoryColor:   cat.color,
        categoryEmoji:   cat.emoji,
        period, type,
        budgetAmountCents: budgetCents,
        actualAmountCents: actualCents,
        varianceCents:     budgetCents - actualCents,
        percentUsed:       budgetCents > 0 ? (actualCents / budgetCents) * 100 : 0,
        hasBudget:         !!budget,
        isOverBudget:      type === "expense" && actualCents > budgetCents && budgetCents > 0
      });
    });
  });

  rows.sort((a, b) => a.type !== b.type ? a.type.localeCompare(b.type) : a.categoryName.localeCompare(b.categoryName));

  const summary = rows.reduce((acc, r) => {
    if (r.type === "expense") {
      acc.expenseBudgetCents += r.budgetAmountCents;
      acc.expenseActualCents += r.actualAmountCents;
    } else {
      acc.incomeBudgetCents += r.budgetAmountCents;
      acc.incomeActualCents += r.actualAmountCents;
    }
    return acc;
  }, { period, expenseBudgetCents: 0, expenseActualCents: 0, incomeBudgetCents: 0, incomeActualCents: 0 });

  return { period, rows, summary };
}

export async function buildBudgetEditorRows(period) {
  const [catMap, budgets] = await Promise.all([getCategoriesMap(null), fetchBudgetsForPeriod(period)]);
  const categories = Object.entries(catMap).map(([id, cat]) => ({ id, name: cat.name, color: cat.color || "#888888", emoji: cat.emoji || "" }));
  const budgetByKey = new Map();
  budgets.forEach(b => budgetByKey.set(makeBudgetKey(b.categoryId, b.period, b.type), b));
  return categories.map(cat => {
    const exp = budgetByKey.get(makeBudgetKey(cat.id, period, "expense"));
    const inc = budgetByKey.get(makeBudgetKey(cat.id, period, "income"));
    return { categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color, categoryEmoji: cat.emoji,
      expenseBudgetId: exp?.id || null, expenseAmountCents: exp?.amountCents || 0,
      incomeBudgetId:  inc?.id || null, incomeAmountCents:  inc?.amountCents || 0 };
  }).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

// ── Page state ────────────────────────────────────────────────────────────────
let _pageInitialized = false;
let _currentPeriod   = null;
let _showZeros       = false;
let _lastData        = null;

function getPeriod() {
  return document.getElementById("budget-period")?.value || null;
}

// ── Stat card helpers ─────────────────────────────────────────────────────────

function updateStatCards(summary) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("bgt-stat-income-budget",  fmt(summary.incomeBudgetCents));
  set("bgt-stat-income-actual",  fmt(summary.incomeActualCents));
  set("bgt-stat-expense-budget", fmt(summary.expenseBudgetCents));
  set("bgt-stat-expense-actual", fmt(summary.expenseActualCents));
}

// ── Table renderers ───────────────────────────────────────────────────────────

function buildProgressCell(row) {
  const pct = Math.min(row.percentUsed, 150);
  const fillClass = row.budgetAmountCents === 0
    ? "bgt-progress-fill--none"
    : row.type === "income"
      ? "bgt-progress-fill--income"
      : row.isOverBudget
        ? "bgt-progress-fill--over"
        : "bgt-progress-fill--under";
  const displayPct = row.budgetAmountCents === 0
    ? (row.actualAmountCents > 0 ? "no budget" : "")
    : row.percentUsed.toFixed(0) + "%";
  return `
    <div class="bgt-progress-cell">
      <div class="bgt-progress-track">
        <div class="bgt-progress-fill ${fillClass}" style="width:${Math.min(pct, 100)}%"></div>
      </div>
      <span class="bgt-progress-pct">${displayPct}</span>
    </div>`;
}

function buildVarianceCell(row) {
  if (row.budgetAmountCents === 0 && row.actualAmountCents === 0) return `<span class="bgt-value-neutral">—</span>`;
  if (row.budgetAmountCents === 0) return `<span class="bgt-value-neutral">—</span>`;
  const cls = row.varianceCents >= 0 ? "bgt-value-positive" : "bgt-value-negative";
  return `<span class="${cls}">${fmt(row.varianceCents)}</span>`;
}

function buildBudgetCell(row) {
  return `<span class="bgt-budget-display"
    data-category-id="${row.categoryId}"
    data-category-name="${escHtml(row.categoryName)}"
    data-type="${row.type}"
    data-budget-id="${row.budgetId || ''}"
    tabindex="0"
    title="Click to edit">${fmt(row.budgetAmountCents)}</span>`;
}

function isZeroRow(row) {
  return row.budgetAmountCents === 0 && row.actualAmountCents === 0;
}

function renderTable(data) {
  _lastData = data;
  const { rows, summary } = data;
  updateStatCards(summary);

  const tbody = document.getElementById("bgt-tbody");
  if (!tbody) return;

  const groups = [
    { type: "expense", label: "Expenses", cls: "bgt-group-header--expense" },
    { type: "income",  label: "Income",   cls: "bgt-group-header--income"  }
  ];

  let html = "";
  groups.forEach(({ type, label, cls }) => {
    const groupRows = rows.filter(r => r.type === type);
    html += `<tr class="bgt-group-header ${cls}"><td colspan="5">${label}</td></tr>`;
    groupRows.forEach(row => {
      const hidden = (!_showZeros && isZeroRow(row)) ? " is-hidden" : "";
      const dot    = row.categoryColor ? `<span class="bgt-cat-dot" style="background:${row.categoryColor}"></span>` : "";
      html += `<tr class="bgt-row${hidden}" data-category-id="${row.categoryId}" data-type="${row.type}">
        <td><div class="bgt-cell-category">${dot}${escHtml(row.categoryEmoji)} ${escHtml(row.categoryName)}</div></td>
        <td class="bgt-col-budget">${buildBudgetCell(row)}</td>
        <td class="bgt-col-actual">${fmt(row.actualAmountCents)}</td>
        <td class="bgt-col-variance">${buildVarianceCell(row)}</td>
        <td class="bgt-col-progress">${buildProgressCell(row)}</td>
      </tr>`;
    });
  });

  tbody.innerHTML = html;
}

// ── Inline editing (click a single cell in the table) ─────────────────────────

function activateInlineEdit(display) {
  const container = display.closest("td");
  if (!container) return;

  const categoryId   = display.dataset.categoryId;
  const categoryName = display.dataset.categoryName;
  const type         = display.dataset.type;
  const budgetId     = display.dataset.budgetId || null;
  const currentCents = _lastData?.rows.find(r => r.categoryId === categoryId && r.type === type)?.budgetAmountCents || 0;
  const dollars      = (currentCents / 100).toFixed(2);

  const inp = document.createElement("input");
  inp.type  = "number";
  inp.min   = "0";
  inp.step  = "0.01";
  inp.className = "bgt-budget-input is-active";
  inp.dataset.categoryId   = categoryId;
  inp.dataset.categoryName = categoryName;
  inp.dataset.type         = type;
  inp.dataset.budgetId     = budgetId || "";
  inp.value = dollars;

  display.classList.add("is-editing");
  container.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = () => commitInlineSave(inp, display);
  inp.addEventListener("blur",    commit, { once: true });
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter")  inp.blur();
    if (e.key === "Escape") { inp.remove(); display.classList.remove("is-editing"); }
  });
}

async function commitInlineSave(input, displayEl) {
  const categoryId   = input.dataset.categoryId;
  const categoryName = input.dataset.categoryName;
  const type         = input.dataset.type;
  const amountCents  = Math.round((parseFloat(input.value || "0") || 0) * 100);
  const period       = getPeriod();
  if (!period || !categoryId) return;

  try {
    await saveBudget({ categoryId, categoryName, period, amountCents, type });
    await loadAndRender();
  } catch (err) {
    console.error("[budgets] inline save error", err);
    if (displayEl) { displayEl.classList.remove("is-editing"); input.remove(); }
  }
}

// ── Edit Budgets Modal ────────────────────────────────────────────────────────

function formatPeriodLabel(period) {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

async function openBudgetModal() {
  const period = getPeriod();
  if (!period) return;

  const backdrop = document.getElementById("bgt-modal-backdrop");
  const body     = document.getElementById("bgt-modal-body");
  const periodEl = document.getElementById("bgt-modal-period");
  const saveBtn  = document.getElementById("bgt-modal-save");
  const statusEl = document.getElementById("bgt-modal-save-status");
  if (!backdrop || !body) return;

  // Update title period label
  if (periodEl) periodEl.textContent = formatPeriodLabel(period);
  if (statusEl) statusEl.textContent = "";
  if (saveBtn)  { saveBtn.disabled = false; saveBtn.textContent = "Save All"; }

  // Show modal with loading state
  body.innerHTML = `<div class="bgt-modal-loading">Loading categories…</div>`;
  backdrop.classList.add("is-open");
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("bgt-modal-open");

  // Load editor rows
  try {
    const editorRows = await buildBudgetEditorRows(period);
    renderModalRows(editorRows, body);
    // Focus first expense input
    body.querySelector(".bgt-modal-input")?.focus();
  } catch (err) {
    console.error("[budgets] modal load error", err);
    body.innerHTML = `<div class="bgt-modal-loading bgt-modal-error">Error loading categories: ${escHtml(err.message)}</div>`;
  }
}

function renderModalRows(editorRows, body) {
  // Split into categories that have any budget set vs those that don't
  // Render all in alpha order, no split — simpler for bulk entry
  let html = `
    <div class="bgt-modal-group-header bgt-modal-group--expense">Expense Budgets</div>
  `;
  editorRows.forEach(row => {
    const dot = row.categoryColor
      ? `<span class="bgt-cat-dot" style="background:${row.categoryColor}"></span>`
      : "";
    const expVal = row.expenseAmountCents > 0 ? (row.expenseAmountCents / 100).toFixed(2) : "";
    const incVal = row.incomeAmountCents  > 0 ? (row.incomeAmountCents  / 100).toFixed(2) : "";
    html += `
      <div class="bgt-modal-row" data-category-id="${row.categoryId}" data-category-name="${escHtml(row.categoryName)}">
        <div class="bgt-modal-row-cat">
          ${dot}
          <span class="bgt-modal-row-emoji">${escHtml(row.categoryEmoji)}</span>
          <span class="bgt-modal-row-name">${escHtml(row.categoryName)}</span>
        </div>
        <div class="bgt-modal-row-inputs">
          <div class="bgt-modal-input-wrap">
            <span class="bgt-modal-currency">$</span>
            <input
              class="bgt-modal-input"
              type="number" min="0" step="0.01"
              placeholder="0.00"
              data-type="expense"
              data-category-id="${row.categoryId}"
              data-category-name="${escHtml(row.categoryName)}"
              value="${expVal}"
              aria-label="Expense budget for ${escHtml(row.categoryName)}"
            />
          </div>
          <div class="bgt-modal-input-wrap">
            <span class="bgt-modal-currency">$</span>
            <input
              class="bgt-modal-input bgt-modal-input--income"
              type="number" min="0" step="0.01"
              placeholder="0.00"
              data-type="income"
              data-category-id="${row.categoryId}"
              data-category-name="${escHtml(row.categoryName)}"
              value="${incVal}"
              aria-label="Income budget for ${escHtml(row.categoryName)}"
            />
          </div>
        </div>
      </div>
    `;
  });
  body.innerHTML = html;
}

function closeBudgetModal() {
  const backdrop = document.getElementById("bgt-modal-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  backdrop.setAttribute("aria-hidden", "true");
  document.body.classList.remove("bgt-modal-open");
}

async function handleModalSave() {
  const period  = getPeriod();
  if (!period) return;

  const saveBtn  = document.getElementById("bgt-modal-save");
  const statusEl = document.getElementById("bgt-modal-save-status");
  const inputs   = document.querySelectorAll("#bgt-modal-body .bgt-modal-input");

  if (saveBtn)  { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "bgt-modal-save-status"; }

  const saves = [];
  inputs.forEach(inp => {
    const raw = inp.value.trim();
    // Only save rows where user entered a value (including 0 to clear a budget)
    if (raw === "") return;
    const amountCents  = Math.round((parseFloat(raw) || 0) * 100);
    const categoryId   = inp.dataset.categoryId;
    const categoryName = inp.dataset.categoryName;
    const type         = inp.dataset.type;
    if (!categoryId || !categoryName) return;
    saves.push(saveBudget({ categoryId, categoryName, period, amountCents, type }));
  });

  if (saves.length === 0) {
    closeBudgetModal();
    return;
  }

  try {
    await Promise.all(saves);
    if (statusEl) {
      statusEl.textContent = `✓ ${saves.length} budget${saves.length !== 1 ? "s" : ""} saved`;
      statusEl.className = "bgt-modal-save-status is-success";
    }
    // Reload the table in the background, close modal after brief confirmation
    loadAndRender();
    setTimeout(closeBudgetModal, 900);
  } catch (err) {
    console.error("[budgets] modal save error", err);
    if (statusEl) {
      statusEl.textContent = "Save failed: " + err.message;
      statusEl.className = "bgt-modal-save-status is-error";
    }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save All"; }
  }
}

// ── Load & render ─────────────────────────────────────────────────────────────

async function loadAndRender() {
  const period = getPeriod();
  if (!period) return;
  _currentPeriod = period;

  const tbody = document.getElementById("bgt-tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="bgt-loading">Loading…</td></tr>`;

  try {
    const data = await buildBudgetActuals(period);
    renderTable(data);
  } catch (err) {
    console.error("[budgets] loadAndRender error", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="bgt-loading">Error: ${escHtml(err.message)}</td></tr>`;
  }
}

// ── Copy from previous month ──────────────────────────────────────────────────

async function handleCopyClick() {
  const toPeriod = getPeriod();
  if (!toPeriod) return;
  const [y, m]    = toPeriod.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear  = m === 1 ? y - 1 : y;
  const fromPeriod = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  try {
    const btn = document.getElementById("budget-copy-button");
    if (btn) { btn.disabled = true; btn.textContent = "Copying…"; }
    await copyBudgets(fromPeriod, toPeriod);
    await loadAndRender();
    if (btn) { btn.disabled = false; btn.textContent = "Copy from Previous Month"; }
  } catch (err) {
    console.error("[budgets] copy error", err);
    const btn = document.getElementById("budget-copy-button");
    if (btn) { btn.disabled = false; btn.textContent = "Copy from Previous Month"; }
  }
}

// ── Show zeros toggle ─────────────────────────────────────────────────────────

function handleShowZerosToggle(e) {
  _showZeros = e.target.checked;
  if (_lastData) renderTable(_lastData);
}

// ── Table click delegation (inline edit in view mode) ─────────────────────────

function handleTableClick(e) {
  const display = e.target.closest(".bgt-budget-display");
  if (display) activateInlineEdit(display);
}

function handleTableKeydown(e) {
  if (e.key === "Enter" || e.key === " ") {
    const display = e.target.closest(".bgt-budget-display");
    if (display) { e.preventDefault(); activateInlineEdit(display); }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initBudgetsPage() {
  const periodInput = document.getElementById("budget-period");
  if (!periodInput) return;

  if (!_pageInitialized) {
    _pageInitialized = true;

    const today = new Date();
    periodInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    periodInput.addEventListener("change", loadAndRender);
    document.getElementById("budget-copy-button")?.addEventListener("click", handleCopyClick);
    document.getElementById("budget-mode-toggle")?.addEventListener("click", openBudgetModal);
    document.getElementById("bgt-show-zeros")?.addEventListener("change",   handleShowZerosToggle);

    // Modal controls
    document.getElementById("bgt-modal-close")?.addEventListener("click",  closeBudgetModal);
    document.getElementById("bgt-modal-cancel")?.addEventListener("click", closeBudgetModal);
    document.getElementById("bgt-modal-save")?.addEventListener("click",   handleModalSave);

    // Close on backdrop click
    document.getElementById("bgt-modal-backdrop")?.addEventListener("click", e => {
      if (e.target === e.currentTarget) closeBudgetModal();
    });

    // Close on Escape
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        const backdrop = document.getElementById("bgt-modal-backdrop");
        if (backdrop?.classList.contains("is-open")) closeBudgetModal();
      }
    });

    const tableEl = document.getElementById("bgt-table");
    tableEl?.addEventListener("click",   handleTableClick);
    tableEl?.addEventListener("keydown", handleTableKeydown);
  }

  loadAndRender();
}
