from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP


def _to_cents(value) -> int:
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _from_cents(value: int) -> float:
    return float(Decimal(value) / 100)


def _person_key(name: str) -> str:
    return " ".join(name.casefold().split())


def build_shared_balances(expenses: list[dict], settlements: list[dict]) -> dict:
    people = {}
    for expense in expenses:
        if not expense.get("is_shared"):
            continue
        for share in expense.get("shared_with", []):
            name = " ".join(str(share.get("name", "")).split())
            if not name:
                continue
            key = _person_key(name)
            person = people.setdefault(key, {"name": name, "expenses": []})
            share_cents = _to_cents(share.get("amount", 0))
            person["expenses"].append(
                {
                    "expense_id": expense.get("id", ""),
                    "expense_date": str(expense.get("expense_date", ""))[:10],
                    "description": expense.get("subcategory", "Shared expense"),
                    "category": expense.get("category", "Other"),
                    "group_name": expense.get("group_name") or "",
                    "expense_amount": round(float(expense.get("amount", 0)), 2),
                    "share_amount": _from_cents(share_cents),
                    "repaid_amount": 0.0,
                    "outstanding": _from_cents(share_cents),
                    "settlement_allocations": [],
                    "_share_cents": share_cents,
                    "_repaid_cents": 0,
                    "_outstanding_cents": share_cents,
                    "_sort": str(expense.get("created_at", "")),
                }
            )

    settlement_ledger = []
    payments_by_person = defaultdict(list)
    for index, settlement in enumerate(settlements):
        key = settlement.get("person_key") or _person_key(settlement.get("person_name", ""))
        record = {
            "id": settlement.get("id") or f"settlement-{index + 1}",
            "person_name": settlement.get("person_name", ""),
            "settlement_date": str(settlement.get("settlement_date", ""))[:10],
            "amount": _from_cents(_to_cents(settlement.get("amount", 0))),
            "allocations": [],
            "_amount_cents": _to_cents(settlement.get("amount", 0)),
            "_allocated_cents": 0,
            "_index": index,
        }
        settlement_ledger.append(record)
        if key:
            payments_by_person[key].append({**settlement, "_ledger_index": index})

    for key, person in people.items():
        rows = sorted(
            person["expenses"],
            key=lambda row: (row["expense_date"], row["_sort"], row["expense_id"]),
        )
        payments = sorted(
            payments_by_person.get(key, []),
            key=lambda item: (item.get("settlement_date", ""), str(item.get("created_at", ""))),
        )
        for payment in payments:
            remaining_payment = _to_cents(payment.get("amount", 0))
            for row in rows:
                if remaining_payment <= 0:
                    break
                applied = min(row["_outstanding_cents"], remaining_payment)
                row["_repaid_cents"] += applied
                row["_outstanding_cents"] -= applied
                remaining_payment -= applied
                allocated_amount = _from_cents(applied)
                settlement_id = settlement_ledger[payment["_ledger_index"]]["id"]
                allocation = {
                    "settlement_id": settlement_id,
                    "settlement_date": str(payment.get("settlement_date", ""))[:10],
                    "amount": allocated_amount,
                }
                row.setdefault("settlement_allocations", []).append(allocation)
                ledger_record = settlement_ledger[payment["_ledger_index"]]
                ledger_record["allocations"].append({
                    "expense_id": row["expense_id"],
                    "expense_date": row["expense_date"],
                    "description": row["description"],
                    "amount": allocated_amount,
                })
                ledger_record["_allocated_cents"] += applied
        for row in rows:
            row["share_amount"] = _from_cents(row["_share_cents"])
            row["repaid_amount"] = _from_cents(row["_repaid_cents"])
            row["outstanding"] = _from_cents(row["_outstanding_cents"])
        person["expenses"] = rows
        person["total_owed"] = _from_cents(sum(row["_share_cents"] for row in rows))
        person["total_repaid"] = _from_cents(sum(row["_repaid_cents"] for row in rows))
        person["outstanding"] = _from_cents(sum(row["_outstanding_cents"] for row in rows))
        for row in rows:
            row.setdefault("settlement_allocations", [])
            for key in ("_sort", "_share_cents", "_repaid_cents", "_outstanding_cents"):
                row.pop(key, None)

    group_totals = defaultdict(lambda: {"name": "", "total_owed": 0.0, "total_repaid": 0.0, "outstanding": 0.0, "expenses": []})
    for person in people.values():
        for row in person["expenses"]:
            group_name = row["group_name"]
            if not group_name:
                continue
            group = group_totals[group_name.casefold()]
            group["name"] = group_name
            group["total_owed"] += row["share_amount"]
            group["total_repaid"] += row["repaid_amount"]
            group["outstanding"] += row["outstanding"]
            group["expenses"].append({**row, "person_name": person["name"]})

    people_list = sorted(people.values(), key=lambda person: person["name"].casefold())
    groups = sorted(group_totals.values(), key=lambda group: group["name"].casefold())
    for group in groups:
        for key in ("total_owed", "total_repaid", "outstanding"):
            group[key] = round(group[key], 2)
        group["expenses"].sort(key=lambda row: (row["expense_date"], row["description"].casefold()))

    settlements_result = []
    for settlement in sorted(
        settlement_ledger,
        key=lambda item: (item["settlement_date"], item["_index"]),
    ):
        settlements_result.append({
            "id": settlement["id"],
            "person_name": settlement["person_name"],
            "settlement_date": settlement["settlement_date"],
            "amount": settlement["amount"],
            "allocations": settlement["allocations"],
            "unallocated_amount": _from_cents(
                settlement["_amount_cents"] - settlement["_allocated_cents"]
            ),
        })

    return {
        "outstanding_total": round(sum(person["outstanding"] for person in people_list), 2),
        "people": people_list,
        "groups": groups,
        "settlements": settlements_result,
    }


def get_shared_balances(uid: str) -> dict:
    from app.firebase import db

    user_ref = db.collection("users").document(uid)
    expenses = [{"id": doc.id, **doc.to_dict()} for doc in user_ref.collection("expenses").stream()]
    settlements = [
        {"id": doc.id, **(doc.to_dict() or {})}
        for doc in user_ref.collection("settlements").stream()
    ]
    return build_shared_balances(expenses, settlements)