from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1 import ArrayRemove, ArrayUnion

from app.auth import get_current_user
from app.firebase import db
from app.models.schemas import ActivityCreate, ActivityDayUpdate

router = APIRouter(prefix="/api/activities", tags=["Activities"])


def activity_collection(uid: str):
    return db.collection("users").document(uid).collection("activities")


def parse_month(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Month must use YYYY-MM format") from exc
    if parsed.strftime("%Y-%m") != value:
        raise HTTPException(status_code=400, detail="Month must use YYYY-MM format")
    return value


def parse_day(value: str) -> date:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Date must use YYYY-MM-DD format") from exc
    if parsed.isoformat() != value:
        raise HTTPException(status_code=400, detail="Date must use YYYY-MM-DD format")
    return parsed


def allowed_months(today: date) -> tuple[str, str]:
    previous_month = today.month - 1 or 12
    previous_year = today.year if today.month > 1 else today.year - 1
    return f"{previous_year:04d}-{previous_month:02d}", today.strftime("%Y-%m")


def validate_activity_date(day: date, activity_month: str | None, today: date) -> None:
    if day.strftime("%Y-%m") not in allowed_months(today):
        raise HTTPException(status_code=422, detail="Only the current and previous month can be updated")
    if day > today:
        raise HTTPException(status_code=422, detail="Future activity dates cannot be marked")
    if activity_month and activity_month != day.strftime("%Y-%m"):
        raise HTTPException(status_code=422, detail="This activity belongs to a different month")


@router.get("")
async def get_activities(month: str, user=Depends(get_current_user)):
    month = parse_month(month)
    if month not in allowed_months(date.today()):
        raise HTTPException(status_code=422, detail="Only the current and previous month can be viewed")

    activities = []
    for activity_doc in activity_collection(user["uid"]).stream():
        activity_ref = activity_doc.reference
        activity_data = activity_doc.to_dict() or {}
        month_doc = activity_ref.collection("months").document(month).get()
        activity_month = activity_data.get("month")
        if activity_month:
            if activity_month != month:
                continue
        elif not month_doc.exists:
            continue

        activities.append({
            "id": activity_doc.id,
            "name": activity_data.get("name", ""),
            "completed_days": sorted(set((month_doc.to_dict() or {}).get("completed_days", []))),
        })

    activities.sort(key=lambda activity: activity["name"].casefold())
    return {"activities": activities}


@router.get("/progress")
async def get_activity_progress(user=Depends(get_current_user)):
    today = date.today()
    previous_month, current_month = allowed_months(today)
    activity_months = []
    lifetime = defaultdict(lambda: {"name": "", "completed_days": 0, "active_months": 0})

    for activity_doc in activity_collection(user["uid"]).stream():
        activity_data = activity_doc.to_dict() or {}
        name = activity_data.get("name", "")
        activity_ref = activity_doc.reference
        activity_month = activity_data.get("month")
        if activity_month:
            month_docs = [(activity_month, activity_ref.collection("months").document(activity_month).get())]
        else:
            month_docs = [(doc.id, doc) for doc in activity_ref.collection("months").stream()]

        for month, month_doc in month_docs:
            if not month_doc.exists and not activity_month:
                continue
            completed_days = sorted(set((month_doc.to_dict() or {}).get("completed_days", [])))
            if any(day[:7] != month for day in completed_days):
                continue
            summary = lifetime[name.casefold().strip()]
            summary["name"] = name
            summary["completed_days"] += len(completed_days)
            summary["active_months"] += 1
            activity_months.append({
                "name": name,
                "month": month,
                "completed_days": completed_days,
                "count": len(completed_days),
            })

    activity_months.sort(key=lambda entry: (entry["month"], entry["name"].casefold()))
    return {
        "lifetime": sorted(lifetime.values(), key=lambda entry: entry["name"].casefold()),
        "months": {
            previous_month: [entry for entry in activity_months if entry["month"] == previous_month],
            current_month: [entry for entry in activity_months if entry["month"] == current_month],
        },
    }


@router.post("")
async def create_activity(request: ActivityCreate, user=Depends(get_current_user)):
    month = parse_month(request.month)
    if month not in allowed_months(date.today()):
        raise HTTPException(status_code=422, detail="Activities can only be created for the current or previous month")

    collection = activity_collection(user["uid"])
    name_key = request.name.casefold()
    for doc in collection.stream():
        data = doc.to_dict() or {}
        same_month = data.get("month") == month or (
            not data.get("month")
            and doc.reference.collection("months").document(month).get().exists
        )
        if data.get("name", "").casefold() == name_key and same_month:
            raise HTTPException(status_code=409, detail="That activity already exists for this month")

    activity_ref = collection.document()
    activity_ref.set({"name": request.name, "month": month, "created_at": datetime.now(timezone.utc)})
    return {"id": activity_ref.id, "name": request.name, "month": month}


@router.put("/{activity_id}/days/{day}")
async def set_activity_day(
    activity_id: str,
    day: str,
    request: ActivityDayUpdate,
    user=Depends(get_current_user),
):
    parsed_day = parse_day(day)
    activity_ref = activity_collection(user["uid"]).document(activity_id)
    activity_doc = activity_ref.get()
    if not activity_doc.exists:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity_month = (activity_doc.to_dict() or {}).get("month")
    validate_activity_date(parsed_day, activity_month, date.today())

    month_ref = activity_ref.collection("months").document(parsed_day.strftime("%Y-%m"))
    operation = ArrayUnion if request.completed else ArrayRemove
    month_ref.set({"completed_days": operation([parsed_day.isoformat()])}, merge=True)
    return {"activity_id": activity_id, "day": parsed_day.isoformat(), "completed": request.completed}


@router.delete("/{activity_id}")
async def remove_activity(activity_id: str, user=Depends(get_current_user)):
    activity_ref = activity_collection(user["uid"]).document(activity_id)
    if not activity_ref.get().exists:
        raise HTTPException(status_code=404, detail="Activity not found")

    batch = db.batch()
    pending = 0
    for month_doc in activity_ref.collection("months").stream():
        batch.delete(month_doc.reference)
        pending += 1
        if pending == 500:
            batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        batch.commit()
    activity_ref.delete()
    return {"id": activity_id, "deleted": True}
