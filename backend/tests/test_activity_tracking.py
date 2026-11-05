import unittest
from datetime import date

from fastapi import HTTPException
from pydantic import ValidationError

from app.models.schemas import ActivityCreate, ActivityDayUpdate
from app.routers.activities import allowed_months, parse_day, parse_month, validate_activity_date


class ActivitySchemaTests(unittest.TestCase):
    def test_activity_name_is_trimmed_and_whitespace_is_collapsed(self):
        activity = ActivityCreate(name="  Morning   workout ", month="2026-11")

        self.assertEqual(activity.name, "Morning workout")

    def test_activity_name_rejects_blank_values(self):
        with self.assertRaises(ValidationError):
            ActivityCreate(name="   ", month="2026-11")

    def test_activity_name_rejects_values_over_50_characters(self):
        with self.assertRaises(ValidationError):
            ActivityCreate(name="a" * 51, month="2026-11")

    def test_activity_is_scoped_to_a_valid_month(self):
        self.assertEqual(ActivityCreate(name="Gym", month="2026-11").month, "2026-11")
        for value in ("2026-1", "2026-13", "not-a-month"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                ActivityCreate(name="Gym", month=value)

    def test_completion_state_requires_boolean(self):
        with self.assertRaises(ValidationError):
            ActivityDayUpdate.model_validate({"completed": "yes"})

    def test_month_parser_accepts_only_year_month_values(self):
        self.assertEqual(parse_month("2026-11"), "2026-11")
        for value in ("2026-1", "2026-13", "not-a-month"):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                parse_month(value)

    def test_day_parser_rejects_impossible_dates(self):
        self.assertEqual(parse_day("2024-02-29").isoformat(), "2024-02-29")
        with self.assertRaises(HTTPException):
            parse_day("2026-02-29")

    def test_activity_months_are_current_and_previous(self):
        self.assertEqual(allowed_months(date(2026, 1, 5)), ("2025-12", "2026-01"))

    def test_all_dates_in_previous_month_are_available(self):
        validate_activity_date(date(2026, 10, 1), "2026-10", date(2026, 11, 5))
        validate_activity_date(date(2026, 10, 31), "2026-10", date(2026, 11, 5))
        with self.assertRaises(HTTPException):
            validate_activity_date(date(2026, 9, 30), "2026-09", date(2026, 11, 5))

    def test_current_month_future_dates_are_not_available(self):
        with self.assertRaises(HTTPException):
            validate_activity_date(date(2026, 11, 6), "2026-11", date(2026, 11, 5))

    def test_activity_cannot_be_completed_outside_its_month(self):
        with self.assertRaises(HTTPException):
            validate_activity_date(date(2026, 11, 1), "2026-10", date(2026, 11, 5))
