from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.firebase import db
from app.models.schemas import ReportRequest
from app.services.gemini import generate_report_insights

router = APIRouter(prefix="/api/analysis", tags=["Analysis"])


def _expense_date(expense: dict) -> str:
    return str(expense.get("expense_date", ""))[:10]


@router.get("/{month}")
async def monthly_analysis(month: str, user=Depends(get_current_user)):
    categories = {"Food": 0, "Shopping": 0, "Personal Care": 0, "Transport": 0, "Other": 0}
    total = 0.0
    count = 0
    docs = db.collection("users").document(user["uid"]).collection("expenses").stream()
    for doc in docs:
        expense = doc.to_dict()
        if not expense.get("expense_date", "").startswith(month):
            continue
        amount = float(expense.get("amount", 0))
        category = expense.get("category", "Other")
        total += amount
        count += 1
        categories[category] = categories.get(category, 0) + amount

    budget_doc = db.collection("users").document(user["uid"]).collection("budgets").document(month).get()
    budget = float(budget_doc.to_dict().get("amount", 0)) if budget_doc.exists else 0.0
    return {
        "month": month,
        "budget": budget,
        "budget_set": budget_doc.exists,
        "spent": total,
        "remaining": budget - total if budget_doc.exists else None,
        "expense_count": count,
        "categories": categories,
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
    for expense in expenses:
        amount = float(expense.get("amount", 0))
        category = expense.get("category", "Other")
        categories[category] = categories.get(category, 0) + amount
        month = expense["expense_date"][:7]
        monthly[month] = monthly.get(month, 0) + amount
        total += amount

    summary = {
        "period": request.period,
        "start_date": request.start_date,
        "end_date": request.end_date,
        "total": total,
        "expense_count": len(expenses),
        "categories": categories,
        "monthly": dict(sorted(monthly.items())),
    }
    try:
        insights = await generate_report_insights(summary)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Gemini could not create report insights") from exc
    return {**summary, "insights": insights.model_dump()}
