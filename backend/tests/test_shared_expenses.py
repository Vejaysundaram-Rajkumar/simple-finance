import unittest

from pydantic import ValidationError

from app.models.schemas import ExpenseCreate, ExpenseUpdate
from app.routers.analysis import _payment_totals
from app.services.shared_expenses import build_shared_balances


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