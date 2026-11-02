# Simple Finance

Simple Finance is a Firebase-backed expense tracker with a vanilla frontend and FastAPI API deployed together on Vercel. Firebase Authentication and Firestore remain the data services; Vercel hosts both the browser files and Python API under one domain.

## Project structure

```text
api/index.py                 Vercel entry point for FastAPI
backend/app/                 FastAPI application
frontend/                    Static browser application
vercel.json                  Frontend and /api routing
requirements.txt             Vercel Python dependencies
firestore.rules              Firestore security rules
```

## Local development

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In a second terminal:

```powershell
cd frontend
python -m http.server 5500
```

Open `http://127.0.0.1:5500/login.html`.

## Vercel deployment

Install and authenticate the Vercel CLI:

```powershell
npm.cmd install -g vercel
vercel.cmd login
```

From the project root, create the Vercel project:

```powershell
vercel.cmd
```

Use the current directory, accept the detected settings, and deploy. Add these Environment Variables in the Vercel project settings for Production, Preview, and Development:

```text
GEMINI_API_KEY=your Gemini API key
FIREBASE_SERVICE_ACCOUNT_JSON=the complete service-account JSON on one line
FRONTEND_URL=https://your-project.vercel.app
ADMIN_EMAILS=your-google-email@example.com
```

Do not upload `backend/.env` or `backend/serviceAccountKey.json`. The service-account JSON belongs only in Vercel Environment Variables.

After adding variables:

```powershell
vercel.cmd --prod
```

The final app uses one URL:

```text
https://your-project.vercel.app/login.html
```

Add the Vercel hostname to Firebase Authentication authorized domains. The API is available at the same origin under `/api`, so no separate backend URL is needed.

The owner-only usage dashboard is available at `/admin.html`. It reports aggregate user counts, active users, login totals, expense totals, and login activity by day. Access is controlled by the server-side `ADMIN_EMAILS` allowlist; no user expense details are exposed.

## Expense tracking

Expenses can be marked as debit (UPI or debit card) or credit card. For an equal group split with a participant count but no individual names, the app calculates the combined amount owed by the other participants and tracks it under the group name you enter. Named shares remain available when you want individual balances. Record repayments against the group or person to reduce the corresponding outstanding amount. Monthly analysis distinguishes total credit-card charges from your personal share; it does not calculate the card issuer's outstanding bill. PDF reports include a transaction table with each saved original entry, payment type, and amount.

These fields are additive in each user's existing Firestore `expenses` collection. No migration is required: historical expenses without a `payment_type` are treated as debit, and report descriptions fall back to the transaction subcategory when an older record has no saved original entry. New natural-language entries continue to store their original text as `raw_input`.
