from collections import defaultdict

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
            person["expenses"].append(
                {
                    "expense_id": expense.get("id", ""),
                    "expense_date": str(expense.get("expense_date", ""))[:10],
                    "description": expense.get("subcategory", "Shared expense"),
                    "category": expense.get("category", "Other"),
                    "group_name": expense.get("group_name") or "",
                    "expense_amount": round(float(expense.get("amount", 0)), 2),
                    "share_amount": round(float(share.get("amount", 0)), 2),
                    "repaid_amount": 0.0,
                    "outstanding": round(float(share.get("amount", 0)), 2),
                    "_sort": str(expense.get("created_at", "")),
                }
            )

    payments_by_person = defaultdict(list)
    for settlement in settlements:
        key = settlement.get("person_key") or _person_key(settlement.get("person_name", ""))
        if key:
            payments_by_person[key].append(settlement)

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
            remaining_payment = round(float(payment.get("amount", 0)), 2)
            for row in rows:
                if remaining_payment <= 0:
                    break
                applied = min(row["outstanding"], remaining_payment)
                row["repaid_amount"] = round(row["repaid_amount"] + applied, 2)
                row["outstanding"] = round(row["outstanding"] - applied, 2)
                remaining_payment = round(remaining_payment - applied, 2)
        person["expenses"] = rows
        person["total_owed"] = round(sum(row["share_amount"] for row in rows), 2)
        person["total_repaid"] = round(sum(row["repaid_amount"] for row in rows), 2)
        person["outstanding"] = round(sum(row["outstanding"] for row in rows), 2)
        for row in rows:
            row.pop("_sort", None)

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

    return {
        "outstanding_total": round(sum(person["outstanding"] for person in people_list), 2),
        "people": people_list,
        "groups": groups,
    }


def get_shared_balances(uid: str) -> dict:
    from app.firebase import db

    user_ref = db.collection("users").document(uid)
    expenses = [{"id": doc.id, **doc.to_dict()} for doc in user_ref.collection("expenses").stream()]
    settlements = [doc.to_dict() for doc in user_ref.collection("settlements").stream()]
    return build_shared_balances(expenses, settlements)