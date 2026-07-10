/**
 * nav.js — Hash-based client-side router
 *
 * Pages are <section id="{name}"> elements inside #main.
 * Navigation links carry [data-page="{name}"] on both the sidebar
 * .nav-item anchors and the bottom .tab-item anchors.
 *
 * Usage:
 *   import { initNav, navigateTo, getPage } from './nav.js';
 *   initNav();            // call once after DOM is ready (safe to call multiple times)
 *   navigateTo('budget'); // programmatic navigation
 *   getPage();            // returns the currently active page name
 */

/** All known page names (must match id="{name}" in index.html) */
const PAGES = ['dashboard', 'budget', 'transactions', 'accounts', 'categories', 'reports', 'import', 'settings', 'help'];
const DEFAULT_PAGE = 'dashboard';

/** Prevent duplicate listener registration across multiple initNav() calls */
let initialized = false;

/**
 * Derive the target page from the current URL hash.
 * Falls back to DEFAULT_PAGE when the hash is missing or unrecognised.
 */
function pageFromHash() {
  const hash = window.location.hash.replace('#', '').toLowerCase();
  return PAGES.includes(hash) ? hash : DEFAULT_PAGE;
}

/**
 * Show the requested page section and update all nav link states.
 * @param {string} page  One of the PAGES values.
 */
function activatePage(page) {
  // Show / hide page sections
  PAGES.forEach((p) => {
    const section = document.getElementById(p);
    if (!section) return;
    if (p === page) {
      section.classList.remove('hidden');
      section.removeAttribute('aria-hidden');
    } else {
      section.classList.add('hidden');
      section.setAttribute('aria-hidden', 'true');
    }
  });

  // Update sidebar nav-item active states
  document.querySelectorAll('.nav-item[data-page]').forEach((el) => {
    const isActive = el.dataset.page === page;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Update bottom tab-item active states
  document.querySelectorAll('.tab-item[data-page]').forEach((el) => {
    const isActive = el.dataset.page === page;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Update document title
  const label = page.charAt(0).toUpperCase() + page.slice(1);
  document.title = `Budget — ${label}`;
}

/**
 * Programmatically navigate to a page.
 * Updates the URL hash and activates the page.
 * @param {string} page
 */
export function navigateTo(page) {
  if (!PAGES.includes(page)) page = DEFAULT_PAGE;
  if (window.location.hash !== `#${page}`) {
    history.pushState(null, '', `#${page}`);
  }
  activatePage(page);
}

/**
 * Returns the currently active page name derived from the URL hash.
 * @returns {string}
 */
export function getPage() {
  return pageFromHash();
}

/**
 * Initialise the router.
 * Safe to call multiple times — listeners are only registered once.
 * On subsequent calls it simply re-activates the current page.
 */
export function initNav() {
  if (initialized) {
    // Re-activate in case DOM was updated (e.g. after partials reload)
    activatePage(pageFromHash());
    return;
  }
  initialized = true;

  // Handle browser back / forward (history.pushState triggers popstate on back/fwd)
  window.addEventListener('popstate', () => {
    activatePage(pageFromHash());
  });

  // Handle direct hash link clicks (e.g. <a href="#budget">) which fire
  // hashchange but NOT popstate
  window.addEventListener('hashchange', () => {
    activatePage(pageFromHash());
  });

  // Intercept clicks on nav/tab links — use navigateTo for programmatic nav
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-page]');
    if (!link) return;
    const page = link.dataset.page;
    if (!PAGES.includes(page)) return;
    e.preventDefault();
    navigateTo(page);
  });

  // Activate the page that matches the initial URL hash (or default)
  activatePage(pageFromHash());
}
