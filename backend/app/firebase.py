import firebase_admin
from firebase_admin import credentials, firestore
import json

from app.config import FIREBASE_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_JSON

if not firebase_admin._apps:
    if FIREBASE_SERVICE_ACCOUNT_JSON:
        cred = credentials.Certificate(json.loads(FIREBASE_SERVICE_ACCOUNT_JSON))
    else:
        cred = credentials.Certificate(FIREBASE_CREDENTIALS)
    firebase_admin.initialize_app(cred)

db = firestore.client()
