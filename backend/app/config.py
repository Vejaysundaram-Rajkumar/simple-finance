import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
FIREBASE_SERVICE_ACCOUNT_JSON = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
FIREBASE_CREDENTIALS = os.getenv(
    "FIREBASE_CREDENTIALS",
    str(BACKEND_DIR / "serviceAccountKey.json"),
)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5500")
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", "").split(",")
    if email.strip()
}
