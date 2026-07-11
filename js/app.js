import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initNav, navigateTo, getPage } from "./nav.js";
import { loadCommits } from "./commits.js";
import { seedAccountsIfEmpty, initAccountsPage } from "./accounts.js";
import { initTransactionsPage } from "./transactions.js";
import { initCategoriesPage } from "./categories.js";
import { initImportPage } from "./bofa-import-page.js";
import { initBudgetsPage } from "./budgets.js";
import { loadPartials } from "./partials.js";

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

// ── Theme ──────────────────────────────────────────────────────────────────────────────
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

// ── Auth ─────────────────────────────────────────────────────────────────────────────
async function login() {
  await signInWithPopup(auth, provider);
}

async function logout() {
  await signOut(auth);
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

  if (getPage() === 'accounts')     initAccountsPage(user.uid);
  if (getPage() === 'transactions') initTransactionsPage(user.uid);
  if (getPage() === 'import')       initImportPage();
  if (getPage() === 'budget')       initBudgetsPage();
}

function initAuth() {
  onAuthStateChanged(auth, updateUI);
}

window.addEventListener('hashchange', () => {
  if (getPage() === 'settings')     loadCommits();
  if (getPage() === 'accounts')     initAccountsPage(auth.currentUser?.uid);
  if (getPage() === 'transactions') initTransactionsPage(auth.currentUser?.uid);
  if (getPage() === 'categories')   initCategoriesPage(auth.currentUser?.uid);
  if (getPage() === 'import')       initImportPage();
  if (getPage() === 'budget')       initBudgetsPage();
});

// ── Init ─────────────────────────────────────────────────────────────────────────────
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
