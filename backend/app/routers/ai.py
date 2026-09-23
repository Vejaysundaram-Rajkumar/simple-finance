import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.firebase import db
from app.models.schemas import ParseRequest, ParsedExpenseResponse
from app.services.gemini import parse_expenses

router = APIRouter(prefix="/api/ai", tags=["AI"])
logger = logging.getLogger(__name__)


@router.post("/parse", response_model=ParsedExpenseResponse)
async def parse_expense_message(request: ParseRequest, user=Depends(get_current_user)):
    learned: dict[str, list[str]] = {}
    docs = (
        db.collection("users").document(user["uid"]).collection("subcategories").stream()
    )
    for doc in docs:
        data = doc.to_dict()
        category, name = data.get("category"), data.get("name")
        if category and name:
            learned.setdefault(category, []).append(name)
    try:
        return await parse_expenses(request.text, learned)
    except Exception as exc:
        logger.exception("Gemini expense parsing failed")
        raise HTTPException(status_code=502, detail="Gemini could not parse the expense message") from exc
