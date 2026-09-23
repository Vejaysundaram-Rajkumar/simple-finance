import { auth } from "./firebase-config.js";

const API = window.SIMPLE_FINANCE_API || (window.location.port === "5500" ? "http://127.0.0.1:8000" : "");

async function request(path, options = {}) {
  if (!auth.currentUser) throw new Error("Not authenticated");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Request failed");
  }
  return response.json();
}

export const parseExpenses = (text) => request("/api/ai/parse", {
  method: "POST", body: JSON.stringify({ text }),
});
export const saveExpenses = (expenses) => request("/api/expenses", {
  method: "POST", body: JSON.stringify({ expenses }),
});
export const getToday = () => request("/api/expenses/today");
export const getExpenses = () => request("/api/expenses");
export const deleteExpense = (id) => request(`/api/expenses/${id}`, { method: "DELETE" });
export const updateExpense = (id, data) => request(`/api/expenses/${id}`, {
  method: "PUT", body: JSON.stringify(data),
});
export const getAnalysis = (month) => request(`/api/analysis/${month}`);
export const generateReport = (data) => request("/api/analysis/report", {
  method: "POST", body: JSON.stringify(data),
});
export const setBudget = (month, amount) => request(`/api/budget/${month}`, {
  method: "PUT", body: JSON.stringify({ amount }),
});
