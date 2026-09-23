from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from firebase_admin import firestore

from app.auth import get_current_user
from app.firebase import db

router = APIRouter(prefix="/api/users", tags=["Users"])


@router.post("/sync")
async def sync_user(user=Depends(get_current_user)):
    uid = user["uid"]
    ref = db.collection("users").document(uid)
    now = datetime.now(timezone.utc)
    data = {
        "name": user.get("name"),
        "email": user.get("email"),
        "photo_url": user.get("picture"),
        "last_login": now,
        "login_count": firestore.Increment(1),
    }
    if not ref.get().exists:
        data.update({"currency": "INR", "created_at": now})
    ref.set(data, merge=True)
    return {"uid": uid, **data}
