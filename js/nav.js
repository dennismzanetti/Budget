/**
 * nav.js — Hash-based SPA router
 *
 * Usage:
 *   import { navigateTo, initNav } from './nav.js';
 *   initNav();           // call once after DOM is ready
 *   navigateTo('budget'); // programmatic navigation
 */

export const PAGES = [
  "dashboard",
  "budget",
  "transactions",
  "accounts",
  "reports",
  "settings"
];

/** Returns the current page from the URL hash, defaulting to 'dashboard'. */
export function getPage() {
  const hash = window.location.hash.replace("#", "");
  return PAGES.includes(hash) ? hash : "dashboard";
}

/**
 * Shows the target page section and updates active states on
 * both the sidebar nav and the mobile bottom tab bar.
 * @param {string} page - one of PAGES
 */
export function navigateTo(page) {
  if (!PAGES.includes(page)) page = "dashboard";

  // Update hash without triggering another hashchange loop
  if (window.location.hash !== `#${page}`) {
    history.pushState(null, "", `#${page}`);
  }

  // Toggle page visibility
  PAGES.forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle("hidden", p !== page);
  });

  // Sync sidebar nav active state
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.page === page);
    item.setAttribute("aria-current", item.dataset.page === page ? "page" : "false");
  });

  // Sync bottom tab bar active state
  document.querySelectorAll(".tab-item").forEach(item => {
    item.classList.toggle("active", item.dataset.page === page);
    item.setAttribute("aria-current", item.dataset.page === page ? "page" : "false");
  });
}

/**
 * Wires up the hashchange event and performs initial navigation
 * based on the current URL hash. Call once after the DOM is ready.
 */
export function initNav() {
  // Handle browser back/forward
  window.addEventListener("hashchange", () => navigateTo(getPage()));

  // Handle clicks on nav links without full page reload
  document.querySelectorAll("[data-page]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  // Navigate to the current hash on load
  navigateTo(getPage());
}
