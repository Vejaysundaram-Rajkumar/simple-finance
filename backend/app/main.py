from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from app.config import FRONTEND_URL
from app.routers import admin, ai, analysis, budget, expenses, users

app = FastAPI(title="Simple Finance API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def normalize_vercel_function_path(request, call_next):
    path = request.scope["path"]
    function_prefix = "/api/index.py"
    if path == function_prefix or path.startswith(function_prefix + "/"):
        remainder = path[len(function_prefix):]
        request.scope["path"] = remainder if remainder.startswith("/api/") else "/api" + remainder
    return await call_next(request)

app.include_router(users.router)
app.include_router(ai.router)
app.include_router(expenses.router)
app.include_router(budget.router)
app.include_router(analysis.router)
app.include_router(admin.router)
app.frontend("/", directory=Path(__file__).resolve().parents[2] / "frontend")


@app.get("/")
async def root():
    return {"name": "Simple Finance API", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/health")
async def api_health():
    return {"status": "healthy"}
