from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import ValidationError

from app.auth import get_current_user
from app.firebase import db
from app.models.schemas import ExpenseCreate, ExpenseUpdate, MultipleExpenseCreate, SettlementCreate
from app.services.shared_expenses import _person_key, get_shared_balances

router = APIRouter(prefix="/api/expenses", tags=["Expenses"])


def expense_collection(uid: str):
    return db.collection("users").document(uid).collection("expenses")


@router.post("")
async def create_expenses(request: MultipleExpenseCreate, user=Depends(get_current_user)):
    uid = user["uid"]
    created = []
    now = datetime.now(timezone.utc)
    batch = db.batch()
    pending_writes = 0
    for expense in request.expenses:
        ref = expense_collection(uid).document()
        data = expense.model_dump()
        data["expense_date"] = data["expense_date"] or now.date().isoformat()
        data["created_at"] = now
        data["updated_at"] = now
        batch.set(ref, data)
        pending_writes += 1
        created.append({"id": ref.id, **data})
        if pending_writes == 500:
            batch.commit()
            batch = db.batch()
            pending_writes = 0
    if pending_writes:
        batch.commit()
    return {"expenses": created}


@router.get("")
async def get_expenses(user=Depends(get_current_user)):
    expenses = [{"id": doc.id, **doc.to_dict()} for doc in expense_collection(user["uid"]).stream()]
    return sorted(
        expenses,
        key=lambda item: (
            item.get("expense_date", ""),
            str(item.get("created_at", "")),
        ),
        reverse=True,
    )


@router.get("/today")
async def get_today_expenses(user=Depends(get_current_user)):
    today = datetime.now().date().isoformat()
    query = expense_collection(user["uid"]).where(filter=FieldFilter("expense_date", "==", today))
    expenses = [{"id": doc.id, **doc.to_dict()} for doc in query.stream()]
    expenses.sort(key=lambda item: str(item.get("created_at", "")), reverse=True)
    return {"total": sum(item["amount"] for item in expenses), "count": len(expenses), "expenses": expenses}


@router.get("/balances")
async def get_balances(user=Depends(get_current_user)):
    return get_shared_balances(user["uid"])


@router.post("/settlements")
async def create_settlement(request: SettlementCreate, user=Depends(get_current_user)):
    uid = user["uid"]
    balances = get_shared_balances(uid)
    person = next(
        (person for person in balances["people"] if _person_key(person["name"]) == _person_key(request.person_name)),
        None,
    )
    if not person:
        raise HTTPException(status_code=404, detail="No shared expenses found for this person")
    amount = round(request.amount, 2)
    if amount > person["outstanding"]:
        raise HTTPException(status_code=422, detail="Payment cannot exceed the outstanding balance")

    now = datetime.now(timezone.utc)
    settlement_date = request.settlement_date or now.date().isoformat()
    ref = db.collection("users").document(uid).collection("settlements").document()
    ref.set(
        {
            "person_name": person["name"],
            "person_key": _person_key(person["name"]),
            "amount": amount,
            "settlement_date": settlement_date,
            "created_at": now,
        }
    )
    return {"message": "Payment recorded", **get_shared_balances(uid)}


@router.put("/{expense_id}")
async def update_expense(expense_id: str, request: ExpenseUpdate, user=Depends(get_current_user)):
    ref = expense_collection(user["uid"]).document(expense_id)
    snapshot = ref.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Expense not found")
    updates = request.model_dump(exclude_unset=True)
    existing = snapshot.to_dict()
    try:
        validated = ExpenseCreate.model_validate({**existing, **updates})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from exc
    if "shared_with" in updates:
        updates["shared_with"] = [share.model_dump() for share in validated.shared_with]
    updates["updated_at"] = datetime.now(timezone.utc)
    ref.update(updates)
    return {"message": "Expense updated"}


@router.delete("/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(get_current_user)):
    ref = expense_collection(user["uid"]).document(expense_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Expense not found")
    ref.delete()
    return {"message": "Expense deleted"}
