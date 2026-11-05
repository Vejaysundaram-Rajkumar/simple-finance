import { logout, protectPage } from "./auth.js";
import { createActivity, createSettlement, deleteActivity, deleteExpense, generateReport, getActivities, getActivityProgress, getAnalysis, getExpenses, getToday, parseExpenses, saveExpenses, setActivityDay, setBudget, updateExpense } from "./api.js";

let pendingExpenses = [];
let editingExpenseId = null;
let editingGroupShare = false;
let editingSharedParticipantCount = null;
let trackView = "expenses";
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
const pdfMoney = (value) => `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0)}`;
const monthKey = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; };
const todayKey = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const activityCutoffKey = () => { const today = new Date(); const previousMonth = new Date(today.getFullYear(), today.getMonth(), 1); previousMonth.setMonth(previousMonth.getMonth() - 1); return `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}-01`; };
const previousMonthKey = () => { const current = new Date(); current.setDate(1); current.setMonth(current.getMonth() - 1); return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`; };
let analysisMonth = monthKey();
let trackMonth = monthKey();
const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const expenseDate = (expense) => (expense.expense_date || expense.created_at || "").slice(0, 10);
const dateLabel = (date) => date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Date unavailable";
const showModal = (id) => document.getElementById(id).classList.add("visible");
const hideModal = (id) => document.getElementById(id).classList.remove("visible");
const escapeHtml = (value = "") => { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; };
const escapeAttribute = (value = "") => escapeHtml(value).replaceAll('"', "&quot;");
let loadingTimer = null;
const setLoading = (visible, text = "Loading your finances...") => { const loader = document.getElementById("appLoader"); if (!loader) return; clearTimeout(loadingTimer); if (!visible) { loader.classList.remove("visible"); return; } document.getElementById("appLoaderText").textContent = text; loadingTimer = setTimeout(() => loader.classList.add("visible"), 5000); };

protectPage(async (user) => {
  const firstName = user.displayName?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  document.getElementById("greeting").textContent = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${firstName}`;
  ["userAvatar", "menuAvatar"].forEach((id) => { document.getElementById(id).src = user.photoURL || ""; });
  document.getElementById("profileName").textContent = user.displayName || "User";
  document.getElementById("profileEmail").textContent = user.email || "";
  document.getElementById("trackMonth").textContent = monthLabel(trackMonth);
  document.getElementById("analysisMonth").value = analysisMonth;
  setupEvents();
  setLoading(true);
  try { await refreshHome(); } finally { setLoading(false); }
});

function setupEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === button.dataset.page));
    if (button.dataset.page === "analysisPage") { setLoading(true, "Loading analysis..."); try { await loadAnalysis(); } finally { setLoading(false); } }
    if (button.dataset.page === "trackPage") { setLoading(true, trackView === "activities" ? "Loading activities..." : "Loading expenses..."); try { await loadHistory(); } catch (error) { alert(error.message); } finally { setLoading(false); } }
  }));
  document.querySelectorAll(".track-tab").forEach((button) => button.addEventListener("click", async () => {
    trackView = button.dataset.trackView;
    document.querySelectorAll(".track-tab").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.getElementById("expensesPanel").hidden = trackView !== "expenses";
    document.getElementById("activitiesPanel").hidden = trackView !== "activities";
    setLoading(true, trackView === "activities" ? "Loading activities..." : "Loading expenses...");
    try { await loadHistory(); } catch (error) { alert(error.message); } finally { setLoading(false); }
  }));
  document.getElementById("activityForm").onsubmit = handleActivityCreate;
  document.getElementById("activityList").addEventListener("click", handleActivityAction);
  document.getElementById("previousMonth").onclick = () => changeTrackMonth(-1);
  document.getElementById("nextMonth").onclick = () => changeTrackMonth(1);
  document.getElementById("downloadActivityProgress").onclick = downloadActivityProgress;
  document.getElementById("openReport").onclick = openReportModal;
  document.getElementById("closeReport").onclick = () => hideModal("reportModal");
  document.getElementById("reportPeriod").onchange = updateReportFields;
  document.getElementById("generateReport").onclick = handleReport;
  document.getElementById("analysisMonth").onchange = async (event) => { analysisMonth = event.target.value || monthKey(); await loadAnalysis(analysisMonth); };
  document.getElementById("parseButton").onclick = handleParse;
  document.getElementById("importButton").onclick = () => document.getElementById("importFile").click();
  document.getElementById("importFile").onchange = handleImport;
  document.getElementById("confirmExpenses").onclick = handleSave;
  document.getElementById("closeReview").onclick = () => hideModal("reviewModal");
  document.getElementById("closeEditExpense").onclick = () => hideModal("editExpenseModal");
  document.getElementById("saveEditedExpense").onclick = handleEditSave;
  document.getElementById("closeSettlement").onclick = () => hideModal("settlementModal");
  document.getElementById("saveSettlement").onclick = handleSettlementSave;
  document.getElementById("editBudget").onclick = () => showModal("budgetModal");
  document.getElementById("closeBudget").onclick = () => hideModal("budgetModal");
  document.getElementById("saveBudget").onclick = handleBudget;
  document.getElementById("logoutButton").onclick = logout;
  document.getElementById("profileButton").onclick = () => document.getElementById("profileMenu").classList.toggle("visible");
  document.addEventListener("click", (event) => { if (!event.target.closest(".profile-menu, #profileButton")) document.getElementById("profileMenu").classList.remove("visible"); });
  setupVoice();
}

async function refreshHome() { await Promise.all([loadToday(), loadAnalysis()]); }
async function handleParse() {
  const input = document.getElementById("expenseInput"); const text = input.value.trim(); if (!text) return;
  const button = document.getElementById("parseButton"); button.disabled = true; button.textContent = "Understanding...";
  try { const result = await parseExpenses(text); pendingExpenses = result.expenses.map((expense) => ({ ...expense, raw_input: text, shared_text: formatShares(expense.shared_with) })); renderReview(); showModal("reviewModal"); }
  catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = "Add expenses"; }
}
function renderReview() {
  const container = document.getElementById("reviewList"); container.innerHTML = pendingExpenses.map((expense, index) => `<div class="review-card"><div class="review-amount"><span>₹</span><input type="number" min="0.01" step="0.01" value="${expense.amount}" data-index="${index}" data-field="amount"></div><div class="review-fields"><select data-index="${index}" data-field="category">${["Food", "Shopping", "Personal Care", "Transport", "Other"].map((category) => `<option ${category === expense.category ? "selected" : ""}>${category}</option>`).join("")}</select><input value="${escapeAttribute(expense.subcategory)}" data-index="${index}" data-field="subcategory"><select data-index="${index}" data-field="payment_type"><option value="debit" ${expense.payment_type !== "credit" ? "selected" : ""}>Debit (UPI / debit card)</option><option value="credit" ${expense.payment_type === "credit" ? "selected" : ""}>Credit card</option></select><input type="date" value="${expense.expense_date || ""}" data-index="${index}" data-field="expense_date"></div><label class="share-toggle"><input type="checkbox" data-shared-toggle="${index}" ${expense.is_shared ? "checked" : ""}> Shared bill</label><div class="shared-entry-fields" ${expense.is_shared ? "" : "hidden"}><label>Group name${expense.shared_as_group ? " (required)" : " (optional)"}<input value="${escapeAttribute(expense.group_name || "")}" data-index="${index}" data-field="group_name" placeholder="Friends group"></label>${expense.shared_as_group ? `<small>Other group members owe ${money(groupOwed(expense))} in total${expense.shared_participant_count ? ` (${expense.shared_participant_count} people including you)` : ""}. Enter a group name so you can track the combined balance.</small>` : `<label>People and amounts<input value="${escapeAttribute(expense.shared_text || "")}" data-index="${index}" data-field="shared_text" placeholder="Alex: 20, Sam: 20"></label><small>Your share is the total minus these amounts.</small>`}</div><button class="remove-expense" data-remove="${index}" aria-label="Remove expense">×</button></div>`).join("");
  container.querySelectorAll("[data-field]").forEach((field) => field.addEventListener("change", (event) => { const { index, field: name } = event.target.dataset; pendingExpenses[Number(index)][name] = name === "amount" ? Number(event.target.value) : event.target.value; }));
  container.querySelectorAll("[data-shared-toggle]").forEach((field) => field.addEventListener("change", (event) => { const expense = pendingExpenses[Number(event.target.dataset.sharedToggle)]; expense.is_shared = event.target.checked; if (!expense.is_shared) expense.shared_as_group = false; renderReview(); }));
  container.querySelectorAll("[data-remove]").forEach((button) => { button.onclick = () => { pendingExpenses.splice(Number(button.dataset.remove), 1); renderReview(); }; });
}
function formatShares(shares = []) { return shares.map((share) => `${share.name}: ${share.amount}`).join(", "); }
function groupOwed(expense) { return expense.shared_participant_count ? Math.round(expense.amount * (expense.shared_participant_count - 1) / expense.shared_participant_count * 100) / 100 : Number(expense.shared_with?.[0]?.amount || 0); }
function parseShares(text) {
  if (!text.trim()) return [];
  return text.split(",").map((part) => {
    const match = part.trim().match(/^(.+?)\s*:\s*₹?\s*(\d+(?:\.\d{1,2})?)$/);
    if (!match) throw new Error(`Check this share: "${part.trim()}". Use Name: amount.`);
    return { name: match[1].trim(), amount: Number(match[2]) };
  });
}
function expenseForSave(expense) {
  if (expense.shared_as_group) {
    const group_name = (expense.group_name || "").trim();
    if (!group_name) throw new Error(`Enter a group name for ${expense.subcategory}.`);
    const shared_with = [{ name: group_name, amount: groupOwed(expense) }];
    return {
      ...expense,
      group_name,
      is_shared: true,
      shared_with,
    };
  }
  const shared_with = expense.is_shared ? parseShares(expense.shared_text || "") : [];
  if (expense.is_shared && !shared_with.length) throw new Error(`Add at least one person and amount for ${expense.subcategory}.`);
  if (shared_with.some((share) => !share.name || share.amount <= 0)) throw new Error("Each shared person needs a name and a positive amount.");
  if (Math.round(shared_with.reduce((sum, share) => sum + share.amount, 0) * 100) > Math.round(expense.amount * 100)) throw new Error(`Shared amounts exceed the total for ${expense.subcategory}.`);
  const { shared_text, ...savedExpense } = expense;
  savedExpense.shared_participant_count = null;
  return { ...savedExpense, is_shared: Boolean(expense.is_shared), group_name: expense.is_shared ? (expense.group_name || null) : null, shared_with };
}
async function handleSave() { if (!pendingExpenses.length) return; let expenses; try { expenses = pendingExpenses.map(expenseForSave); } catch (error) { alert(error.message); return; } const button = document.getElementById("confirmExpenses"); button.disabled = true; button.textContent = "Saving..."; try { await saveExpenses(expenses); pendingExpenses = []; document.getElementById("expenseInput").value = ""; hideModal("reviewModal"); setLoading(true, "Saving expenses..."); await refreshHome(); } catch (error) { alert(error.message); } finally { setLoading(false); button.disabled = false; button.textContent = "Save expenses"; } }
async function loadToday() { const data = await getToday(); document.getElementById("todayTotal"); document.getElementById("todayCount").textContent = `${data.count} ${data.count === 1 ? "expense" : "expenses"}`; renderTransactions(document.getElementById("todayExpenses"), data.expenses); }
function renderTransactions(container, expenses) { if (!expenses.length) { container.innerHTML = `<div class="empty-state"><h3>No expenses yet</h3><p>Tell Simple Finance what you spent.</p></div>`; return; } container.innerHTML = expenses.map((expense) => `<div class="transaction"><div class="transaction-icon">${categoryIcon(expense.category)}</div><div class="transaction-info"><strong>${escapeHtml(expense.subcategory)}</strong><span>${escapeHtml(expense.category)}</span><small class="transaction-date">${dateLabel(expenseDate(expense))} · ${expense.payment_type === "credit" ? "Credit card" : "Debit"}</small></div><strong class="transaction-amount">${money(expense.amount)}</strong><button class="edit-expense" data-edit-expense="${escapeHtml(expense.id)}" title="Edit expense">✎</button><button class="delete-expense" data-delete-expense="${escapeHtml(expense.id)}" title="Delete expense">🗑</button></div>`).join(""); container.querySelectorAll("[data-edit-expense]").forEach((button) => { button.onclick = () => openEditExpense(expenses.find((expense) => expense.id === button.dataset.editExpense)); }); container.querySelectorAll("[data-delete-expense]").forEach((button) => { button.onclick = () => handleDelete(expenses.find((expense) => expense.id === button.dataset.deleteExpense)); }); }
async function handleDelete(expense) { if (!expense || !window.confirm(`Delete ${expense.subcategory} for ${money(expense.amount)}?`)) return; try { await deleteExpense(expense.id); await refreshHome(); if (document.getElementById("trackPage").classList.contains("active")) await loadHistory(); } catch (error) { alert(error.message); } }
async function handleImport(event) { const file = event.target.files[0]; event.target.value = ""; if (!file) return; if (!window.XLSX) return alert("The spreadsheet importer is still loading. Try again."); try { const rows = XLSX.utils.sheet_to_json(XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }).Sheets[XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }).SheetNames[0]], { defval: "" }); pendingExpenses = rows.map((row) => ({ amount: Number(String(row.amount ?? row.Amount ?? row.AMOUNT ?? "").replace(/,/g, "")), category: ["Food", "Shopping", "Personal Care", "Transport", "Other"].includes(row.category ?? row.Category) ? (row.category ?? row.Category) : "Other", subcategory: String(row.subcategory ?? row.Subcategory ?? row.description ?? row.Description ?? "General"), expense_date: normalizeImportDate(row.expense_date ?? row.date ?? row.Date), raw_input: "Imported file" })).filter((expense) => expense.amount > 0 && expense.subcategory); if (!pendingExpenses.length) return alert("No valid rows found. Use amount, category, subcategory, and date columns."); renderReview(); showModal("reviewModal"); } catch (error) { alert("Could not read this CSV or Excel file."); } }
function normalizeImportDate(value) { if (!value) return ""; if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10); const text = String(value).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const parsed = new Date(text); return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10); }
function openEditExpense(expense) { if (!expense) return; editingExpenseId = expense.id; editingGroupShare = Boolean(expense.shared_as_group); editingSharedParticipantCount = expense.shared_participant_count || null; document.getElementById("editAmount").value = expense.amount; document.getElementById("editCategory").value = expense.category; document.getElementById("editSubcategory").value = expense.subcategory; document.getElementById("editPaymentType").value = expense.payment_type === "credit" ? "credit" : "debit"; document.getElementById("editDate").value = expenseDate(expense); document.getElementById("editIsShared").checked = Boolean(expense.is_shared); document.getElementById("editGroupName").value = expense.group_name || ""; document.getElementById("editShares").value = editingGroupShare ? String(expense.shared_with?.[0]?.amount || "") : formatShares(expense.shared_with || []); document.getElementById("editShares").closest("label").childNodes[0].textContent = editingGroupShare ? "Group total owed" : "People and amounts"; showModal("editExpenseModal"); }
async function handleEditSave() { const amount = Number(document.getElementById("editAmount").value); const subcategory = document.getElementById("editSubcategory").value.trim(); const expenseDateValue = document.getElementById("editDate").value; const is_shared = document.getElementById("editIsShared").checked; if (!editingExpenseId || !amount || amount <= 0 || !subcategory || !expenseDateValue) return alert("Complete all expense fields."); let shared_with; const group_name = document.getElementById("editGroupName").value.trim(); try { if (is_shared && editingGroupShare) { const owed = editingSharedParticipantCount ? Math.round(amount * (editingSharedParticipantCount - 1) / editingSharedParticipantCount * 100) / 100 : Number(document.getElementById("editShares").value); if (!group_name || !owed || owed <= 0) throw new Error("Enter a group name and positive amount owed."); shared_with = [{ name: group_name, amount: owed }]; } else { shared_with = is_shared ? parseShares(document.getElementById("editShares").value) : []; if (is_shared && !shared_with.length) throw new Error("Add at least one person and amount."); } if (shared_with.reduce((sum, share) => sum + share.amount, 0) > amount + 0.001) throw new Error("Shared amounts cannot exceed the total expense."); } catch (error) { alert(error.message); return; } const button = document.getElementById("saveEditedExpense"); button.disabled = true; button.textContent = "Updating..."; try { await updateExpense(editingExpenseId, { amount, category: document.getElementById("editCategory").value, subcategory, payment_type: document.getElementById("editPaymentType").value, expense_date: expenseDateValue, is_shared, shared_as_group: is_shared && editingGroupShare, shared_participant_count: is_shared && editingGroupShare ? editingSharedParticipantCount : null, group_name: is_shared ? (group_name || null) : null, shared_with }); editingExpenseId = null; editingGroupShare = false; editingSharedParticipantCount = null; hideModal("editExpenseModal"); setLoading(true, "Updating expense..."); await refreshHome(); if (document.getElementById("trackPage").classList.contains("active")) await loadHistory(); } catch (error) { alert(error.message); } finally { setLoading(false); button.disabled = false; button.textContent = "Update expense"; } }
function categoryIcon(category) { return ({ Food: "🍴", Transport: "⛽", Shopping: "🛍", "Personal Care": "✦", Other: "₹" })[category] || "₹"; }
async function loadAnalysis(month = analysisMonth) { analysisMonth = month; document.getElementById("analysisMonth").value = month; const data = await getAnalysis(month); const budgetSet = data.budget_set; document.getElementById("remaining").textContent = budgetSet ? money(data.remaining) : "Not set"; document.getElementById("monthSpent").textContent = money(data.spent); document.getElementById("monthBudget").textContent = budgetSet ? money(data.budget) : "Not set"; document.getElementById("analysisSpent").textContent = money(data.spent); document.getElementById("analysisRemaining").textContent = budgetSet ? money(data.remaining) : "Not set"; document.getElementById("analysisCashPaid").textContent = money(data.cash_paid); document.getElementById("analysisOutstanding").textContent = money(data.outstanding_this_month); document.getElementById("analysisTotalOwed").textContent = money(data.outstanding_total); document.getElementById("analysisDebitPaid").textContent = money(data.payment_types.debit); document.getElementById("analysisDirectDebit").textContent = money(data.personal_payment_types.debit); document.getElementById("analysisCreditPaid").textContent = money(data.payment_types.credit); document.getElementById("analysisCreditPersonal").textContent = money(data.personal_payment_types.credit); document.getElementById("budgetProgress").style.width = `${budgetSet && data.budget ? Math.min(data.spent / data.budget * 100, 100) : 0}%`; document.getElementById("categoryBreakdown").innerHTML = Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([category, amount]) => `<div class="category-row"><span>${categoryIcon(category)} ${category}</span><strong>${money(amount)}</strong></div>`).join(""); renderBalances(data); }
function renderBalances(data) {
  const people = (data.people || []).filter((person) => person.outstanding > 0);
  const groups = (data.groups || []).filter((group) => group.outstanding > 0);
  const peopleContainer = document.getElementById("peopleBalances");
  const groupsContainer = document.getElementById("groupBalances");
  const groupNames = new Set(groups.map((group) => group.name.trim().toLocaleLowerCase()));
  const individualPeople = people.filter((person) => !groupNames.has(person.name.trim().toLocaleLowerCase()));
  peopleContainer.innerHTML = individualPeople.length ? individualPeople.map((person) => `<div class="balance-row person-balance-row"><div><strong>${escapeHtml(person.name)}</strong><small>${person.expenses.filter((expense) => expense.outstanding > 0).length} pending ${person.expenses.filter((expense) => expense.outstanding > 0).length === 1 ? "expense" : "expenses"}</small></div><strong>${money(person.outstanding)}</strong><button class="small-action" data-record-payment="${escapeAttribute(person.name)}">Received</button><button class="small-action" data-settle-person="${escapeAttribute(person.name)}">Settle all</button></div>`).join("") : `<div class="empty-state"><p>No individual balances.</p></div>`;
  groupsContainer.innerHTML = groups.length ? groups.map((group) => `<div class="balance-row"><div><strong>${escapeHtml(group.name)}</strong><small>${group.expenses.filter((expense) => expense.outstanding > 0).length} pending shares</small></div><strong>${money(group.outstanding)}</strong><button class="small-action" data-record-group-payment="${escapeAttribute(group.name)}">Received</button><button class="small-action" data-group-pdf="${escapeAttribute(group.name)}">PDF</button></div>`).join("") : `<div class="empty-state"><p>No group balances yet.</p></div>`;
  peopleContainer.querySelectorAll("[data-record-payment]").forEach((button) => { button.onclick = () => openSettlement(people.find((person) => person.name === button.dataset.recordPayment)); });
  peopleContainer.querySelectorAll("[data-settle-person]").forEach((button) => { button.onclick = () => settlePersonBalance(people.find((person) => person.name === button.dataset.settlePerson)); });
  groupsContainer.querySelectorAll("[data-record-group-payment]").forEach((button) => { button.onclick = () => openSettlement(people.find((person) => person.name.trim().toLocaleLowerCase() === button.dataset.recordGroupPayment.trim().toLocaleLowerCase())); });
  groupsContainer.querySelectorAll("[data-group-pdf]").forEach((button) => { button.onclick = () => createStatementPdf("group", groups.find((group) => group.name === button.dataset.groupPdf)); });
}
function openSettlement(person) { if (!person) return; document.getElementById("settlementTitle").textContent = `Payment from ${person.name}`; document.getElementById("settlementBalance").textContent = `${money(person.outstanding)} remaining`; document.getElementById("settlementAmount").value = ""; document.getElementById("settlementAmount").max = person.outstanding; document.getElementById("settlementAmount").step = "0.01"; document.getElementById("settlementDate").value = todayKey(); document.getElementById("saveSettlement").dataset.personName = person.name; showModal("settlementModal"); }
async function handleSettlementSave() { const button = document.getElementById("saveSettlement"); const person_name = button.dataset.personName; const amount = Number(document.getElementById("settlementAmount").value); const settlement_date = document.getElementById("settlementDate").value; if (!person_name || !Number.isFinite(amount) || amount <= 0 || !settlement_date) return alert("Enter an amount greater than zero and a valid date received."); button.disabled = true; button.textContent = "Recording..."; try { await createSettlement({ person_name, amount, settlement_date }); hideModal("settlementModal"); await refreshHome(); } catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = "Record payment"; } }
async function settlePersonBalance(person) {
  if (!person || person.outstanding <= 0) return;
  if (!window.confirm(`Close ${person.name}'s full outstanding balance of ${money(person.outstanding)}?`)) return;
  try {
    await createSettlement({ person_name: person.name, amount: person.outstanding, settlement_date: todayKey() });
    await refreshHome();
  } catch (error) {
    alert(error.message);
  }
}
function setupVoice() { const button = document.getElementById("voiceButton"); const status = document.getElementById("voiceStatus"); const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!Recognition) { button.disabled = true; button.title = "Voice input is not supported in this browser"; status.textContent = "Voice input is not supported in this browser."; status.classList.add("voice-error"); return; } const recognition = new Recognition(); recognition.lang = "en-IN"; recognition.interimResults = false; recognition.maxAlternatives = 1; button.onclick = async () => { if (button.classList.contains("listening")) { recognition.stop(); return; } if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) { status.textContent = "Voice needs HTTPS on a phone. Open the deployed Firebase Hosting URL."; status.classList.add("voice-error"); return; } try { if (navigator.mediaDevices?.getUserMedia) { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); } recognition.start(); button.classList.add("listening"); button.textContent = "■ Stop"; button.title = "Stop listening"; status.textContent = "Listening... speak now"; status.classList.remove("voice-error"); } catch (error) { if (error.name !== "InvalidStateError") { status.textContent = error.name === "NotAllowedError" ? "Microphone access is blocked for this site. Allow it, then reload the page." : "Unable to access the microphone. Check your browser and site settings."; status.classList.add("voice-error"); } } }; recognition.onstart = () => { button.classList.add("listening"); status.textContent = "Listening... speak now"; }; recognition.onresult = (event) => { document.getElementById("expenseInput").value = event.results[0][0].transcript; status.textContent = "Got it. Review the text, then tap Add expenses."; }; recognition.onerror = (event) => { const message = event.error === "not-allowed" || event.error === "service-not-allowed" ? "Voice was blocked by this browser or site. Use HTTPS and allow microphone access." : event.error === "no-speech" ? "I did not hear anything. Tap Speak and try again." : "Voice input stopped. Tap Speak to try again."; status.textContent = message; status.classList.add("voice-error"); button.classList.remove("listening"); button.textContent = "🎙 Speak"; button.title = "Start voice input"; }; recognition.onend = () => { button.classList.remove("listening"); button.textContent = "🎙 Speak"; button.title = "Start voice input"; }; }
function openReportModal() { const current = analysisMonth; document.getElementById("reportMonth").value = current; document.getElementById("reportYear").value = current.slice(0, 4); document.getElementById("reportStart").value = `${current}-01`; document.getElementById("reportEnd").value = current === monthKey() ? new Date().toISOString().slice(0, 10) : new Date(new Date(`${current}-01T00:00:00`).getFullYear(), new Date(`${current}-01T00:00:00`).getMonth() + 1, 0).toISOString().slice(0, 10); updateReportFields(); showModal("reportModal"); }
function updateReportFields() { const period = document.getElementById("reportPeriod").value; document.getElementById("reportMonthField").style.display = period === "monthly" ? "grid" : "none"; document.getElementById("reportYearField").style.display = period === "yearly" ? "grid" : "none"; document.getElementById("reportRangeFields").style.display = period === "custom" ? "grid" : "none"; }
function reportDates() { const period = document.getElementById("reportPeriod").value; if (period === "monthly") { const month = document.getElementById("reportMonth").value; const start = `${month}-01`; const end = new Date(new Date(`${start}T00:00:00`).getFullYear(), new Date(`${start}T00:00:00`).getMonth() + 1, 0).toISOString().slice(0, 10); return { period, start_date: start, end_date: end }; } if (period === "yearly") { const year = document.getElementById("reportYear").value; return { period, start_date: `${year}-01-01`, end_date: `${year}-12-31` }; } return { period, start_date: document.getElementById("reportStart").value, end_date: document.getElementById("reportEnd").value }; }
async function handleReport() { const button = document.getElementById("generateReport"); const dates = reportDates(); if (!dates.start_date || !dates.end_date || dates.end_date < dates.start_date) return alert("Choose a valid date range."); button.disabled = true; button.textContent = "Building report..."; try { const report = await generateReport(dates); createReportPdf(report); hideModal("reportModal"); } catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = "Create PDF report"; } }
function createReportPdf(report) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const left = 18;
  let y = 18;
  const width = pdf.internal.pageSize.getWidth() - left * 2;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const settlementSummary = report.shared_settlement_summary || {};
  const addSection = (title) => {
    if (y > pageHeight - 25) { pdf.addPage(); y = 18; }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(25, 77, 56);
    pdf.text(title, left, y);
    y += 8;
  };
  const addDetail = (label, value) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(80, 90, 82);
    pdf.text(label, left, y);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(25, 35, 29);
    pdf.text(String(value), left + width, y, { align: "right" });
    y += 6;
  };

  pdf.setFillColor(25, 77, 56);
  pdf.roundedRect(left, y - 8, width, 29, 4, 4, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.setTextColor(255, 255, 255);
  pdf.text("Financial report", left + 7, y + 2);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`${report.start_date} to ${report.end_date}  |  Prepared ${todayKey()}`, left + 7, y + 12);
  y += 31;

  addSection("At a glance");
  const cards = [
    ["Personal spending", pdfMoney(report.total)],
    ["Transactions", String(report.expense_count)],
    ["Paid upfront", pdfMoney(report.cash_paid)],
    ["Shared with others", pdfMoney(report.shared_paid)],
    ["Debit / UPI charges", pdfMoney(report.payment_types.debit)],
    ["Credit-card charges", pdfMoney(report.payment_types.credit)],
    ["Your debit / UPI share", pdfMoney(report.personal_payment_types.debit)],
    ["Your credit-card share", pdfMoney(report.personal_payment_types.credit)],
  ];
  const cardGap = 5;
  const cardWidth = (width - cardGap) / 2;
  cards.forEach(([label, value], index) => {
    const column = index % 2;
    const x = left + column * (cardWidth + cardGap);
    if (column === 0 && y + 19 > pageHeight - 15) { pdf.addPage(); y = 18; }
    pdf.setFillColor(index < 2 ? 233 : 244, index < 2 ? 238 : 247, index < 2 ? 231 : 244);
    pdf.roundedRect(x, y - 5, cardWidth, 18, 2, 2, "F");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 110, 102);
    pdf.text(label, x + 3, y);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(25, 35, 29);
    pdf.text(value, x + cardWidth - 3, y + 7, { align: "right" });
    if (column === 1 || index === cards.length - 1) y += 21;
  });

  addSection("Shared expenses and repayments");
  addDetail("Shares owed on expenses in this period", pdfMoney(settlementSummary.owed_for_period_expenses || 0));
  addDetail("Settled against those expenses (all dates)", pdfMoney(settlementSummary.settled_for_period_expenses || 0));
  addDetail("Still due on those expenses", pdfMoney(settlementSummary.currently_due_for_period_expenses || 0));
  addDetail("Payments received during this period", pdfMoney(settlementSummary.received_during_period || 0));
  addDetail("All-time outstanding balance", pdfMoney(report.outstanding_total || 0));

  y += 4;
  y = drawPdfBars(pdf, "Personal spending by category", report.categories, left, y, width);
  y += 6;
  y = drawPdfBars(pdf, "Monthly personal spending", report.monthly, left, y, width);
  y += 6;
  y = writePdfList(pdf, "Summary", [report.insights.executive_summary], left, y, width);
  y += 3;
  y = writePdfList(pdf, "Key insights", report.insights.insights, left, y, width);
  y += 3;
  y = writePdfList(pdf, "Recommendations", report.insights.recommendations, left, y, width);

  const settlementRows = (report.settlements || []).map((settlement) => {
    const allocationText = settlement.allocations.length
      ? settlement.allocations.map((allocation) => `${allocation.expense_date} · ${allocation.description}: ${pdfMoney(allocation.amount)}`).join("\n")
      : "Not applied to an outstanding share";
    const unallocated = Number(settlement.unallocated_amount || 0);
    return [
      settlement.settlement_date,
      settlement.person_name,
      pdfMoney(settlement.amount),
      unallocated > 0 ? `${allocationText}\nUnapplied: ${pdfMoney(unallocated)}` : allocationText,
    ];
  });
  drawPdfReportTable(
    pdf,
    "Payments received",
    `Receipts recorded between ${report.start_date} and ${report.end_date}; allocations show which shared expenses each payment reduced.`,
    [
      { label: "RECEIVED", width: 31 },
      { label: "PERSON", width: 36 },
      { label: "AMOUNT", width: 30, numeric: true },
      { label: "APPLIED TO SHARED EXPENSES", width: 174 },
    ],
    settlementRows,
  );

  const sharedRows = (report.shared_expenses || []).map((expense) => [
    expense.expense_date,
    expense.person_name,
    `${expense.description}${expense.group_name ? ` (${expense.group_name})` : ""}`,
    pdfMoney(expense.share_amount),
    pdfMoney(expense.repaid_amount),
    pdfMoney(expense.outstanding),
    expense.settlement_allocations.length
      ? expense.settlement_allocations.map((allocation) => `${allocation.settlement_date}: ${pdfMoney(allocation.amount)}`).join("\n")
      : "No payments applied",
  ]);
  drawPdfReportTable(
    pdf,
    "Shared expense detail",
    "Each row is one person's share of an expense dated in the selected period. Settled and due values reflect the recorded payment history.",
    [
      { label: "EXPENSE DATE", width: 27 },
      { label: "PERSON", width: 29 },
      { label: "EXPENSE / GROUP", width: 58 },
      { label: "SHARE", width: 27, numeric: true },
      { label: "SETTLED", width: 27, numeric: true },
      { label: "DUE NOW", width: 27, numeric: true },
      { label: "PAYMENT RECORDS", width: 76 },
    ],
    sharedRows,
  );
  drawPdfTransactions(pdf, report.transactions || []);
  pdf.save(`simple-finance-report-${report.start_date}-to-${report.end_date}.pdf`);
}
function drawPdfReportTable(pdf, title, subtitle, columns, rows) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageLeft = 10;
  const bottom = pageHeight - 12;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  let pageNumber = 0;
  let y = 0;
  const drawHeader = () => {
    pageNumber += 1;
    pdf.addPage("a4", "landscape");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(25, 77, 56);
    pdf.text(title, pageLeft, 15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 110, 102);
    const subtitleLines = pdf.splitTextToSize(subtitle, pageWidth - 2 * pageLeft - 20);
    pdf.text(subtitleLines, pageLeft, 21);
    pdf.setFontSize(8);
    pdf.text(`Page ${pageNumber}`, pageWidth - pageLeft, 15, { align: "right" });
    y = 25 + subtitleLines.length * 4 + 5;
    pdf.setFillColor(25, 77, 56);
    pdf.roundedRect(pageLeft, y - 4, tableWidth, 9, 2, 2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(255, 255, 255);
    let x = pageLeft + 2;
    columns.forEach((column) => {
      pdf.text(column.label, x, y, { maxWidth: column.width - 4 });
      x += column.width;
    });
    pdf.setTextColor(25, 35, 29);
    y += 7;
  };

  drawHeader();
  if (!rows.length) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 110, 102);
    pdf.text("No records for this period.", pageLeft + 2, y + 2);
    return;
  }
  rows.forEach((row, rowIndex) => {
    const wrapped = row.map((value, index) => pdf.splitTextToSize(String(value || "-"), columns[index].width - 4));
    const lineCount = Math.max(...wrapped.map((lines) => lines.length), 1);
    const rowHeight = lineCount * 4 + 4;
    if (y + rowHeight > bottom) drawHeader();
    if (rowIndex % 2 === 0) {
      pdf.setFillColor(244, 247, 244);
      pdf.rect(pageLeft, y - 3, tableWidth, rowHeight, "F");
    }
    let x = pageLeft + 2;
    wrapped.forEach((lines, index) => {
      const column = columns[index];
      pdf.setFont("helvetica", column.numeric ? "bold" : "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(25, 35, 29);
      pdf.text(lines, column.numeric ? x + column.width - 3 : x, y, column.numeric ? { align: "right" } : undefined);
      x += column.width;
    });
    y += rowHeight;
    pdf.setDrawColor(218, 225, 218);
    pdf.line(pageLeft, y - 2, pageLeft + tableWidth, y - 2);
  });
}
function drawPdfTransactions(pdf, transactions) {
  pdf.addPage("a4", "landscape");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageLeft = 12;
  const bottom = pageHeight - 12;
  const rowLineHeight = 4.5;
  const columns = [
    { label: "DATE", width: 24 },
    { label: "ORIGINAL ENTRY", width: 123 },
    { label: "CATEGORY / ITEM", width: 54 },
    { label: "PAID USING", width: 34 },
    { label: "AMOUNT (INR)", width: 30, numeric: true },
  ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const sortedTransactions = [...transactions].sort((a, b) => a.expense_date.localeCompare(b.expense_date));
  let pageNumber = pdf.internal.getNumberOfPages();
  let y = 0;
  const drawPageHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(25, 35, 29);
    pdf.text("Transaction details", pageLeft, 15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 110, 102);
    pdf.text(`${sortedTransactions.length} transactions | Original entry text shown`, pageLeft, 21);
    pdf.text(`Page ${pageNumber}`, pageWidth - pageLeft, 15, { align: "right" });
    y = 31;
  };
  const drawHeader = () => {
    pdf.setFillColor(25, 77, 56);
    pdf.roundedRect(pageLeft, y - 5, tableWidth, 10, 2, 2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    let x = pageLeft + 2;
    columns.forEach((column) => {
      pdf.text(column.label, x, y, { maxWidth: column.width - 3 });
      x += column.width;
    });
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(25, 35, 29);
    y += 10;
  };
  drawPageHeader();
  drawHeader();
  sortedTransactions.forEach((transaction, rowIndex) => {
    const formattedDate = transaction.expense_date
      ? new Date(`${transaction.expense_date}T00:00:00`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      : "-";
    const values = [
      formattedDate,
      transaction.description || transaction.subcategory || "Expense",
      `${transaction.category || "Other"}\n${transaction.subcategory || "Expense"}`,
      transaction.payment_type === "credit" ? "Credit card" : "Debit / UPI",
      pdfMoney(transaction.amount),
    ];
    pdf.setFontSize(9);
    const wrapped = values.map((value, index) => pdf.splitTextToSize(String(value || "-"), columns[index].width - 5));
    const maxLinesPerPage = Math.floor((bottom - 42) / rowLineHeight);
    const rowSegments = Math.ceil(Math.max(...wrapped.map((lines) => lines.length)) / maxLinesPerPage);
    for (let segment = 0; segment < rowSegments; segment += 1) {
      const start = segment * maxLinesPerPage;
      const segmentValues = wrapped.map((lines) => lines.slice(start, start + maxLinesPerPage));
      const lineCount = Math.max(...segmentValues.map((lines) => lines.length), 1);
      const rowHeight = lineCount * rowLineHeight + 5;
      if (y + rowHeight > bottom) {
        pdf.addPage("a4", "landscape");
        pageNumber += 1;
        drawPageHeader();
        drawHeader();
      }
      if (rowIndex % 2 === 0) {
        pdf.setFillColor(244, 247, 244);
        pdf.rect(pageLeft, y - 4, tableWidth, rowHeight, "F");
      }
      let x = pageLeft + 2;
      segmentValues.forEach((lines, index) => {
        const column = columns[index];
        const shownLines = segment > 0 && index === 0 ? ["(continued)"] : lines;
        if (shownLines.length) {
          pdf.setFont("helvetica", index === 4 ? "bold" : "normal");
          pdf.setFontSize(9);
          pdf.setTextColor(25, 35, 29);
          pdf.text(
            shownLines,
            column.numeric ? x + column.width - 5 : x,
            y + 1,
            column.numeric ? { align: "right" } : undefined,
          );
        }
        x += column.width;
      });
      y += rowHeight;
      pdf.setDrawColor(218, 225, 218);
      pdf.line(pageLeft, y - 2, pageLeft + tableWidth, y - 2);
    }
  });
  if (!sortedTransactions.length) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(100, 110, 102);
    pdf.text("No transactions in this period.", pageLeft + 2, y + 2);
  }
}
function createStatementPdf(type, entry) {
  if (!entry) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const personStatement = type === "person";
  const title = personStatement ? `Statement for ${entry.name}` : `Group statement: ${entry.name}`;
  const columns = personStatement
    ? [{ label: "Date", width: 22 }, { label: "Expense", width: 40 }, { label: "Group", width: 30 }, { label: "Total", width: 23, numeric: true }, { label: "Share", width: 22, numeric: true }, { label: "Paid", width: 22, numeric: true }, { label: "Due", width: 23, numeric: true }]
    : [{ label: "Date", width: 22 }, { label: "Person", width: 25 }, { label: "Expense", width: 38 }, { label: "Total", width: 23, numeric: true }, { label: "Share", width: 22, numeric: true }, { label: "Paid", width: 23, numeric: true }, { label: "Due", width: 29, numeric: true }];
  const rows = entry.expenses.filter((expense) => expense.outstanding > 0).sort((a, b) => a.expense_date.localeCompare(b.expense_date));
  const left = 13;
  let y = 18;
  pdf.setTextColor(25, 35, 29);
  pdf.setFontSize(18);
  pdf.text("Simple Finance", left, y);
  y += 8;
  pdf.setFontSize(13);
  pdf.text(title, left, y);
  y += 7;
  pdf.setFontSize(9);
  pdf.setTextColor(100, 110, 102);
  pdf.text(`Prepared ${new Date().toLocaleDateString("en-IN")} | Amounts in INR`, left, y);
  y += 8;
  pdf.setFontSize(9);
  pdf.setTextColor(25, 35, 29);
  pdf.text(`Total shares: ${pdfMoney(entry.total_owed)}`, left, y);
  pdf.text(`Received: ${pdfMoney(entry.total_repaid)}`, left + 65, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(`Still due: ${pdfMoney(entry.outstanding)}`, left + 125, y);
  pdf.setFont("helvetica", "normal");
  y += 9;

  const drawHeader = () => {
    pdf.setFillColor(233, 238, 231);
    pdf.rect(left, y - 4, columns.reduce((sum, column) => sum + column.width, 0), 8, "F");
    let x = left + 1;
    pdf.setFont("helvetica", "bold");
    columns.forEach((column) => { pdf.text(column.label, x, y); x += column.width; });
    pdf.setFont("helvetica", "normal");
    y += 7;
  };
  drawHeader();
  rows.forEach((row) => {
    const values = personStatement
      ? [row.expense_date, row.description, row.group_name || "-", pdfMoney(row.expense_amount), pdfMoney(row.share_amount), pdfMoney(row.repaid_amount), pdfMoney(row.outstanding)]
      : [row.expense_date, row.person_name, row.description, pdfMoney(row.expense_amount), pdfMoney(row.share_amount), pdfMoney(row.repaid_amount), pdfMoney(row.outstanding)];
    const wrapped = values.map((value, index) => pdf.splitTextToSize(String(value || "-"), columns[index].width - 2));
    const rowHeight = Math.max(...wrapped.map((lines) => lines.length)) * 4 + 3;
    if (y + rowHeight > 278) { pdf.addPage(); y = 18; drawHeader(); }
    let x = left + 1;
    wrapped.forEach((lines, index) => {
      const column = columns[index];
      const textX = column.numeric ? x + column.width - 2 : x;
      pdf.text(lines, textX, y, column.numeric ? { align: "right" } : undefined);
      x += column.width;
    });
    y += rowHeight;
    pdf.setDrawColor(225, 230, 223);
    pdf.line(left, y - 2, left + columns.reduce((sum, column) => sum + column.width, 0), y - 2);
  });
  pdf.save(`${personStatement ? "person" : "group"}-statement-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`);
}
function drawPdfBars(pdf, title, values, left, y, width) { if (y > 245) { pdf.addPage(); y = 18; } pdf.setFontSize(14); pdf.setTextColor(25, 35, 29); pdf.text(title, left, y); y += 8; const entries = Object.entries(values); const max = Math.max(...entries.map((entry) => Number(entry[1])), 1); entries.forEach(([label, value]) => { pdf.setFontSize(9); pdf.setTextColor(90, 100, 92); pdf.text(label, left, y); pdf.setFillColor(220, 233, 223); pdf.rect(left + 45, y - 4, width - 60, 5, "F"); pdf.setFillColor(25, 77, 56); pdf.rect(left + 45, y - 4, (width - 60) * Number(value) / max, 5, "F"); pdf.text(pdfMoney(value), left + width - 13, y, { align: "right" }); y += 8; }); return y; }
function writePdfList(pdf, title, items, left, y, width) { if (y > 245) { pdf.addPage(); y = 18; } pdf.setFontSize(14); pdf.setTextColor(25, 35, 29); pdf.text(title, left, y); y += 8; pdf.setFontSize(10); items.forEach((item) => { const lines = pdf.splitTextToSize(`• ${item}`, width); if (y + lines.length * 5 > 280) { pdf.addPage(); y = 18; } pdf.text(lines, left, y); y += lines.length * 5 + 3; }); return y; }
async function loadHistory() {
  document.getElementById("trackMonth").textContent = monthLabel(trackMonth);
  document.getElementById("previousMonth").disabled = trackMonth <= previousMonthKey();
  document.getElementById("nextMonth").disabled = trackMonth >= monthKey();
  document.getElementById("activityMonthLabel").textContent = `Activities for ${monthLabel(trackMonth)}`;
  if (trackView === "activities") return loadActivities();
  const expenses = await getExpenses();
  renderTransactions(document.getElementById("expenseHistory"), expenses.filter((expense) => expenseDate(expense).startsWith(trackMonth)));
}
async function loadActivities() {
  const result = await getActivities(trackMonth);
  renderActivities(result.activities || []);
}
function renderActivities(activities) {
  const container = document.getElementById("activityList");
  if (!activities.length) {
    container.innerHTML = `<div class="activity-empty"><strong>No activities for ${escapeHtml(monthLabel(trackMonth))}</strong><span>Add an activity above to start tracking this month.</span></div>`;
    return;
  }

  const [year, month] = trackMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayKey();
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  container.innerHTML = activities.map((activity) => {
    const completedDays = new Set(activity.completed_days || []);
    const calendarCells = weekdays.map((day) => `<span class="activity-weekday" aria-hidden="true">${day}</span>`).join("");
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const blanks = Array.from({ length: firstWeekday }, () => '<span class="activity-day-spacer" aria-hidden="true"></span>').join("");
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const dayNumber = index + 1;
      const day = `${trackMonth}-${String(dayNumber).padStart(2, "0")}`;
      const completed = completedDays.has(day);
      const disabled = day > today || day < activityCutoffKey();
      const label = `${dateLabel(day)}${completed ? ", completed" : ""}`;
      return `<button class="activity-day${completed ? " completed" : ""}" type="button" data-activity-day="${day}" data-activity-id="${escapeAttribute(activity.id)}" aria-label="${escapeAttribute(label)}" aria-pressed="${completed}"${disabled ? " disabled" : ""}>${completed ? "&#10003;" : dayNumber}</button>`;
    }).join("");
    const monthCount = completedDays.size;
    return `<article class="activity-card"><div class="activity-card-heading"><div><h3>${escapeHtml(activity.name)}</h3><span>${monthCount} ${monthCount === 1 ? "day" : "days"} completed in ${escapeHtml(monthLabel(trackMonth))}</span></div><button class="activity-delete" type="button" data-delete-activity="${escapeAttribute(activity.id)}" aria-label="Delete ${escapeAttribute(activity.name)}">Delete</button></div><div class="activity-calendar" aria-label="${escapeAttribute(monthLabel(trackMonth))} calendar">${calendarCells}${blanks}${days}</div></article>`;
  }).join("");
}
async function handleActivityCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = document.getElementById("activityName");
  const button = form.querySelector("button[type=submit]");
  const name = input.value.trim();
  if (!name) return;
  button.disabled = true;
  try {
    await createActivity(name, trackMonth);
    form.reset();
    await loadActivities();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}
async function handleActivityAction(event) {
  const dayButton = event.target.closest("[data-activity-day]");
  if (dayButton) {
    dayButton.disabled = true;
    try {
      await setActivityDay(dayButton.dataset.activityId, dayButton.dataset.activityDay, dayButton.getAttribute("aria-pressed") !== "true");
      await loadActivities();
    } catch (error) {
      alert(error.message);
      dayButton.disabled = false;
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-activity]");
  if (!deleteButton || !window.confirm("Delete this activity and its tracking history?")) return;
  deleteButton.disabled = true;
  try {
    await deleteActivity(deleteButton.dataset.deleteActivity);
    await loadActivities();
  } catch (error) {
    alert(error.message);
    deleteButton.disabled = false;
  }
}
async function changeTrackMonth(offset) {
  const [year, month] = trackMonth.split("-").map(Number);
  const current = new Date(year, month - 1 + offset, 1);
  const nextMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
  if (nextMonth < previousMonthKey() || nextMonth > monthKey()) return;
  trackMonth = nextMonth;
  try { await loadHistory(); } catch (error) { alert(error.message); }
}
async function downloadActivityProgress() {
  const button = document.getElementById("downloadActivityProgress");
  button.disabled = true;
  try {
    if (!window.jspdf?.jsPDF) throw new Error("The PDF generator is unavailable. Reload the page and try again.");
    const report = await getActivityProgress();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const left = 16;
    const width = pageWidth - left * 2;
    const bottom = pageHeight - 15;
    let y = 20;
    const section = (title, continued = false) => {
      if (y + 22 > bottom) { pdf.addPage(); y = 18; }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.setTextColor(25, 77, 56);
      pdf.text(continued ? `${title} (continued)` : title, left, y);
      y += 8;
    };
    const drawTable = (title, columns, rows) => {
      section(title);
      if (!rows.length) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(100, 110, 102);
        pdf.text("No activity history for this section.", left, y);
        y += 9;
        return;
      }
      const drawHeader = (continued) => {
        if (continued) {
          pdf.addPage();
          y = 18;
          section(title, true);
        }
        pdf.setFillColor(25, 77, 56);
        pdf.roundedRect(left, y - 4, width, 8, 2, 2, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        let x = left + 2;
        columns.forEach((column) => {
          pdf.text(column.label, x, y, { maxWidth: column.width - 4 });
          x += column.width;
        });
        y += 7;
      };
      drawHeader(false);
      rows.forEach((row, index) => {
        const wrapped = row.map((value, cell) => pdf.splitTextToSize(String(value || "-"), columns[cell].width - 4));
        const rowHeight = Math.max(...wrapped.map((lines) => lines.length), 1) * 4 + 4;
        if (y + rowHeight > bottom) drawHeader(true);
        if (index % 2 === 0) {
          pdf.setFillColor(244, 247, 244);
          pdf.rect(left, y - 3, width, rowHeight, "F");
        }
        let x = left + 2;
        wrapped.forEach((lines, cell) => {
          pdf.setFont("helvetica", cell === 1 ? "bold" : "normal");
          pdf.setFontSize(8);
          pdf.setTextColor(35, 45, 38);
          pdf.text(lines, x, y);
          x += columns[cell].width;
        });
        y += rowHeight;
        pdf.setDrawColor(218, 225, 218);
        pdf.line(left, y - 2, left + width, y - 2);
      });
      y += 8;
    };

    pdf.setFillColor(25, 77, 56);
    pdf.roundedRect(left, y - 8, width, 30, 4, 4, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(19);
    pdf.setTextColor(255, 255, 255);
    pdf.text("Activity progress report", left + 7, y + 2);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Generated ${todayKey()}  |  Current and previous month`, left + 7, y + 12);
    y += 32;
    const current = monthKey();
    const previous = previousMonthKey();
    const lifetime = report.lifetime || [];
    const lifetimeDays = lifetime.reduce((total, entry) => total + entry.completed_days, 0);
    const currentMonthDays = (report.months?.[current] || []).reduce((total, entry) => total + entry.count, 0);
    section("Lifetime summary");
    pdf.setFillColor(233, 238, 231);
    pdf.roundedRect(left, y - 4, width, 18, 2, 2, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(25, 35, 29);
    pdf.text(`${lifetime.length} activities`, left + 4, y + 2);
    pdf.text(`${lifetimeDays} completed days`, left + width / 2, y + 2);
    pdf.text(`${currentMonthDays} days completed this month`, left + width - 4, y + 2, { align: "right" });
    y += 22;
    drawTable("Lifetime totals", [
      { label: "ACTIVITY", width: 94 },
      { label: "COMPLETED DAYS", width: 42 },
      { label: "ACTIVE MONTHS", width: 42 },
    ], lifetime.map((entry) => [
      entry.name,
      String(entry.completed_days),
      String(entry.active_months),
    ]));
    for (const month of [previous, current]) {
      const entries = report.months?.[month] || [];
      drawTable(`${monthLabel(month)} activity`, [
        { label: "ACTIVITY", width: 60 },
        { label: "DAYS COMPLETED", width: 30 },
        { label: "COMPLETED DATES", width: 88 },
      ], entries.map((entry) => [
        entry.name,
        String(entry.count),
        entry.completed_days.length
          ? entry.completed_days.map((day) => Number(day.slice(-2))).join(", ")
          : "No completed days",
      ]));
    }
    pdf.save(`activity-progress-${current}.pdf`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}
async function handleBudget() { const amount = Number(document.getElementById("budgetInput").value); if (!amount || amount <= 0) return alert("Enter a valid budget."); const button = document.getElementById("saveBudget"); button.disabled = true; button.textContent = "Saving..."; try { await setBudget(analysisMonth, amount); hideModal("budgetModal"); setLoading(true, "Updating budget..."); await loadAnalysis(analysisMonth); } catch (error) { alert(error.message); } finally { setLoading(false); button.disabled = false; button.textContent = "Save budget"; } }
