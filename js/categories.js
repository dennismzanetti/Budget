/**
 * categories.js — Firestore categories layer + UI for the Categories page
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
  deleteDoc, doc, serverTimestamp, query, orderBy
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

function categoriesRef(uid) {
  return collection(getDb(), "users", uid, "categories");
}

async function fetchCategories(uid) {
  const q = query(categoriesRef(uid), orderBy("name"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Public helpers ────────────────────────────────────────────────────

/**
 * Returns a map of { categoryId -> { name, color } } for the given user.
 * Used by import and transaction pages to resolve IDs to display info.
 */
export async function getCategoriesMap(uid) {
  const cats = await fetchCategories(uid);
  const map = {};
  cats.forEach(c => { map[c.id] = { name: c.name, color: c.color || "#888888" }; });
  return map;
}

/**
 * Finds an existing active category by name (case-insensitive) or creates a new one.
 * Returns the category ID.
 */
export async function ensureCategoryExists(uid, name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const cats = await fetchCategories(uid);
  const existing = cats.find(c => c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  // Auto-create
  const ref = await addDoc(categoriesRef(uid), {
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
 * opts.includeBlank (default true) — prepend a blank "Select category…" option
 * opts.currentId — pre-select this category ID
 */
export async function populateCategorySelect(uid, selectEl, opts = {}) {
  if (!selectEl) return;
  const { includeBlank = true, currentId = null } = opts;
  selectEl.innerHTML = '<option value="">Loading categories\u2026</option>';
  try {
    const cats = await fetchCategories(uid);
    const options = cats
      .filter(c => c.isActive !== false)
      .map(c => `<option value="${c.id}"${c.id === currentId ? " selected" : ""}>${escHtml(c.name)}</option>`)
      .join("");
    selectEl.innerHTML =
      (includeBlank ? '<option value="">— No category —</option>' : "") + options;
  } catch (err) {
    console.error("[categories] populateCategorySelect error:", err);
    selectEl.innerHTML = '<option value="">Error loading categories</option>';
  }
}

// ── SVG icons ─────────────────────────────────────────────────────────
const ICON_EDIT   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_DELETE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>`;

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Render a single category card ────────────────────────────────────
function renderCard(c) {
  const color = c.color || "#888888";
  return `
    <li class="account-card" data-id="${c.id}">
      <div class="account-card__info">
        <span class="category-swatch" style="background:${escHtml(color)}" aria-hidden="true"></span>
        <span class="account-card__name">${escHtml(c.name)}</span>
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
export async function initCategoriesPage(uid) {
  const listEl    = document.getElementById("categoriesList");
  const addForm   = document.getElementById("addCategoryForm");
  const addBtn    = document.getElementById("addCategoryBtn");
  const cancelBtn = document.getElementById("cancelAddCategory");
  const saveBtn   = document.getElementById("saveCategoryBtn");
  const nameInput = document.getElementById("newCategoryName");
  const colorInput= document.getElementById("newCategoryColor");
  const addErrEl  = document.getElementById("addCategoryError");

  if (!listEl) return;

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
      const cats = await fetchCategories(uid);
      if (cats.length === 0) {
        listEl.innerHTML = `
          <li class="accounts-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <p>No categories yet.<br/>Click <strong>Add Category</strong> to get started.</p>
          </li>`;
        return;
      }

      listEl.innerHTML = cats.map(renderCard).join("");

      // ── Edit ──────────────────────────────────────────────────────
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
            await updateDoc(doc(getDb(), "users", uid, "categories", id), {
              name,
              color: colorEl?.value || "#888888",
              updatedAt: serverTimestamp(),
            });
            renderList();
          } catch (err) {
            console.error("[categories] updateDoc error:", err);
            if (errEl) { errEl.textContent = "Save failed. Try again."; errEl.classList.remove("hidden"); }
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      });

      // ── Delete (inline confirm) ───────────────────────────────────
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
            await deleteDoc(doc(getDb(), "users", uid, "categories", id));
            renderList();
          });
        });
      });

    } catch (err) {
      console.error("[categories] renderList error:", err);
      listEl.innerHTML = '<li class="accounts-empty"><p>Error loading categories.</p></li>';
    }
  }

  // ── Add category form ─────────────────────────────────────────────
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
      await addDoc(categoriesRef(uid), {
        name, color,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      addForm?.classList.add("hidden");
      addBtn?.classList.remove("hidden");
      if (nameInput) nameInput.value = "";
      renderList();
    } catch (err) {
      console.error("[categories] addDoc error:", err);
      showAddError("Failed to save. Please try again.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  renderList();
}
