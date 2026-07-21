import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { loadPartials } from "./partials.js";
import { initNav, getPage } from "./nav.js";
import { loadCommits } from "./commits.js";
import { seedAccountsIfEmpty, initAccountsPage, refreshAccountsPage } from "./accounts.js";
import { initTransactionsPage, refreshTransactionsPage } from "./transactions.js";
import { initCategoriesPage, refreshCategoriesPage } from "./categories.js";
import { initImportPage, refreshImportPage } from "./bofa-import-page.js";
import { initBudgetsPage, refreshBudgetsPage } from "./budgets.js";
import { initReportsPage, refreshReportsPage } from "./reports.js";
import { initDashboardPage, refreshDashboardPage } from "./dashboard.js";


const firebaseConfig = {
  apiKey: "AIzaSyA1bezOLjTbb-3sfI1BBqKqBDifPlxnqYQ",
  authDomain: "budget-2d6a0.firebaseapp.com",
  projectId: "budget-2d6a0",
  storageBucket: "budget-2d6a0.firebasestorage.app",
  messagingSenderId: "309980875957",
  appId: "1:309980875957:web:3c520e284b3ee1745302fc"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ── Theme ──────────────────────────────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}
function initTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}

function bindThemeToggles() {
  ["themeToggle", "themeToggle2"].forEach(id => {
    const btn = document.getElementById(id);
    btn && btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      setTheme(next);
    });
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function login() {
  await signInWithPopup(auth, provider);
}

async function logout() {
  await signOut(auth);
}

// ── Page Refresh ──────────────────────────────────────────────────────────────
function refreshCurrentPage() {
  const page = getPage();
  if (page === 'accounts')     refreshAccountsPage();
  if (page === 'transactions') refreshTransactionsPage();
  if (page === 'categories')   refreshCategoriesPage();
  if (page === 'import')       refreshImportPage();
  if (page === 'budget')       refreshBudgetsPage();
  if (page === 'reports')      refreshReportsPage();
  if (page === 'dashboard')    refreshDashboardPage();
}

function updateUI(user) {
  const loggedOutView  = document.getElementById("loggedOutView");
  const loggedInView   = document.getElementById("loggedInView");
  const userPhoto      = document.getElementById("userPhoto");
  const userPhotoLarge = document.getElementById("userPhotoLarge");
  const userNameEl     = document.getElementById("userNameSettings");
  const userEmailEl    = document.getElementById("userEmailSettings");

  if (!user) {
    loggedOutView.classList.remove("hidden");
    loggedInView.classList.add("hidden");
    return;
  }
  loggedOutView.classList.add("hidden");
  loggedInView.classList.remove("hidden");

  const photo = user.photoURL || "https://placehold.co/72x72";
  if (userPhoto)      userPhoto.src = photo;
  if (userPhotoLarge) userPhotoLarge.src = photo;
  if (userNameEl)     userNameEl.textContent = user.displayName || "User";
  if (userEmailEl)    userEmailEl.textContent = user.email || "";

  initNav();

  seedAccountsIfEmpty(user.uid)
    .then(() => initAccountsPage(user.uid))
    .catch(err => console.error("[seed] accounts seed failed:", err));

  loadCommits();
  initCategoriesPage(user.uid);
  initTransactionsPage(user.uid);
  initImportPage();
  initBudgetsPage();
  initReportsPage();
  initDashboardPage(user.uid);

  // Refresh the currently active page after all modules are initialized
  refreshCurrentPage();
}

function initAuth() {
  onAuthStateChanged(auth, updateUI);
}

// Refresh on hash navigation
window.addEventListener('hashchange', refreshCurrentPage);

// Refresh when page is restored from back/forward cache
window.addEventListener('pageshow', (e) => {
  if (e.persisted) refreshCurrentPage();
});

// ── Init ─────────────────────────────────────────────────────────────────────
export { db };

(async () => {
  initTheme();
  await loadPartials();
  initNav();
  bindThemeToggles();

  const heroLoginBtn = document.getElementById("heroLoginBtn");
  const logoutBtn    = document.getElementById("logoutBtn");

  heroLoginBtn && heroLoginBtn.addEventListener("click", async () => {
    try { await login(); }
    catch (error) { console.error("Login failed:", error); alert(error.message); }
  });

  logoutBtn && logoutBtn.addEventListener("click", async () => {
    try { await logout(); }
    catch (error) { console.error("Logout failed:", error); alert(error.message); }
  });

  initAuth();
})();
