"""Prepares the department's visa sheet for business_setup_visa_sheet_apply.

One row per person, captured as written. --links is a JSON file of {"COMPANY NAME AS WRITTEN": "CL000001"} for names a
person has matched by hand. Any other company is matched by exact name on the server, or added as a new client.
"""
import argparse
import collections
import json
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from legacy_load import _text, check_not_open, norm, parse_date  # noqa: E402

CHUNK = 500


def collect(path, links=None):
    links = {norm(k): v for k, v in (links or {}).items()}
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    all_rows = list(ws.iter_rows(values_only=True))
    at = next(i for i, r in enumerate(all_rows) if any(str(c).strip() == "Company Name" for c in r if c is not None))
    head = [str(c).strip() if c is not None else None for c in all_rows[at]]
    rows, seen = [], collections.Counter()
    for raw in all_rows[at + 1:]:
        r = {h: c for h, c in zip(head, raw) if h}
        person, company = _text(r.get("Name")), _text(r.get("Company Name"))
        if not person or not company:
            continue
        key = f"{norm(person)}:{norm(company)}"
        seen[key] += 1
        rows.append({"source_key": key + (f":{seen[key]}" if seen[key] > 1 else ""), "person": person, "company": company, "client_id": links.get(norm(company)),
                     "occupation": _text(r.get("Visa Title (Occupation)")), "issue_date": parse_date(r.get("Visa Issue Date")),
                     "expiry_date": parse_date(r.get("Visa Expiry Date")), "update": _text(r.get("2026 Updates"))})
    return rows


def main(argv=None):
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--file", required=True)
    a.add_argument("--links")
    a.add_argument("--sql-out", required=True)
    a.add_argument("--admin", required=True, help="profile of the person loading, who needs setup.import.manage")
    args = a.parse_args(argv)
    check_not_open(args.file)
    links = json.loads(Path(args.links).read_text(encoding="utf8")) if args.links else {}
    rows = collect(args.file, links)
    body = json.dumps(rows, ensure_ascii=False)
    if "$json$" in body:
        raise ValueError("A row holds the SQL quote marker")
    Path(args.sql_out).write_text(f"begin;\nselect set_config('request.jwt.claim.sub', '{args.admin}', true);\nselect public.business_setup_visa_sheet_apply($json${body}$json$::jsonb);\ncommit;\n", encoding="utf8")
    print("visas:", len(rows), "companies:", len({norm(r["company"]) for r in rows}), "linked by hand:", len({norm(r["company"]) for r in rows if r["client_id"]}))


if __name__ == "__main__":
    sys.exit(main())
