import { auth } from "./firebase-config.js";
import { logout } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const API = window.SIMPLE_FINANCE_API || (window.location.port === "5500" ? "http://127.0.0.1:8000" : "");
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

async function loadDashboard(user) {
  const token = await user.getIdToken();
  const response = await fetch(`${API}/api/admin/overview`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 403) throw new Error("This Google account is not in ADMIN_EMAILS.");
  if (!response.ok) throw new Error("Could not load admin metrics.");
  const data = await response.json();
  document.getElementById("adminStatus").textContent = `Updated ${new Date(data.generated_at).toLocaleString("en-IN")}`;
  document.getElementById("metrics").innerHTML = [
    ["Total users", data.total_users],
    ["Active users, 7 days", data.active_users_7d],
    ["Active users, 30 days", data.active_users_30d],
    ["Total logins", data.total_logins],
    ["Expenses recorded", data.total_expenses],
    ["Expense value", money(data.total_expense_amount)],
  ].map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  const entries = Object.entries(data.logins_by_day);
  const max = Math.max(...entries.map(([, value]) => value), 1);
  document.getElementById("loginChart").innerHTML = entries.length ? entries.slice(-30).map(([day, value]) => `<div class="admin-bar-row"><span>${day}</span><div><i style="width:${Math.max(4, value / max * 100)}%"></i></div><strong>${value}</strong></div>`).join("") : "<p class=\"admin-status\">No login data yet.</p>";
}

document.getElementById("logoutButton").onclick = logout;
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  try { await loadDashboard(user); } catch (error) { document.getElementById("adminStatus").textContent = error.message; document.getElementById("adminStatus").classList.add("voice-error"); }
});
