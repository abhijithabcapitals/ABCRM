"""Turns the Business Setup department's workbooks and old CRM exports into rows for migration 012.

    python legacy_load.py --resources "<folder>" --out "<folder>/rows.json"
    python legacy_load.py --resources "<folder>" --out "<folder>/rows.json" --sql-out "<folder>/stage.sql" --import-id <uuid>

The Master List sheet is the authority for licence data and Business Setup Master for visa dates. The CSV
exports are read only for status, because their other custom columns came out empty. Writes files and
connects to nothing. The output holds client data, so keep it out of the repository. The printed report
holds counts and zone names only.
"""
import argparse
import collections
import csv
import datetime
import json
import re
import sys
from pathlib import Path

import openpyxl

WORK_SHEET = "Work Sheet AB Capital 27102026.xlsx"
VISA_SHEET = "Business Setup Master.xlsx"
EJARI_SHEET = "Ejari List.xlsx"
CHUNK = 200

ZONES = {
    "ifza": "IFZA", "rakez": "RAKEZ", "shams": "SHAMS", "srtip": "SRTIP", "srtip acc": "SRTIP",
    "det": "Dubai Mainland", "ded": "Dubai Mainland", "dubai mainland": "Dubai Mainland", "difc": "DIFC", "meydan": "Meydan",
    "jafza": "JAFZA", "jafza -redomicile": "JAFZA", "dmcc": "DMCC", "adra": "ADRA", "afz": "Ajman Free Zone", "kezad": "KEZAD",
    "dwc": "Dubai South", "fcc": "Fujairah Creative City", "uaq": "UAQ Free Zone", "dubai commercity": "Dubai CommerCity",
    "hamriyah": "Hamriyah Free Zone", "hamriyah freezone": "Hamriyah Free Zone", "rak icc": "RAK ICC", "abu dhabi": "Abu Dhabi Mainland",
}


class FileLocked(Exception):
    pass


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def map_zone(s):
    return ZONES.get(re.sub(r"\s+", " ", str(s or "")).strip().lower())


def parse_date(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = str(v or "").strip()
    for pattern, fmt in ((r"^\d{1,2}/\d{1,2}/\d{4}$", "%d/%m/%Y"), (r"^\d{4}-\d{2}-\d{2}$", "%Y-%m-%d")):
        if re.match(pattern, s):
            try:
                return datetime.datetime.strptime(s, fmt).strftime("%Y-%m-%d")
            except ValueError:
                return None
    return None


def bad_dates(fields):
    return [k for k, v in fields.items() if v not in (None, "") and parse_date(v) is None]


def check_not_open(path):
    path = Path(path)
    if (path.parent / ("~$" + path.name)).exists():
        raise FileLocked(f"{path.name} is open in Excel. Save and close it first.")


def master_csv_row(row):
    return {"name": row["Task Name"].strip(), "status": row["Status"].strip()}


def _text(v):
    s = str(v).strip() if v not in (None, "") else None
    return s or None


def _sheet(ws):
    """Rows as dicts, keyed by stripped header, from the first row holding Company Name."""
    rows = ws.iter_rows(values_only=True)
    head = None
    for r in rows:
        if head is None:
            if any(str(c).strip() == "Company Name" for c in r if c is not None):
                head = [str(c).strip() if c is not None else None for c in r]
            continue
        if any(c not in (None, "") for c in r):
            yield {h: c for h, c in zip(head, r) if h}


def _csv(folder, prefix):
    files = sorted(Path(folder).glob(prefix + "*.csv"))
    if not files:
        return []
    with open(files[-1], encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def collect(folder):
    folder = Path(folder)
    rows = []
    seen = collections.Counter()

    def add(source, name, company, payload, key):
        seen[(source, key)] += 1
        n = seen[(source, key)]
        rows.append({"source": source, "source_key": f"{source}:{key}" + (f":{n}" if n > 1 else ""), "name": name, "company": company, "payload": payload})

    statuses = {norm(r["Task Name"]): master_csv_row(r)["status"] for r in _csv(folder, "Master_List_export")}
    wb = openpyxl.load_workbook(folder / WORK_SHEET, read_only=True, data_only=True)
    for r in _sheet(wb["Master List"]):
        name = _text(r.get("Company Name"))
        if not name:
            continue
        zone_raw = _text(r.get("Free Zone"))
        payload = {
            "licence_number": _text(r.get("License Number")), "licence_date": parse_date(r.get("License Date")), "licence_expiry": parse_date(r.get("Expiry Date")),
            "jurisdiction": map_zone(zone_raw), "zone_raw": zone_raw, "client_status": statuses.get(norm(name)), "kyc_form": _text(r.get("KYC Form")),
            "shareholder": _text(r.get("Shareholder")), "manager": _text(r.get("Manager")), "lease_source": _text(r.get("Leasd Source")), "visa": _text(r.get("VISA")),
            "remarks": _text(r.get("Remarks")), "comment": _text(r.get("Comment")), "commission_status": _text(r.get("Commssion status")), "ct_reg": _text(r.get("CT Reg")),
            "visa_utilised": _text(r.get("Visa Utilised")), "commission": _text(r.get("Commisiion")),
            "bad_dates": bad_dates({"licence_date": r.get("License Date"), "licence_expiry": r.get("Expiry Date")}),
        }
        add("company", name, name, payload, norm(name))

    visa_status = {}
    for r in _csv(folder, "VISA_Master_List_export"):
        visa_status.setdefault(norm(r["Task Name"]), r["Status"].strip())
    wb = openpyxl.load_workbook(folder / VISA_SHEET, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    head = None
    for r in ws.iter_rows(values_only=True):
        if head is None:
            if any(str(c).strip() == "Company Name" for c in r if c is not None):
                head = [str(c).strip() if c is not None else None for c in r]
            continue
        d = {h: c for h, c in zip(head, r) if h}
        name = _text(d.get("Name"))
        if not name:
            continue
        company = _text(d.get("Company Name"))
        payload = {
            "occupation": _text(d.get("Visa Title (Occupation)")), "issue_date": parse_date(d.get("Visa Issue Date")), "expiry_date": parse_date(d.get("Visa Expiry Date")),
            "status": visa_status.get(norm(name)), "update_2026": _text(d.get("2026 Updates")),
            "bad_dates": bad_dates({"issue_date": d.get("Visa Issue Date"), "expiry_date": d.get("Visa Expiry Date")}),
        }
        add("visa", name, company, payload, f"{norm(name)}:{norm(company)}")

    wb = openpyxl.load_workbook(folder / EJARI_SHEET, read_only=True, data_only=True)
    for r in _sheet(wb.worksheets[0]):
        name = _text(r.get("Company Name"))
        if name:
            add("ejari", name, name, {"provider": _text(r.get("Ejari"))}, norm(name))

    for r in _csv(folder, "Business_Set_up_Team_export"):
        name = _text(r.get("Task Name"))
        if name:
            payload = {"old_status": _text(r.get("Status")), "assignee": _text(r.get("Assignee")), "created": _text(r.get("Date Created")), "done": _text(r.get("Date Done")),
                       "zone": _text(r.get("FREEZONE/DED")), "domain": _text(r.get("Domain")), "payment_status": _text(r.get("Payment Status")), "remarks": _text(r.get("Remarks"))}
            add("service", name, name, payload, f"{norm(name)}:{r.get('Date Created', '')}")

    for r in _csv(folder, "Quotations_by_CRM_export"):
        name = _text(r.get("Task Name"))
        if name:
            add("quotation", name, None, {"zone": _text(r.get("Free Zone")), "date": _text(r.get("Quotation Date")), "activity": _text(r.get("Activity"))}, f"{norm(name)}:{r.get('Quotation Date', '')}")
    return rows


def report(rows):
    by = collections.Counter(r["source"] for r in rows)
    for s in ("company", "visa", "ejari", "service", "quotation"):
        print(f"{s}: {by[s]}")
    unmapped = collections.Counter(r["payload"]["zone_raw"] for r in rows if r["source"] == "company" and r["payload"]["zone_raw"] and not r["payload"]["jurisdiction"])
    print("zones not mapped:", dict(unmapped))
    mapped = collections.Counter(r["payload"]["jurisdiction"] for r in rows if r["source"] == "company" and r["payload"]["jurisdiction"])
    print("zones mapped:", dict(mapped))
    print("rows with a date that is not a date:", {s: sum(1 for r in rows if r["source"] == s and r["payload"].get("bad_dates")) for s in ("company", "visa")})
    print("companies with no status from the old CRM:", sum(1 for r in rows if r["source"] == "company" and not r["payload"]["client_status"]))
    companies = {norm(r["name"]) for r in rows if r["source"] == "company"}
    for s in ("visa", "ejari", "service"):
        hit = sum(1 for r in rows if r["source"] == s and norm(r["company"]) in companies)
        print(f"{s} rows whose company name matches the Master List exactly: {hit} of {by[s]}")


def main(argv=None):
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--resources", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--sql-out")
    a.add_argument("--import-id")
    a.add_argument("--ignore-lock", action="store_true", help="read a workbook that is open in Excel; for a dry run only, as it may be missing unsaved edits")
    args = a.parse_args(argv)
    if args.sql_out and not args.import_id:
        a.error("--sql-out needs --import-id")
    if not args.ignore_lock:
        for name in (WORK_SHEET, VISA_SHEET, EJARI_SHEET):
            check_not_open(Path(args.resources) / name)
    rows = collect(args.resources)
    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf8")
    if args.sql_out:
        with open(args.sql_out, "w", encoding="utf8") as f:
            for i in range(0, len(rows), CHUNK):
                body = json.dumps(rows[i:i + CHUNK], ensure_ascii=False)
                if "$json$" in body:
                    raise ValueError("A row holds the SQL quote marker")
                f.write(f"select public.business_setup_import_stage('{args.import_id}', $json${body}$json$::jsonb);\n")
    report(rows)


if __name__ == "__main__":
    sys.exit(main())
