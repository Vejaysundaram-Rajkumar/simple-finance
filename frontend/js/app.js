import { logout, protectPage } from "./auth.js";
import { createSettlement, deleteExpense, generateReport, getAnalysis, getExpenses, getToday, parseExpenses, saveExpenses, setBudget, updateExpense } from "./api.js";

let pendingExpenses = [];
let editingExpenseId = null;
let editingGroupShare = false;
let editingSharedParticipantCount = null;
const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
const pdfMoney = (value) => `INR ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0)}`;
const monthKey = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; };
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
    if (button.dataset.page === "trackPage") { setLoading(true, "Loading expenses..."); try { await loadHistory(); } finally { setLoading(false); } }
  }));
  document.getElementById("previousMonth").onclick = () => changeTrackMonth(-1);
  document.getElementById("nextMonth").onclick = () => changeTrackMonth(1);
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
async function loadAnalysis(month = analysisMonth) { analysisMonth = month; document.getElementById("analysisMonth").value = month; const data = await getAnalysis(month); const budgetSet = data.budget_set; document.getElementById("remaining").textContent = budgetSet ? money(data.remaining) : "Not set"; document.getElementById("monthSpent").textContent = money(data.spent); document.getElementById("monthBudget").textContent = budgetSet ? money(data.budget) : "Not set"; document.getElementById("analysisSpent").textContent = money(data.spent); document.getElementById("analysisRemaining").textContent = budgetSet ? money(data.remaining) : "Not set"; document.getElementById("analysisCashPaid").textContent = money(data.cash_paid); document.getElementById("analysisOutstanding").textContent = money(data.outstanding_this_month); document.getElementById("analysisDebitPaid").textContent = money(data.payment_types.debit); document.getElementById("analysisDirectDebit").textContent = money(data.personal_payment_types.debit); document.getElementById("analysisCreditPaid").textContent = money(data.payment_types.credit); document.getElementById("analysisCreditPersonal").textContent = money(data.personal_payment_types.credit); document.getElementById("budgetProgress").style.width = `${budgetSet && data.budget ? Math.min(data.spent / data.budget * 100, 100) : 0}%`; document.getElementById("categoryBreakdown").innerHTML = Object.entries(data.categories).sort((a, b) => b[1] - a[1]).map(([category, amount]) => `<div class="category-row"><span>${categoryIcon(category)} ${category}</span><strong>${money(amount)}</strong></div>`).join(""); renderBalances(data); }
function renderBalances(data) {
  const people = (data.people || []).filter((person) => person.outstanding > 0);
  const groups = (data.groups || []).filter((group) => group.outstanding > 0);
  const peopleContainer = document.getElementById("peopleBalances");
  const groupsContainer = document.getElementById("groupBalances");
  const groupNames = new Set(groups.map((group) => group.name.trim().toLocaleLowerCase()));
  const individualPeople = people.filter((person) => !groupNames.has(person.name.trim().toLocaleLowerCase()));
  peopleContainer.innerHTML = individualPeople.length ? individualPeople.map((person) => `<div class="balance-row person-balance-row"><div><strong>${escapeHtml(person.name)}</strong><small>${person.expenses.filter((expense) => expense.outstanding > 0).length} pending ${person.expenses.filter((expense) => expense.outstanding > 0).length === 1 ? "expense" : "expenses"}</small></div><strong>${money(person.outstanding)}</strong><button class="small-action" data-record-payment="${escapeAttribute(person.name)}">Received</button></div>`).join("") : `<div class="empty-state"><p>No individual balances.</p></div>`;
  groupsContainer.innerHTML = groups.length ? groups.map((group) => `<div class="balance-row"><div><strong>${escapeHtml(group.name)}</strong><small>${group.expenses.filter((expense) => expense.outstanding > 0).length} pending shares</small></div><strong>${money(group.outstanding)}</strong><button class="small-action" data-record-group-payment="${escapeAttribute(group.name)}">Received</button><button class="small-action" data-group-pdf="${escapeAttribute(group.name)}">PDF</button></div>`).join("") : `<div class="empty-state"><p>No group balances yet.</p></div>`;
  peopleContainer.querySelectorAll("[data-record-payment]").forEach((button) => { button.onclick = () => openSettlement(people.find((person) => person.name === button.dataset.recordPayment)); });
  groupsContainer.querySelectorAll("[data-record-group-payment]").forEach((button) => { button.onclick = () => openSettlement(people.find((person) => person.name.trim().toLocaleLowerCase() === button.dataset.recordGroupPayment.trim().toLocaleLowerCase())); });
  groupsContainer.querySelectorAll("[data-group-pdf]").forEach((button) => { button.onclick = () => createStatementPdf("group", groups.find((group) => group.name === button.dataset.groupPdf)); });
}
function openSettlement(person) { if (!person) return; document.getElementById("settlementTitle").textContent = `Payment from ${person.name}`; document.getElementById("settlementAmount").value = ""; document.getElementById("settlementAmount").max = person.outstanding; document.getElementById("settlementDate").value = new Date().toISOString().slice(0, 10); document.getElementById("saveSettlement").dataset.personName = person.name; showModal("settlementModal"); }
async function handleSettlementSave() { const button = document.getElementById("saveSettlement"); const person_name = button.dataset.personName; const amount = Number(document.getElementById("settlementAmount").value); const settlement_date = document.getElementById("settlementDate").value; if (!person_name || !amount || amount <= 0 || !settlement_date) return alert("Enter the amount and date received."); button.disabled = true; button.textContent = "Recording..."; try { await createSettlement({ person_name, amount, settlement_date }); hideModal("settlementModal"); await refreshHome(); } catch (error) { alert(error.message); } finally { button.disabled = false; button.textContent = "Record payment"; } }
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
  const width = 174;
  pdf.setTextColor(25, 35, 29);
  pdf.setFontSize(20);
  pdf.text("Simple Finance", left, y);
  y += 9;
  pdf.setFontSize(11);
  pdf.setTextColor(124, 135, 126);
  pdf.text(`INR spending report | ${report.start_date} to ${report.end_date}`, left, y);
  y += 14;
  pdf.setTextColor(25, 35, 29);
  pdf.setFontSize(14);
  pdf.text("Overview", left, y);
  y += 8;
  pdf.setFontSize(10);
  pdf.text(`Personal spending: ${pdfMoney(report.total)}`, left, y);
  pdf.text(`Transactions: ${report.expense_count}`, left + 100, y);
  y += 7;
  pdf.text(`Paid upfront: ${pdfMoney(report.cash_paid)}`, left, y);
  pdf.text(`Shared with others: ${pdfMoney(report.shared_paid)}`, left + 92, y);
  y += 7;
  pdf.text(`Still owed to you: ${pdfMoney(report.outstanding_total)}`, left, y);
  pdf.text(`Debit / UPI total: ${pdfMoney(report.payment_types.debit)}`, left + 92, y);
  y += 7;
  pdf.text(`Credit card: ${pdfMoney(report.payment_types.credit)}`, left, y);
  y += 12;
  pdf.text(`Debit / UPI personal share: ${pdfMoney(report.personal_payment_types.debit)}`, left, y);
  pdf.text(`Credit-card personal share: ${pdfMoney(report.personal_payment_types.credit)}`, left + 92, y);
  y += 7;
  pdf.text(`Personal spending total: ${pdfMoney(report.personal_spending_total)}`, left, y);
  y += 12;
  y = drawPdfBars(pdf, "Personal spending by category", report.categories, left, y, width);
  y += 8;
  y = drawPdfBars(pdf, "Monthly personal spending", report.monthly, left, y, width);
  y += 8;
  y = writePdfList(pdf, "AI insights", report.insights.insights, left, y, width);
  y += 5;
  y = writePdfList(pdf, "Recommendations", report.insights.recommendations, left, y, width);
  y += 8;
  drawPdfTransactions(pdf, report.transactions || []);
  pdf.save(`simple-finance-report-${report.start_date}-to-${report.end_date}.pdf`);
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
async function loadHistory() { const expenses = await getExpenses(); renderTransactions(document.getElementById("expenseHistory"), expenses.filter((expense) => expenseDate(expense).startsWith(trackMonth))); document.getElementById("trackMonth").textContent = monthLabel(trackMonth); document.getElementById("nextMonth").disabled = trackMonth >= monthKey(); }
async function changeTrackMonth(offset) { const current = new Date(`${trackMonth}-01T00:00:00`); current.setMonth(current.getMonth() + offset); const nextMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`; if (nextMonth > monthKey()) return; trackMonth = nextMonth; await loadHistory(); }
async function handleBudget() { const amount = Number(document.getElementById("budgetInput").value); if (!amount || amount <= 0) return alert("Enter a valid budget."); const button = document.getElementById("saveBudget"); button.disabled = true; button.textContent = "Saving..."; try { await setBudget(analysisMonth, amount); hideModal("budgetModal"); setLoading(true, "Updating budget..."); await loadAnalysis(analysisMonth); } catch (error) { alert(error.message); } finally { setLoading(false); button.disabled = false; button.textContent = "Save budget"; } }
