/**
 * categories.js — Firestore categories layer + UI for the Categories page
 *
 * Categories are stored in the global top-level "categories" collection and
 * shared across all users (uid params are accepted for API compatibility but ignored).
 *
 * Transactions are stored in the global top-level "transactions" collection and
 * shared across all users.
 *
 * Exports:
 *   initCategoriesPage(uid)                        — wires up the #categories page UI
 *   populateCategorySelect(uid, selectEl, opts)     — fills a <select> with category options
 *   getCategoriesMap(uid)                           — returns { id -> { name, color, emoji } }
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

// ── Nav badge ─────────────────────────────────────────────────────────
function updateCategoriesBadge(categories) {
  const badge = document.getElementById("categories-count-badge");
  if (!badge) return;
  if (!categories || categories.length === 0) {
    badge.textContent = "";
    return;
  }
  const active = categories.filter(c => c.isActive !== false).length;
  const total  = categories.length;
  badge.textContent = active === total ? `(${total})` : `${active} (${total})`;
}
