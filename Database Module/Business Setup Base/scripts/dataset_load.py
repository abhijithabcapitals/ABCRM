"""Prepares the department's active client sheet for the Import tab.

Every company with a name is captured as written. A blank stays blank, and the Clients list shows it as missing.
Writes rows to --out and, with --sql-out, the statements that stage them. Staging loads nothing: a person applies
on the Import tab. No login is issued and nothing is sent to clients.
"""
import argparse
import collections
import datetime
import json
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from legacy_load import _text, check_not_open, map_zone, norm, parse_date  # noqa: E402

CHUNK = 50
MAIN = ("service", "jurisdiction", "licence_number", "licence_issue", "licence_expiry", "shareholder", "manager", "visa")


def licence_text(v):
    """A licence number is text. Excel holds many as numbers, some with a .01 ending that is part of the number."""
    if isinstance(v, float) and v == int(v):
        v = int(v)
    s = _text(v)
    return None if s and "liquidat" in s.lower() else s


def whole_years(a, b):
    """True when an expiry falls a whole number of years after the issue date, give or take a day."""
    a, b = datetime.date.fromisoformat(a), datetime.date.fromisoformat(b)
    if b <= a:
        return False
    for years in range(1, 31):
        try:
            t = a.replace(year=a.year + years)
        except ValueError:
            t = a.replace(year=a.year + years, day=28)
        if abs((t - b).days) <= 1:
            return True
    return False


def status_of(r):
    remark = (_text(r.get("Remarks")) or "").lower()
    for word, status in (("cancelled", "Cancelled"), ("rejected", "Rejected"), ("pending", "Pending")):
        if remark == word:
            return status
    fields = [r.get("Service Offered"), r.get("Zone Applied"), r.get("CT Reg"), r.get("License Number"), r.get("License Date"), r.get("Remarks")]
    if any("liquidat" in str(v or "").lower() for v in fields):
        return "Liquidated"
    return "Active"


def collect(path):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    all_rows = list(ws.iter_rows(values_only=True))
    at = next(i for i, r in enumerate(all_rows) if any(str(c).strip() == "Company Name" for c in r if c is not None))
    head = [str(c).strip() if c is not None else None for c in all_rows[at]]
    rows, seen = [], collections.Counter()
    for raw in all_rows[at + 1:]:
        r = {h: c for h, c in zip(head, raw) if h}
        name = _text(r.get("Proper Format")) or _text(r.get("Company Name"))
        if not name:
            continue
        zone_raw = _text(r.get("Zone Applied"))
        zone = None if "liquidat" in (zone_raw or "").lower() else (map_zone(zone_raw) or zone_raw)
        issue, expiry = parse_date(r.get("License Date")), parse_date(r.get("Expiry Date"))
        payload = {
            "service": _text(r.get("Service Offered")), "jurisdiction": zone, "zone_as_written": zone_raw, "licence_number": licence_text(r.get("License Number")),
            "licence_date": issue, "licence_issue": issue, "licence_expiry": expiry, "shareholder": _text(r.get("Shareholder")), "manager": _text(r.get("Manager")),
            "visa": _text(r.get("VISA")), "client_status": status_of(r), "kyc_form": "Done", "kyc_form_sheet": _text(r.get("KYC Form")),
            "lease_source": _text(r.get("Leasd Source")), "remarks": _text(r.get("Remarks")), "comment": _text(r.get("Comment")),
            "commission_status": _text(r.get("Commssion status")), "ct_reg": _text(r.get("CT Reg")), "visa_utilised": _text(r.get("Visa Utilised")),
            "dates_to_check": bool(issue and expiry and not whole_years(issue, expiry)) or None,
        }
        key = norm(name)
        seen[key] += 1
        rows.append({"source": "company", "source_key": f"company:dataset:{key}" + (f":{seen[key]}" if seen[key] > 1 else ""), "name": name, "company": name,
                     "payload": {k: v for k, v in payload.items() if v is not None}})
    return rows


def report(rows):
    print("companies:", len(rows))
    print("status:", dict(collections.Counter(r["payload"]["client_status"] for r in rows)))
    for key in MAIN:
        print(f"missing {key}:", sum(1 for r in rows if key not in r["payload"]))
    print("rows with any main field missing:", sum(1 for r in rows if any(k not in r["payload"] for k in MAIN)))
    print("dates to check:", sum(1 for r in rows if r["payload"].get("dates_to_check")))
    print("same name twice:", [r["source_key"] for r in rows if r["source_key"].count(":") > 2])


def main(argv=None):
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--file", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--sql-out")
    a.add_argument("--import-id")
    a.add_argument("--admin", help="profile of the person staging the rows, who needs setup.import.manage")
    args = a.parse_args(argv)
    if args.sql_out and not (args.import_id and args.admin):
        a.error("--sql-out needs --import-id and --admin")
    check_not_open(args.file)
    rows = collect(args.file)
    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf8")
    if args.sql_out:
        with open(args.sql_out, "w", encoding="utf8") as f:
            f.write(f"begin;\nselect set_config('request.jwt.claim.sub', '{args.admin}', true);\n")
            for i in range(0, len(rows), CHUNK):
                body = json.dumps(rows[i:i + CHUNK], ensure_ascii=False)
                if "$json$" in body:
                    raise ValueError("A row holds the SQL quote marker")
                f.write(f"select public.business_setup_import_stage('{args.import_id}', $json${body}$json$::jsonb);\n")
            f.write("commit;\n")
    report(rows)


if __name__ == "__main__":
    sys.exit(main())
