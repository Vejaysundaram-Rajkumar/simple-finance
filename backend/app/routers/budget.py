from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.firebase import db
from app.models.schemas import BudgetRequest

router = APIRouter(prefix="/api/budget", tags=["Budget"])


@router.put("/{month}")
async def set_budget(month: str, request: BudgetRequest, user=Depends(get_current_user)):
    ref = db.collection("users").document(user["uid"]).collection("budgets").document(month)
    ref.set({"amount": request.amount, "updated_at": datetime.now(timezone.utc)}, merge=True)
    return {"month": month, "amount": request.amount}


@router.get("/{month}")
async def get_budget(month: str, user=Depends(get_current_user)):
    doc = db.collection("users").document(user["uid"]).collection("budgets").document(month).get()
    return {"month": month, "amount": 0} if not doc.exists else {"month": month, **doc.to_dict()}
