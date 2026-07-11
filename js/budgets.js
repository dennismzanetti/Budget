/**
 * budgets.js — Firestore budgets layer + Budget vs Actual helpers
 *
 * Shared model:
 * - budgets      (root-level, shared across all users)
 * - categories   (root-level, shared across all users)
 * - transactions (root-level, shared across all users)
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

function budgetsRef() {
  return collection(getDb(), "budgets");
}

function transactionsRef() {
  return collection(getDb(), "transactions");
}

function parsePeriod(period) {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error(`Invalid period "${period}". Expected YYYY-MM.`);
  }
  const [yearStr, monthStr] = period.split("-");
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;

  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid period "${period}". Month must be 01-12.`);
  }

  return { year, monthIndex };
}

function periodToRange(period) {
  const { year, monthIndex } = parsePeriod(period);
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);

  return {
    start,
    end,
    startTs: Timestamp.fromDate(start),
    endTs: Timestamp.fromDate(end)
  };
}

function normalizeAmountCents(value) {
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Budget amountCents must be a non-negative integer.");
  }
  return Math.round(n);
}

function normalizeType(type) {
  if (type !== "expense" && type !== "income") {
    throw new Error('Budget type must be "expense" or "income".');
  }
  return type;
}

function makeBudgetKey(categoryId, period, type) {
  return `${categoryId}__${period}__${type}`;
}

/**
 * Fetch budgets for a single month period (YYYY-MM).
 */
export async function fetchBudgetsForPeriod(period) {
  // Simple query first: period + categoryName ordering
  const q = query(
    budgetsRef(),
    where("period", "==", period),
    orderBy("categoryName")
  );

  const snap = await getDocs(q);

  return snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}

/**
 * Fetch transactions for a given month by date range.
 */
export async function fetchTransactionsForBudgetPeriod(period) {
  const { startTs, endTs } = periodToRange(period);

  const q = query(
    transactionsRef(),
    where("date", ">=", startTs),
    where("date", "<", endTs)
  );

  const snap = await getDocs(q);

  return snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}

/**
 * Find an existing budget row for category+period+type.
 */
export async function findExistingBudget(categoryId, period, type) {
  const q = query(
    budgetsRef(),
    where("categoryId", "==", categoryId),
    where("period", "==", period),
    where("type", "==", type)
  );

  const snap = await getDocs(q);

  if (snap.empty) return null;

  const first = snap.docs[0];
  return { id: first.id, ...first.data() };
}

/**
 * Upsert a budget row (editable budgets).
 *
 * If id is provided, updates that doc.
 * Else, finds existing budget for category+period+type and updates it.
 * Else, creates a new doc.
 */
export async function saveBudget(input) {
  const {
    id = null,
    categoryId,
    categoryName,
    period,
    amountCents,
    type = "expense",
    isActive = true
  } = input || {};

  if (!categoryId) throw new Error("categoryId is required.");
  if (!categoryName || !String(categoryName).trim()) {
    throw new Error("categoryName is required.");
  }

  parsePeriod(period);
  const normalizedType = normalizeType(type);
  const normalizedAmountCents = normalizeAmountCents(amountCents);

  const payload = {
    categoryId,
    categoryName: String(categoryName).trim(),
    period,
    amountCents: normalizedAmountCents,
    type: normalizedType,
    isActive: isActive !== false,
    updatedAt: serverTimestamp()
  };

  const db = getDb();

  if (id) {
    await updateDoc(doc(db, "budgets", id), payload);
    return id;
  }

  const existing = await findExistingBudget(categoryId, period, normalizedType);

  if (existing) {
    await updateDoc(doc(db, "budgets", existing.id), payload);
    return existing.id;
  }

  const ref = await addDoc(budgetsRef(), {
    ...payload,
    createdAt: serverTimestamp()
  });

  return ref.id;
}

/**
 * Delete a budget by ID.
 */
export async function deleteBudgetById(id) {
  if (!id) throw new Error("Budget id is required.");
  await deleteDoc(doc(getDb(), "budgets", id));
}

/**
 * Build Budget vs Actual rows for a given month.
 * Returns rows and a summary, ready for display.
 */
export async function buildBudgetActuals(period) {
  const [catMap, budgets, txns] = await Promise.all([
    getCategoriesMap(null),
    fetchBudgetsForPeriod(period),
    fetchTransactionsForBudgetPeriod(period)
  ]);

  const categories = Object.entries(catMap).map(([id, cat]) => ({
    id,
    name: cat.name,
    color: cat.color || "#888888",
    emoji: cat.emoji || ""
  }));

  const budgetByKey = new Map();
  budgets.forEach(b => {
    budgetByKey.set(makeBudgetKey(b.categoryId, b.period, b.type), b);
  });

  const actualsByKey = new Map();

  txns.forEach(tx => {
    if (tx.isActive === false) return;
    if (!tx.categoryId) return;
    if (typeof tx.amountCents !== "number") return;

    const type = tx.type === "income" ? "income" : "expense";
    const amountCents = Math.abs(tx.amountCents);
    if (amountCents === 0) return;

    const key = makeBudgetKey(tx.categoryId, period, type);
    const current = actualsByKey.get(key) || 0;
    actualsByKey.set(key, current + amountCents);
  });

  const rows = [];

  categories.forEach(cat => {
    ["expense", "income"].forEach(type => {
      const key = makeBudgetKey(cat.id, period, type);
      const budget = budgetByKey.get(key);
      const budgetAmountCents = budget?.amountCents || 0;
      const actualAmountCents = actualsByKey.get(key) || 0;
      const varianceCents = budgetAmountCents - actualAmountCents;
      const percentUsed =
        budgetAmountCents > 0
          ? (actualAmountCents / budgetAmountCents) * 100
          : 0;

      rows.push({
        key,
        budgetId: budget?.id || null,
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        categoryEmoji: cat.emoji,
        period,
        type,
        budgetAmountCents,
        actualAmountCents,
        varianceCents,
        percentUsed,
        hasBudget: !!budget,
        isOverBudget:
          type === "expense" &&
          actualAmountCents > budgetAmountCents &&
          budgetAmountCents > 0
      });
    });
  });

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.categoryName.localeCompare(b.categoryName);
  });

  const summary = rows.reduce(
    (acc, row) => {
      if (row.type === "expense") {
        acc.expenseBudgetCents += row.budgetAmountCents;
        acc.expenseActualCents += row.actualAmountCents;
      } else {
        acc.incomeBudgetCents += row.budgetAmountCents;
        acc.incomeActualCents += row.actualAmountCents;
      }
      return acc;
    },
    {
      period,
      expenseBudgetCents: 0,
      expenseActualCents: 0,
      incomeBudgetCents: 0,
      incomeActualCents: 0
    }
  );

  summary.expenseVarianceCents =
    summary.expenseBudgetCents - summary.expenseActualCents;
  summary.incomeVarianceCents =
    summary.incomeBudgetCents - summary.incomeActualCents;

  return {
    period,
    budgets,
    transactions: txns,
    rows,
    summary
  };
}

/**
 * Build rows for an editable budgets page: one row per category
 * with expense and income budget amounts.
 */
export async function buildBudgetEditorRows(period) {
  const [catMap, budgets] = await Promise.all([
    getCategoriesMap(null),
    fetchBudgetsForPeriod(period)
  ]);

  const categories = Object.entries(catMap).map(([id, cat]) => ({
    id,
    name: cat.name,
    color: cat.color || "#888888",
    emoji: cat.emoji || ""
  }));

  const budgetByKey = new Map();
  budgets.forEach(b => {
    budgetByKey.set(makeBudgetKey(b.categoryId, b.period, b.type), b);
  });

  return categories
    .map(cat => {
      const expenseBudget = budgetByKey.get(
        makeBudgetKey(cat.id, period, "expense")
      );
      const incomeBudget = budgetByKey.get(
        makeBudgetKey(cat.id, period, "income")
      );

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        categoryEmoji: cat.emoji,
        expenseBudgetId: expenseBudget?.id || null,
        expenseAmountCents: expenseBudget?.amountCents || 0,
        incomeBudgetId: incomeBudget?.id || null,
        incomeAmountCents: incomeBudget?.amountCents || 0
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

/**
 * Copy budgets from one month to another (editable convenience).
 */
export async function copyBudgets(fromPeriod, toPeriod) {
  if (fromPeriod === toPeriod) return { copied: 0 };

  const sourceBudgets = await fetchBudgetsForPeriod(fromPeriod);

  let copied = 0;
  for (const b of sourceBudgets) {
    await saveBudget({
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      period: toPeriod,
      amountCents: b.amountCents,
      type: b.type,
      isActive: b.isActive !== false
    });
    copied++;
  }

  return { copied };
}

/**
 * Placeholder initializer for the budgets page. Wire this from nav.js.
 */
export async function initBudgetsPage(uid) {
  console.debug("[budgets] initBudgetsPage called for uid:", uid);
  // TODO: hook up DOM rendering for editable budgets UI.
}