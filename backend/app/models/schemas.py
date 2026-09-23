from typing import Literal

from pydantic import BaseModel, Field

Category = Literal["Food", "Shopping", "Personal Care", "Transport", "Other"]


class ParsedExpense(BaseModel):
    amount: float = Field(gt=0)
    category: Category
    subcategory: str = Field(min_length=1, max_length=80)
    expense_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ParsedExpenseResponse(BaseModel):
    expenses: list[ParsedExpense]


class ParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ExpenseCreate(BaseModel):
    amount: float = Field(gt=0)
    category: Category
    subcategory: str = Field(min_length=1, max_length=80)
    raw_input: str | None = None
    expense_date: str | None = None


class MultipleExpenseCreate(BaseModel):
    expenses: list[ExpenseCreate] = Field(min_length=1, max_length=1000)


class ExpenseUpdate(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    category: Category | None = None
    subcategory: str | None = Field(default=None, min_length=1, max_length=80)
    expense_date: str | None = None


class BudgetRequest(BaseModel):
    amount: float = Field(gt=0)


class ReportRequest(BaseModel):
    period: Literal["monthly", "yearly", "custom"]
    start_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class ReportInsights(BaseModel):
    executive_summary: str
    insights: list[str]
    recommendations: list[str]
