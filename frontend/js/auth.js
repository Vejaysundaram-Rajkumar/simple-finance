import { auth, authPersistence, googleProvider } from "./firebase-config.js";
import { onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const API = window.SIMPLE_FINANCE_API || (window.location.port === "5500" ? "http://127.0.0.1:8000" : "");

export async function login() {
  await authPersistence;
  const result = await signInWithPopup(auth, googleProvider);
  const token = await result.user.getIdToken();
  const response = await fetch(`${API}/api/users/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Unable to sync your account.");
  window.location.href = "index.html";
}

export async function logout() {
  document.body.classList.add("auth-checking");
  await signOut(auth);
  window.location.href = "login.html";
}

export function protectPage(callback) {
  document.body.classList.add("auth-checking");
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    document.body.classList.remove("auth-checking");
    callback(user);
  });
}
