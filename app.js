import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const loginBtn = document.getElementById("loginBtn");
const heroLoginBtn = document.getElementById("heroLoginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loggedOutView = document.getElementById("loggedOutView");
const loggedInView = document.getElementById("loggedInView");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userPhoto = document.getElementById("userPhoto");
const themeToggle = document.getElementById("themeToggle");
const root = document.documentElement;

function setTheme(theme) {
  root.setAttribute("data-theme", theme);
}

function initTheme() {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}

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
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    return;
  }

  loggedOutView.classList.add("hidden");
  loggedInView.classList.remove("hidden");
  loginBtn.classList.add("hidden");
  logoutBtn.classList.remove("hidden");

  userName.textContent = user.displayName || "Signed-in user";
  userEmail.textContent = user.email || "";
  userPhoto.src = user.photoURL || "https://placehold.co/72x72";
}

async function initAuth() {
  try {
    await getRedirectResult(auth);
  } catch (error) {
    console.error("Redirect sign-in failed:", error);
    alert(error.message);
  }

  onAuthStateChanged(auth, (user) => {
    updateUI(user);
  });
}

loginBtn.addEventListener("click", async () => {
  try {
    await login();
  } catch (error) {
    console.error("Login failed:", error);
    alert(error.message);
  }
});

heroLoginBtn.addEventListener("click", async () => {
  try {
    await login();
  } catch (error) {
    console.error("Login failed:", error);
    alert(error.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await logout();
  } catch (error) {
    console.error("Logout failed:", error);
    alert(error.message);
  }
});

themeToggle.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  setTheme(next);
});

initTheme();
initAuth();
