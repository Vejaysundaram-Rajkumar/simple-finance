from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Category = Literal["Food", "Shopping", "Personal Care", "Transport", "Other"]
PaymentType = Literal["debit", "credit"]


class ExpenseShare(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("A person's name is required")
        return value


class ParsedExpense(BaseModel):
    amount: float = Field(gt=0)
    category: Category
    subcategory: str = Field(min_length=1, max_length=80)
    payment_type: PaymentType = "debit"
    expense_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    is_shared: bool = False
    group_name: str | None = Field(default=None, max_length=80)
    shared_as_group: bool = False
    shared_participant_count: int | None = Field(default=None, ge=2)
    shared_with: list[ExpenseShare] = Field(default_factory=list)


class ParsedExpenseResponse(BaseModel):
    expenses: list[ParsedExpense]


class ParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ExpenseCreate(BaseModel):
    amount: float = Field(gt=0)
    category: Category
    subcategory: str = Field(min_length=1, max_length=80)
    payment_type: PaymentType = "debit"
    raw_input: str | None = None
    expense_date: str | None = None
    is_shared: bool = False
    group_name: str | None = Field(default=None, max_length=80)
    shared_as_group: bool = False
    shared_participant_count: int | None = Field(default=None, ge=2)
    shared_with: list[ExpenseShare] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_shares(self):
        if self.shared_as_group:
            if not self.is_shared or not self.group_name or len(self.shared_with) != 1:
                raise ValueError("Group balances need a group name and one group share")
            if self.shared_with[0].name.casefold() != self.group_name.casefold():
                raise ValueError("The group share name must match the group name")
            if self.shared_participant_count is not None:
                group_amount = round(
                    self.amount * (self.shared_participant_count - 1) / self.shared_participant_count,
                    2,
                )
                if group_amount <= 0:
                    raise ValueError("The group share must be at least one minor currency unit")
                self.shared_with[0].amount = group_amount
            if round(sum(share.amount for share in self.shared_with), 2) > round(self.amount, 2):
                raise ValueError("Shared amounts cannot exceed the total expense")
            return self
        if self.is_shared != bool(self.shared_with):
            raise ValueError("Shared expenses need at least one named person's share")
        names = [share.name.casefold() for share in self.shared_with]
        if len(names) != len(set(names)):
            raise ValueError("Each person can only be listed once per expense")
        if round(sum(share.amount for share in self.shared_with), 2) > round(self.amount, 2):
            raise ValueError("Shared amounts cannot exceed the total expense")
        return self


class MultipleExpenseCreate(BaseModel):
    expenses: list[ExpenseCreate] = Field(min_length=1, max_length=1000)


class ExpenseUpdate(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    category: Category | None = None
    subcategory: str | None = Field(default=None, min_length=1, max_length=80)
    payment_type: PaymentType | None = None
    expense_date: str | None = None
    is_shared: bool | None = None
    group_name: str | None = Field(default=None, max_length=80)
    shared_as_group: bool | None = None
    shared_participant_count: int | None = Field(default=None, ge=2)
    shared_with: list[ExpenseShare] | None = None


class SettlementCreate(BaseModel):
    person_name: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)
    settlement_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")

    @field_validator("person_name")
    @classmethod
    def clean_person_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("A person's name is required")
        return value


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
