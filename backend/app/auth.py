from fastapi import Header, HTTPException
from firebase_admin import auth


async def get_current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        decoded_token = auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    return {
        "uid": decoded_token["uid"],
        "email": decoded_token.get("email"),
        "name": decoded_token.get("name"),
        "picture": decoded_token.get("picture"),
    }
