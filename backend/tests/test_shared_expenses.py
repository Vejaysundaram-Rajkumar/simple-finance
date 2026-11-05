import unittest

from pydantic import ValidationError

from app.models.schemas import ExpenseCreate, ExpenseUpdate
from app.routers.analysis import _payment_totals, _report_settlement_details
from app.services.shared_expenses import _to_cents, build_shared_balances


class SharedBalanceTests(unittest.TestCase):
    def test_credit_totals_distinguish_card_charges_from_personal_share(self):
        totals, personal_totals = _payment_totals(
            [
                {
                    "amount": 820,
                    "payment_type": "credit",
                    "is_shared": True,
                    "shared_with": [
                        {"name": "Alex", "amount": 164},
                        {"name": "Sam", "amount": 164},
                        {"name": "Ravi", "amount": 164},
                        {"name": "Mina", "amount": 164},
                    ],
                },
                {"amount": 250},
            ]
        )

        self.assertEqual(totals, {"debit": 250, "credit": 820})
        self.assertEqual(personal_totals, {"debit": 250, "credit": 164})
        self.assertEqual(sum(personal_totals.values()), 414)

    def test_expense_payment_type_defaults_to_debit_for_existing_records(self):
        expense = ExpenseCreate(
            amount=25,
            category="Food",
            subcategory="Lunch",
        )

        self.assertEqual(expense.payment_type, "debit")

    def test_expense_accepts_credit_card_payment_type(self):
        expense = ExpenseCreate(
            amount=25,
            category="Food",
            subcategory="Lunch",
            payment_type="credit",
        )

        self.assertEqual(expense.payment_type, "credit")

    def test_expense_update_rejects_unknown_payment_type(self):
        with self.assertRaises(ValidationError):
            ExpenseUpdate(payment_type="cash")

    def test_group_share_requires_matching_group_name(self):
        expense = ExpenseCreate(
            amount=820,
            category="Food",
            subcategory="Breakfast",
            is_shared=True,
            group_name="Friends group",
            shared_as_group=True,
            shared_participant_count=5,
            shared_with=[{"name": "Friends group", "amount": 600}],
        )

        self.assertEqual(expense.shared_with[0].amount, 656)
        with self.assertRaises(ValidationError):
            ExpenseCreate(
                amount=820,
                category="Food",
                subcategory="Breakfast",
                is_shared=True,
                group_name="Friends group",
                shared_as_group=True,
                shared_with=[{"name": "Another group", "amount": 656}],
            )

    def test_group_balance_collects_the_combined_amount_under_group_name(self):
        result = build_shared_balances(
            [
                {
                    "id": "breakfast",
                    "expense_date": "2026-11-02",
                    "subcategory": "Breakfast",
                    "amount": 820,
                    "is_shared": True,
                    "shared_as_group": True,
                    "group_name": "Friends group",
                    "shared_with": [{"name": "Friends group", "amount": 656}],
                }
            ],
            [],
        )

        self.assertEqual(result["groups"][0]["name"], "Friends group")
        self.assertEqual(result["groups"][0]["outstanding"], 656)

    def test_shared_expense_accepts_named_shares_within_total(self):
        expense = ExpenseCreate(
            amount=100,
            category="Food",
            subcategory="Dinner",
            is_shared=True,
            shared_with=[{"name": " Alex ", "amount": 20}],
        )

        self.assertEqual(expense.shared_with[0].name, "Alex")

    def test_shared_expense_rejects_shares_above_total(self):
        with self.assertRaises(ValidationError):
            ExpenseCreate(
                amount=30,
                category="Food",
                subcategory="Dinner",
                is_shared=True,
                shared_with=[{"name": "Alex", "amount": 20}, {"name": "Sam", "amount": 20}],
            )

    def test_repayment_reduces_oldest_share_and_group_balance(self):
        result = build_shared_balances(
            [
                {
                    "id": "dinner",
                    "expense_date": "2026-10-01",
                    "subcategory": "Dinner",
                    "amount": 120,
                    "is_shared": True,
                    "group_name": "Weekend trip",
                    "shared_with": [{"name": "Alex", "amount": 40}],
                },
                {
                    "id": "taxi",
                    "expense_date": "2026-10-03",
                    "subcategory": "Taxi",
                    "amount": 30,
                    "is_shared": True,
                    "group_name": "Weekend trip",
                    "shared_with": [{"name": " alex ", "amount": 20}],
                },
            ],
            [{"person_key": "alex", "amount": 45, "settlement_date": "2026-10-04"}],
        )

        self.assertEqual(result["outstanding_total"], 15)
        self.assertEqual(len(result["people"]), 1)
        self.assertEqual(result["people"][0]["total_owed"], 60)
        self.assertEqual(result["people"][0]["total_repaid"], 45)
        self.assertEqual(
            [row["outstanding"] for row in result["people"][0]["expenses"]],
            [0, 15],
        )
        self.assertEqual(result["groups"][0]["outstanding"], 15)

    def test_settlement_history_keeps_receipt_and_expense_allocations(self):
        balances = build_shared_balances(
            [
                {
                    "id": "lunch",
                    "expense_date": "2026-11-02",
                    "subcategory": "Lunch",
                    "amount": 100,
                    "is_shared": True,
                    "shared_with": [{"name": "Alex", "amount": 30}],
                },
                {
                    "id": "taxi",
                    "expense_date": "2026-11-04",
                    "subcategory": "Taxi",
                    "amount": 60,
                    "is_shared": True,
                    "shared_with": [{"name": "Alex", "amount": 20}],
                },
            ],
            [{
                "id": "receipt-1",
                "person_key": "alex",
                "person_name": "Alex",
                "amount": 35,
                "settlement_date": "2026-11-05",
            }],
        )

        receipt = balances["settlements"][0]
        self.assertEqual(receipt["id"], "receipt-1")
        self.assertEqual(receipt["amount"], 35)
        self.assertEqual(
            [(allocation["expense_id"], allocation["amount"]) for allocation in receipt["allocations"]],
            [("lunch", 30), ("taxi", 5)],
        )
        self.assertEqual(receipt["unallocated_amount"], 0)
        self.assertEqual(balances["people"][0]["expenses"][0]["settlement_allocations"][0]["settlement_date"], "2026-11-05")

    def test_report_summarizes_period_shares_and_records_payments_in_period(self):
        balances = build_shared_balances(
            [
                {
                    "id": "october",
                    "expense_date": "2026-10-28",
                    "subcategory": "October meal",
                    "amount": 100,
                    "is_shared": True,
                    "shared_with": [{"name": "Alex", "amount": 25}],
                },
                {
                    "id": "november",
                    "expense_date": "2026-11-02",
                    "subcategory": "November meal",
                    "amount": 80,
                    "is_shared": True,
                    "shared_with": [{"name": "Alex", "amount": 20}],
                },
            ],
            [{
                "person_key": "alex",
                "person_name": "Alex",
                "amount": 30,
                "settlement_date": "2026-11-05",
            }],
        )
        report = _report_settlement_details(balances, "2026-11-01", "2026-11-30")

        self.assertEqual(report["shared_settlement_summary"], {
            "owed_for_period_expenses": 20,
            "settled_for_period_expenses": 5,
            "currently_due_for_period_expenses": 15,
            "received_during_period": 30,
        })
        self.assertEqual(len(report["shared_expenses"]), 1)
        self.assertEqual(len(report["settlements"]), 1)
        self.assertEqual(report["settlements"][0]["allocations"][0]["expense_id"], "october")

    def test_fractional_balance_can_be_paid_exactly_in_cents(self):
        balances = build_shared_balances(
            [
                {
                    "id": "fractional-share",
                    "expense_date": "2026-11-05",
                    "amount": 2,
                    "is_shared": True,
                    "shared_with": [{"name": "Alex", "amount": 1.5}],
                }
            ],
            [{"person_key": "alex", "amount": 1, "settlement_date": "2026-11-05"}],
        )

        person = balances["people"][0]
        self.assertEqual(person["outstanding"], 0.5)
        self.assertGreater(_to_cents(1), _to_cents(person["outstanding"]))

        settled = build_shared_balances(
            [
                {
                    "id": "fractional-share",
                    "expense_date": "2026-11-05",
                    "amount": 2,
                    "is_shared": True,
                    "shared_with": [{"name": "Alex", "amount": 1.5}],
                }
            ],
            [
                {"person_key": "alex", "amount": 1, "settlement_date": "2026-11-05"},
                {"person_key": "alex", "amount": 0.5, "settlement_date": "2026-11-06"},
            ],
        )
        self.assertEqual(settled["outstanding_total"], 0)
        self.assertEqual(settled["people"][0]["outstanding"], 0)

    def test_minor_unit_rounding_is_decimal_safe(self):
        self.assertEqual(_to_cents(0.1) + _to_cents(0.2), 30)

    def test_legacy_personal_expenses_do_not_create_balances(self):
        result = build_shared_balances(
            [{"id": "old", "amount": 25, "subcategory": "Lunch"}],
            [],
        )

        self.assertEqual(result["outstanding_total"], 0)
        self.assertEqual(result["people"], [])
        self.assertEqual(result["groups"], [])


if __name__ == "__main__":
    unittest.main()