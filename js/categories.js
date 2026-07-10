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

// ── Emoji Picker ──────────────────────────────────────────────────
const EMOJI_CATEGORIES = [
  {
    label: "💰", title: "Money & Finance",
    emojis: ["💰","💵","💳","💴","💷","💶","🧾","💸","💹","🪙","🏦","📈","📉","💎","🏧","📑","📋","🔐","🏛️","💱","🤑","📤","📥","🔄","🪴","🧰"]
  },
  {
    label: "🍕", title: "Food & Drink",
    emojis: ["🍕","🍔","🌮","🍣","🍜","🍱","🥗","🥑","🍳","🥩","🧁","🥐","🥖","🍩","🍫","🧀","🍎","🥕","🥦","🛒","🍺","🍷","🍸","☕","🥤","🍽️","🐟","🍦","🍨"]
  },
  {
    label: "🏠", title: "Home & Living",
    emojis: ["🏠","🏡","🛋️","🪑","🛏️","🚿","🧺","🔧","🪟","🏗️","🪴","🧯","🔌","📦","🚰","📱","💻","📺","💡","🛒","🧹","🧴","🪣","🚪","🛍️","🛠️"]
  },
  {
    label: "🚗", title: "Transport",
    emojis: ["🚗","🚙","🛻","🚕","🚌","🚁","🛳️","🚢","✈️","🚂","🚲","🛵","🚦","🅿️","🛞","🚧","🏎️","🚜","⛽","🚨","🚀","⚡","🚶"]
  },
  {
    label: "❤️", title: "Health & Wellness",
    emojis: ["❤️","🏥","💊","💉","🩺","🧬","🩻","🩹","🧪","🏋️","🏊","🧗","🤸","🧘","🥼","👓","🩴","🧠","🫀","💪","🦷","🛌","🧖","🏺"]
  },
  {
    label: "🎉", title: "Fun & Entertainment",
    emojis: ["🎉","🎬","🎪","🎠","🎡","🎥","🎨","🎤","🎮","🎵","🎸","🎹","🎻","🎲","🎯","🎳","🃏","🧩","🏄","⛷️","📖","🎰","📸","🏆","🎭"]
  },
  {
    label: "💼", title: "Work & Education",
    emojis: ["💼","📚","✏️","📝","📊","📐","📏","🖨️","📎","🗂️","🏢","🖱️","⌨️","📡","🧑‍💻","🔬","📦","📞","🖥️","🔨","🔑","🎓","🤝","📰","📌"]
  },
  {
    label: "🛍️", title: "Shopping & Goods",
    emojis: ["🛍️","👗","👟","👠","👜","💍","🕶️","🧥","👒","🧦","🎽","🪥","🧴","👔","👕","👖","🧣","🎒","💄","🪞","🛋️","🖼️","📦","🎁","🏷️"]
  },
  {
    label: "🔧", title: "Services",
    emojis: ["🔧","🪠","🧱","🌐","📮","🗑️","🧲","⚙️","🪚","🔩","🛡️","🏗️","🪛","🔑","🗝️","📋","🧹","🚒","🚑","👮","🧑‍🔧","🧑‍🍳","💇","💈","🧑‍⚕️"]
  },
  {
    label: "🐾", title: "Pets & Nature",
    emojis: ["🐾","🐶","🐱","🐈","🐵","🐰","🐻","🌳","🌺","☀️","🌟","🌊","🦋","🐢"]
  },
  {
    label: "👶", title: "People & Family",
    emojis: ["👶","👨","👩","👴","👵","👨‍👩‍👧‍👦","👑","🎁","💌","👋","🤗","🙏","✨"]
  },
];

/**
 * Initialise an emoji picker attached to a trigger button + hidden input.
 *
 * @param {object} opts
 *   triggerBtn  — <button> that opens/closes the popup
 *   displaySpan — <span> inside the trigger that shows the current emoji
 *   popup       — popup <div>
 *   tabsEl      — tabs container inside popup
 *   gridEl      — emoji grid container inside popup
 *   clearBtn    — clear button inside popup
 *   hiddenInput — <input type="hidden"> that holds the value
 *   defaultEmoji— emoji to display when value is empty (default "😊")
 */
function initEmojiPicker(opts) {
  const {
    triggerBtn, displaySpan, popup, tabsEl, gridEl, clearBtn,
    hiddenInput, defaultEmoji = "😊"
  } = opts;

  let activeCategory = 0;

  function renderTabs() {
    tabsEl.innerHTML = EMOJI_CATEGORIES.map((cat, i) =>
      `<button type="button" class="emoji-tab${i === activeCategory ? " is-active" : ""}" title="${cat.title}" data-idx="${i}">${cat.label}</button>`
    ).join("");
    tabsEl.querySelectorAll(".emoji-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        activeCategory = parseInt(btn.dataset.idx, 10);
        renderTabs();
        renderGrid();
      });
    });
  }

  function renderGrid() {
    gridEl.innerHTML = EMOJI_CATEGORIES[activeCategory].emojis.map(e =>
      `<button type="button" class="emoji-btn" data-emoji="${e}" aria-label="${e}">${e}</button>`
    ).join("");
    gridEl.querySelectorAll(".emoji-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const val = btn.dataset.emoji;
        hiddenInput.value = val;
        displaySpan.textContent = val;
        closePopup();
      });
    });
  }

  function openPopup() {
    popup.classList.remove("hidden");
    triggerBtn.setAttribute("aria-expanded", "true");
    renderTabs();
    renderGrid();
  }

  function closePopup() {
    popup.classList.add("hidden");
    triggerBtn.setAttribute("aria-expanded", "false");
  }

  triggerBtn.addEventListener("click", e => {
    e.stopPropagation();
    popup.classList.contains("hidden") ? openPopup() : closePopup();
  });

  clearBtn.addEventListener("click", e => {
    e.stopPropagation();
    hiddenInput.value = "";
    displaySpan.textContent = defaultEmoji;
    closePopup();
  });

  // Close on outside click
  document.addEventListener("click", e => {
    if (!popup.classList.contains("hidden") && !triggerBtn.closest(".emoji-picker-wrap").contains(e.target)) {
      closePopup();
    }
  });

  // Set initial display
  const initial = hiddenInput.value;
  displaySpan.textContent = initial || defaultEmoji;
}

// ── Public helpers ─────────────────────────────────────────────────

/**
 * Returns a map of { categoryId -> { name, color, emoji } }.
 */
export async function getCategoriesMap(_uid) {
  const cats = await fetchCategories();
  const map = {};
  cats.forEach(c => {
    map[c.id] = { name: c.name, color: c.color || "#888888", emoji: c.emoji || "" };
  });
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
    emoji: "",
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Populates a <select> element with categories, including emoji prefix.
 */
export async function populateCategorySelect(_uid, selectEl, opts = {}) {
  if (!selectEl) return;
  const { includeBlank = true, currentId = null } = opts;
  selectEl.innerHTML = '<option value="">Loading categories\u2026</option>';
  try {
    const cats = await fetchCategories();
    const options = cats
      .filter(c => c.isActive !== false)
      .map(c => {
        const label = c.emoji ? `${c.emoji} ${c.name}` : c.name;
        return `<option value="${c.id}"${c.id === currentId ? " selected" : ""}>${escHtml(label)}</option>`;
      })
      .join("");
    selectEl.innerHTML =
      (includeBlank ? '<option value="">\u2014 No category \u2014</option>' : "") + options;
  } catch (err) {
    console.error("[categories] populateCategorySelect error:", err);
    selectEl.innerHTML = '<option value="">Error loading categories</option>';
  }
}

// ── SVG icons ─────────────────────────────────────────────────────
const ICON_EDIT   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_DELETE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>`;
const ICON_CHEVRON = `<svg class="cat-breakdown__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

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

// ── Fetch transactions for a given period from root-level collection ───
async function fetchTransactionsForPeriod(uid, year, month) {
  // month is 0-based (JS Date)
  const start = new Date(year, month, 1);
  const end   = new Date(year, month + 1, 1);
  // Root-level transactions collection shared across all users
  const txRef = collection(getDb(), "transactions");
  const q = query(
    txRef,
    where("date", ">=",
