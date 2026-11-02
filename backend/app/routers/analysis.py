from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.firebase import db
from app.models.schemas import ReportRequest
from app.services.gemini import generate_report_insights
from app.services.shared_expenses import get_shared_balances

router = APIRouter(prefix="/api/analysis", tags=["Analysis"])


def _expense_date(expense: dict) -> str:
    return str(expense.get("expense_date", ""))[:10]


def _payment_totals(expenses: list[dict]) -> tuple[dict[str, float], dict[str, float]]:
    totals = {"debit": 0.0, "credit": 0.0}
    personal_totals = {"debit": 0.0, "credit": 0.0}
    for expense in expenses:
        amount = float(expense.get("amount", 0))
        shared_amount = sum(float(share.get("amount", 0)) for share in expense.get("shared_with", []))
        personal_amount = max(round(amount - shared_amount, 2), 0) if expense.get("is_shared") else amount
        payment_type = expense.get("payment_type", "debit")
        if payment_type not in totals:
            payment_type = "debit"
        totals[payment_type] += amount
        personal_totals[payment_type] += personal_amount
    return (
        {key: round(value, 2) for key, value in totals.items()},
        {key: round(value, 2) for key, value in personal_totals.items()},
    )


@router.get("/{month}")
async def monthly_analysis(month: str, user=Depends(get_current_user)):
    categories = {"Food": 0, "Shopping": 0, "Personal Care": 0, "Transport": 0, "Other": 0}
    total = 0.0
    cash_paid = 0.0
    shared_paid = 0.0
    count = 0
    monthly_expenses = []
    uid = user["uid"]
    docs = db.collection("users").document(uid).collection("expenses").stream()
    for doc in docs:
        expense = doc.to_dict()
        if not expense.get("expense_date", "").startswith(month):
            continue
        monthly_expenses.append(expense)
        amount = float(expense.get("amount", 0))
        shared_amount = sum(float(share.get("amount", 0)) for share in expense.get("shared_with", []))
        personal_amount = max(round(amount - shared_amount, 2), 0) if expense.get("is_shared") else amount
        category = expense.get("category", "Other")
        total += personal_amount
        cash_paid += amount
        shared_paid += shared_amount
        count += 1
        categories[category] = categories.get(category, 0) + personal_amount

    budget_doc = db.collection("users").document(uid).collection("budgets").document(month).get()
    budget = float(budget_doc.to_dict().get("amount", 0)) if budget_doc.exists else 0.0
    payment_types, personal_payment_types = _payment_totals(monthly_expenses)
    balances = get_shared_balances(uid)
    outstanding_this_month = round(
        sum(
            expense["outstanding"]
            for person in balances["people"]
            for expense in person["expenses"]
            if expense["expense_date"].startswith(month)
        ),
        2,
    )
    return {
        "month": month,
        "budget": budget,
        "budget_set": budget_doc.exists,
        "spent": total,
        "cash_paid": round(cash_paid, 2),
        "shared_paid": round(shared_paid, 2),
        "payment_types": payment_types,
        "personal_payment_types": personal_payment_types,
        "personal_spending_total": round(sum(personal_payment_types.values()), 2),
        "remaining": budget - total if budget_doc.exists else None,
        "expense_count": count,
        "categories": categories,
        "outstanding_this_month": outstanding_this_month,
        **balances,
    }


@router.post("/report")
async def generate_report(request: ReportRequest, user=Depends(get_current_user)):
    try:
        start = date.fromisoformat(request.start_date)
        end = date.fromisoformat(request.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Dates must use YYYY-MM-DD format") from exc
    if end < start:
        raise HTTPException(status_code=422, detail="End date must be on or after start date")

    expenses = []
    docs = db.collection("users").document(user["uid"]).collection("expenses").stream()
    for doc in docs:
        expense = doc.to_dict()
        expense_date = _expense_date(expense)
        if not expense_date:
            continue
        try:
            parsed_date = date.fromisoformat(expense_date)
        except ValueError:
            continue
        if start <= parsed_date <= end:
            expenses.append({"id": doc.id, **expense, "expense_date": expense_date})

    categories = {"Food": 0, "Shopping": 0, "Personal Care": 0, "Transport": 0, "Other": 0}
    monthly = {}
    total = 0.0
    cash_paid = 0.0
    shared_paid = 0.0
    for expense in expenses:
        amount = float(expense.get("amount", 0))
        shared_amount = sum(float(share.get("amount", 0)) for share in expense.get("shared_with", []))
        personal_amount = max(round(amount - shared_amount, 2), 0) if expense.get("is_shared") else amount
        category = expense.get("category", "Other")
        categories[category] = categories.get(category, 0) + personal_amount
        month = expense["expense_date"][:7]
        monthly[month] = monthly.get(month, 0) + personal_amount
        total += personal_amount
        cash_paid += amount
        shared_paid += shared_amount
    payment_types, personal_payment_types = _payment_totals(expenses)

    balances = get_shared_balances(user["uid"])
    summary = {
        "period": request.period,
        "start_date": request.start_date,
        "end_date": request.end_date,
        "total": round(total, 2),
        "cash_paid": round(cash_paid, 2),
        "shared_paid": round(shared_paid, 2),
        "payment_types": payment_types,
        "personal_payment_types": personal_payment_types,
        "personal_spending_total": round(sum(personal_payment_types.values()), 2),
        "outstanding_total": balances["outstanding_total"],
        "expense_count": len(expenses),
        "categories": categories,
        "monthly": dict(sorted(monthly.items())),
        "transactions": [
            {
                "id": expense["id"],
                "expense_date": expense["expense_date"],
                "description": expense.get("raw_input") or expense.get("subcategory") or "Expense",
                "category": expense.get("category", "Other"),
                "subcategory": expense.get("subcategory", "Expense"),
                "payment_type": expense.get("payment_type", "debit")
                if expense.get("payment_type") in {"debit", "credit"}
                else "debit",
                "amount": round(float(expense.get("amount", 0)), 2),
            }
            for expense in expenses
        ],
    }
    try:
        insight_summary = {key: value for key, value in summary.items() if key != "transactions"}
        insights = await generate_report_insights(insight_summary)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Gemini could not create report insights") from exc
    return {**summary, **balances, "insights": insights.model_dump()}
