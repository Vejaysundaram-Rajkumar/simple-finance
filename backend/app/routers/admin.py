from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import ADMIN_EMAILS
from app.firebase import db

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def require_admin(user=Depends(get_current_user)):
    if not ADMIN_EMAILS or (user.get("email") or "").lower() not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/overview")
async def overview(_: dict = Depends(require_admin)):
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)
    users = list(db.collection("users").stream())
    active_7d = 0
    active_30d = 0
    login_total = 0
    login_days = Counter()

    for user_doc in users:
        user = user_doc.to_dict() or {}
        last_login = user.get("last_login")
        if isinstance(last_login, datetime):
            last_login = last_login.replace(tzinfo=timezone.utc) if last_login.tzinfo is None else last_login
            if last_login >= seven_days_ago:
                active_7d += 1
            if last_login >= thirty_days_ago:
                active_30d += 1
            login_days[last_login.date().isoformat()] += 1
        login_total += int(user.get("login_count", 0) or 0)

    return {
        "generated_at": now.isoformat(),
        "total_users": len(users),
        "active_users_7d": active_7d,
        "active_users_30d": active_30d,
        "total_logins": login_total,
        "logins_by_day": dict(sorted(login_days.items())),
    }