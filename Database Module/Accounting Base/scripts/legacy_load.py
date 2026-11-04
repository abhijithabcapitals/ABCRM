"""Turns the old CRM's Accounting Team export (CSV) into staging inserts for migration 004.

    python legacy_load.py "<export>.csv" --out "data/legacy_stage.sql"

Prints a dry run report (totals by status and type, held rows, comments about money) and writes one insert
per row into accounting_legacy_rows. Connects to nothing. Run the SQL file with the Supabase CLI, then call
accounting_legacy_apply(). The output holds client data, so keep it in data/ (git-ignored).
"""
import argparse
import collections
import csv
import datetime
import hashlib
import html
import json
import re
import sys

ALIASES = {"Geo AB Capital": "GEO"}   # old assignee name -> CRM profile name
TYPES = {   # old type -> service name; other types keep their old label
    "CT Filing": "Corporate Tax Return Filing",
    "CT Registration": "Corporate Tax Registration",
    "CT Deregistration": "Corporate Tax Deregistration",
    "VAT Registration": "VAT Registration",
    "VAT Refund": "VAT Refund Assistance",
    "TRC": "UAE Tax Residency Certificate Assistance",
    "Accounting": "Accounting Services",
}
TAX_COMPLIANCE = {"CT Filing", "CT Registration", "CT Deregistration", "VAT Registration", "VAT Refund", "TRC"}
MONEY = re.compile(r"\b(payments?|paid|fees?|invoices?|invoiced)\b", re.I)
HOLD_REASON = "Same name, type and created date appears twice"


def clean(value):
    text = re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()
    return text or None


def iso_date(value):
    """The export's dates are ISO. Blank is None; anything else that is not ISO is an error."""
    text = clean(value)
    if not text:
        return None
    return datetime.date.fromisoformat(text).isoformat()


def legacy_key(name, type_, created):
    """The export has no task id: hash the name, type and created date, ignoring case and spacing."""
    parts = [(clean(p) or "").lower() for p in (name, type_, created)]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def text_of(value):
    """Comment text without HTML tags; an empty paragraph is nothing."""
    text = html.unescape(re.sub(r"<[^>]*>", " ", value or "")).replace("\xa0", " ")
    return "\n".join(filter(None, (clean(line) for line in text.split("\n")))) or None


def map_row(row):
    type_ = clean(row.get("Type of work")) or ""
    status = clean(row.get("Status")) or "To Do"
    done = status == "Done"
    created = iso_date(row.get("Date Created"))
    comment = text_of(row.get("Comment (short text)"))
    names = [clean(n) for n in (row.get("Assignee") or "").split(",")]
    return {
        "client_name": clean(row.get("Task Name")),
        "service_name": TYPES.get(type_, type_),
        "service_department": "Tax Compliance" if type_ in TAX_COMPLIANCE else "Accounting",
        "work_status": "Completed" if done else status,
        "assignees": [ALIASES.get(n, n) for n in names if n],
        "due_date": iso_date(row.get("Due Date")),
        "created_at": created,
        "completed_at": iso_date(row.get("Date Done")) if done else None,
        "remarks": "\n".join(filter(None, [comment, text_of(row.get("Remarks")), text_of(row.get("Description"))])) or None,
        "payment_tracked": not done,   # old finished work has no fee, so it stays out of payment tracking
        "legacy_key": legacy_key(row.get("Task Name"), type_, created),
        "money_comment": bool(comment and MONEY.search(comment)),
    }


def mark_repeats(rows):
    """Staging rows in file order. A key that appears twice holds both rows for review."""
    out = [{"row_no": i, "legacy_key": (m := map_row(r))["legacy_key"], "raw": dict(r), "mapped": m, "state": "staged", "reason": None}
           for i, r in enumerate(rows, start=1)]
    seen = collections.Counter(o["legacy_key"] for o in out)
    for o in out:
        if seen[o["legacy_key"]] > 1:
            o["state"], o["reason"] = "held", HOLD_REASON
    return out


def report(rows):
    states = collections.Counter(r["state"] for r in rows)
    print(f"{len(rows)} rows, {states['staged']} staged, {states['held']} held")
    print("\nBy status:")
    for k, n in collections.Counter(r["mapped"]["work_status"] for r in rows).most_common():
        print(f"  {n:4}  {k}")
    print("\nBy type:")
    for k, n in collections.Counter(r["raw"].get("Type of work", "") for r in rows).most_common():
        print(f"  {n:4}  {k} -> {TYPES.get(k, k)}")
    held = [r for r in rows if r["state"] == "held"]
    print(f"\nHeld rows ({len(held)}):")
    for r in held:
        print(f"  row {r['row_no']}: {r['mapped']['client_name']} | {r['raw'].get('Type of work')} | {r['mapped']['created_at']}")
    money = [r for r in rows if r["mapped"]["money_comment"]]
    print(f"\nComments about money ({len(money)}), for staff to enter a fee:")
    for r in money:
        print(f"  row {r['row_no']}: {r['mapped']['client_name']} | {r['mapped']['work_status']} | {clean(r['raw'].get('Comment (short text)'))}")


def sql_of(rows):
    lines = ["begin;"]
    for r in rows:
        raw, mapped = json.dumps(r["raw"], ensure_ascii=False), json.dumps(r["mapped"], ensure_ascii=False)
        if "$legacy$" in raw + mapped:
            raise SystemExit("The export contains the SQL quote marker")
        reason = "null" if r["reason"] is None else "'" + r["reason"].replace("'", "''") + "'"
        lines.append(
            "insert into public.accounting_legacy_rows (row_no, legacy_key, raw, mapped, state, reason) values "
            f"({r['row_no']}, '{r['legacy_key']}', $legacy${raw}$legacy$::jsonb, $legacy${mapped}$legacy$::jsonb, '{r['state']}', {reason}) "
            "on conflict (legacy_key, row_no) do nothing;")
    lines.append("commit;")
    return "\n".join(lines) + "\n"


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path")
    ap.add_argument("--out", required=True, help="where to write the insert statements")
    return ap.parse_args(argv)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args(argv)
    with open(args.csv_path, encoding="utf-8-sig", newline="") as f:
        rows = mark_repeats(list(csv.DictReader(f)))
    report(rows)
    with open(args.out, "w", encoding="utf-8") as out:
        out.write(sql_of(rows))
    print(f"\nWritten to {args.out}")


if __name__ == "__main__":
    main()
