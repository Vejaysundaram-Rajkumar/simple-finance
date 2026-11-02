from google import genai
from google.genai import types

from app.config import GEMINI_API_KEY
from app.models.schemas import ParsedExpenseResponse, ReportInsights

BASE_SUBCATEGORIES = {
    "Food": ["Breakfast", "Lunch", "Dinner", "Snacks", "Coffee", "Restaurant"],
    "Transport": ["Petrol", "Cab", "Bus", "Train"],
    "Shopping": ["Clothes", "Shoes", "Accessories"],
    "Personal Care": ["Perfume", "Skin Care", "Hair Care", "Grooming"],
    "Other": ["General"],
}

GEMINI_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "expenses": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "amount": {"type": "NUMBER"},
                    "category": {
                        "type": "STRING",
                        "enum": [
                            "Food",
                            "Shopping",
                            "Personal Care",
                            "Transport",
                            "Other",
                        ],
                    },
                    "subcategory": {"type": "STRING"},
                    "payment_type": {"type": "STRING", "enum": ["debit", "credit"]},
                    "expense_date": {"type": "STRING", "nullable": True},
                    "is_shared": {"type": "BOOLEAN"},
                    "group_name": {"type": "STRING", "nullable": True},
                    "shared_as_group": {"type": "BOOLEAN"},
                    "shared_participant_count": {"type": "INTEGER", "nullable": True},
                    "shared_with": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "name": {"type": "STRING"},
                                "amount": {"type": "NUMBER"},
                            },
                            "required": ["name", "amount"],
                        },
                    },
                },
                "required": [
                    "amount",
                    "category",
                    "subcategory",
                    "payment_type",
                    "expense_date",
                    "is_shared",
                    "group_name",
                    "shared_as_group",
                    "shared_participant_count",
                    "shared_with",
                ],
            },
        }
    },
    "required": ["expenses"],
}

REPORT_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "executive_summary": {"type": "STRING"},
        "insights": {"type": "ARRAY", "items": {"type": "STRING"}},
        "recommendations": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["executive_summary", "insights", "recommendations"],
}


_gemini_client: genai.Client | None = None


def _client() -> genai.Client:
    global _gemini_client
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


def _generate_content(prompt: str, response_schema: dict):
    global _gemini_client
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=response_schema,
        temperature=0.1,
    )
    try:
        return _client().models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt,
            config=config,
        )
    except RuntimeError as exc:
        if "closed" not in str(exc).lower():
            raise
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        return _gemini_client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt,
            config=config,
        )


async def parse_expenses(text: str, learned_subcategories: dict | None = None) -> ParsedExpenseResponse:
    learned_subcategories = learned_subcategories or {}
    prompt = f"""
You parse personal expenses for Simple Finance. Return only expense records from the input.
Split multiple expenses into separate records. Never invent an expense.
Use exactly one of these categories: Food, Shopping, Personal Care, Transport, Other.
Prefer the supplied subcategories, otherwise create a short useful subcategory.
Assume an Indian financial context and preserve the exact amounts mentioned.
Set payment_type="credit" only when the user explicitly says the expense was paid
with a credit card or on credit; otherwise set payment_type="debit" (including UPI
and debit cards). Do not treat money owed by another person as a credit-card payment.
Today is {__import__('datetime').date.today().isoformat()}.
Resolve relative dates such as today, yesterday, day before yesterday, last Monday,
and explicit dates into YYYY-MM-DD. If no date is stated, use null.
Return expense_date for every record, using null only when the input has no date.
Detect expenses the user paid for other people. For these, set is_shared=true and list
each other person's name and exact share amount in shared_with; do not include the user.
The user's share is the total amount minus the listed shares. If the user explicitly says
the bill is split equally among them and named others, calculate each other person's share
to the nearest minor currency unit. If the user explicitly gives a total participant count
including themselves but no individual names, set shared_as_group=true and shared_with to
one entry named exactly group_name (or "Group" if not named). Its amount is the total owed
by all other participants: amount * (participant_count - 1) / participant_count, rounded
to two decimal places. Set shared_participant_count to that count. The user will supply or
edit the group name before saving. For named individuals set shared_as_group=false and
shared_participant_count=null. Set group_name when a group is named, otherwise null.
For personal expenses return is_shared=false, group_name=null, shared_as_group=false,
shared_participant_count=null, and shared_with=[].
Never invent people or shares. If a shared expense is mentioned but shares are unclear,
set is_shared=true and shared_with=[] so the user can complete it before saving.

DEFAULT SUBCATEGORIES: {BASE_SUBCATEGORIES}
USER LEARNED SUBCATEGORIES: {learned_subcategories}
USER INPUT: {text}
"""
    response = _generate_content(prompt, GEMINI_RESPONSE_SCHEMA)
    return ParsedExpenseResponse.model_validate_json(response.text)


async def generate_report_insights(report_data: dict) -> ReportInsights:
    prompt = f"""
You are a careful personal finance analyst. Analyze the following expense report.
Do not invent numbers. Mention trends, category concentration, unusual changes, and
practical recommendations. Keep the tone neutral and useful. Return concise strings.

REPORT DATA:
{report_data}
"""
    response = _generate_content(prompt, REPORT_RESPONSE_SCHEMA)
    return ReportInsights.model_validate_json(response.text)
