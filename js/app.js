import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initNav, navigateTo, getPage } from "./nav.js";

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

// ── DOM refs ──────────────────────────────────────────────
const loggedOutView   = document.getElementById("loggedOutView");
const loggedInView    = document.getElementById("loggedInView");
const heroLoginBtn    = document.getElementById("heroLoginBtn");
const logoutBtn       = document.getElementById("logoutBtn");
const userPhoto       = document.getElementById("userPhoto");
const userPhotoLarge  = document.getElementById("userPhotoLarge");
const userNameEl      = document.getElementById("userNameSettings");
const userEmailEl     = document.getElementById("userEmailSettings");
const themeToggle     = document.getElementById("themeToggle");
const themeToggle2    = document.getElementById("themeToggle2");
const root            = document.documentElement;

// ── Theme ─────────────────────────────────────────────────
function setTheme(theme) {
  root.setAttribute("data-theme", theme);
}
function initTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}
[themeToggle, themeToggle2].forEach(btn => {
  btn && btn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(next);
  });
});

// ── Auth ──────────────────────────────────────────────────
async function login() {
  const useRedirect = window.innerWidth < 768;
  if (useRedirect) {
    await signInWithRedirect(auth, provider);
    return;
  }
  await signInWithPopup(auth, provider);
}

async function logout() {
  await signOut(auth);
}

function updateUI(user) {
  if (!user) {
    loggedOutView.classList.remove("hidden");
    loggedInView.classList.add("hidden");
    return;
  }
  loggedOutView.classList.add("hidden");
  loggedInView.classList.remove("hidden");

  const photo = user.photoURL || "https://placehold.co/72x72";
  if (userPhoto) userPhoto.src = photo;
  if (userPhotoLarge) userPhotoLarge.src = photo;
  if (userNameEl) userNameEl.textContent = user.displayName || "User";
  if (userEmailEl) userEmailEl.textContent = user.email || "";

  // Initialize nav after the logged-in view is visible
  initNav();
}

async function initAuth() {
  try {
    await getRedirectResult(auth);
  } catch (error) {
    console.error("Redirect sign-in failed:", error);
  }
  onAuthStateChanged(auth, updateUI);
}

heroLoginBtn.addEventListener("click", async () => {
  try { await login(); }
  catch (error) { console.error("Login failed:", error); alert(error.message); }
});

logoutBtn.addEventListener("click", async () => {
  try { await logout(); }
  catch (error) { console.error("Logout failed:", error); alert(error.message); }
});

// ── Init ──────────────────────────────────────────────────
export { db };
initTheme();
initAuth();
