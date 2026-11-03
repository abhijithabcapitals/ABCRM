"""Turns the old CRM's Banking Working Sheet export (CSV) into the staging call for migration 012.

    python legacy_crm_load.py "<export>.csv" --admin <profile uuid> --out "<folder>/legacy_stage.sql"

The export has two folders holding mostly the same deals under different field names. A Monthly Bank
Account row with the same company and bank as a Banking Sheet row, in the same date or month, is merged
into that row. Monthly "OPENING DATE" is treated as the signing date: it equals Banking Sheet "Signing Date"
on most paired rows. Writes SQL only and connects to nothing. The output holds client data, so keep it in
data/ (git-ignored).
"""
import argparse
import collections
import csv
import datetime
import hashlib
import io
import json
import re

MONTHLY = "Monthly Bank Account"
FIELDS = {  # mapped name: (Banking Sheet field, Monthly Bank Account field)
    "contact": ("Manager", None),
    "nationality": ("Nationality", "NATIONALITY"),
    "bank_raw": ("Bank", "BANK"),
    "rm": ("RM", "RM"),
    "referrer": ("Client Name", "CLIENT NAME"),
    "status_raw": ("Current Status", "Task Status"),
    "remarks": ("Remarks", None),
}
FINAL = ("Approved", "Rejected")
NAME_SUFFIX = re.compile(r"\b(LLC|L L C|FZE|FZCO|FZC|FZ|DMCC|SOC|SP|CO|COMPANY|LTD|LIMITED|OPC|SPC|EST|ESTABLISHMENT)\b")


def clean(value):
    text = re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()
    return text or None


def money(value):
    """'AED4,000' to 4000. 'AED-', '-' and text without a figure are blank, never zero."""
    text = clean(value)
    if not text or not re.fullmatch(r"(AED)?\s*[\d,]+(\.\d+)?", text):
        return None
    return float(re.sub(r"[^\d.]", "", text))


def iso_date(value):
    """'2026-07-30' or '22/05/2025' to ISO. Anything else is blank."""
    text = clean(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def payment_note(value):
    text = clean(value)
    return None if text is None or re.fullmatch(r"(AED)?\s*-", text) else text


def status_of(raw, task_status):
    """Application status and any note. Text with no clear meaning returns no status."""
    text = (clean(raw) or "").upper()
    if text == "APPROVED":
        return "Approved", None
    if text == "WIP":
        return "Document Collection", None
    if text.startswith("HOLD"):
        return "On Hold", None
    if "REFUND" in text:
        return "Rejected", f'Status says "{clean(raw)}": confirm the refund'
    if text.startswith("REJECT") or text == "DECLINED":
        return "Rejected", None
    if text in ("NOT YET SIGNED", "NOT YET APPLIED", "AGENT VISIT IS PENDING"):
        return "Document Collection", f'Status says "{clean(raw)}"'
    if task_status == "Rejected":
        return "Rejected", "Current status blank: taken from the task status Rejected"
    return None, f'Status not understood: "{clean(raw)}"' if text not in ("", ".", "AED-") else None


def company_key(name):
    text = re.sub(r"[^A-Z0-9 ]", " ", (name or "").upper())
    return re.sub(r"\s+", "", NAME_SUFFIX.sub(" ", text))


def bank_key(raw):
    """Spelling and account type removed, for pairing the two folders only."""
    text = re.sub(r"\bPERSONAL\b", " ", (clean(raw) or "").upper())
    text = re.sub(r"\s+", " ", text).strip()
    if text.startswith(("MASHREQ", "MASHERQ")):
        return "MASHREQ"
    if text.startswith("RAK"):
        return "RAK"
    return {"WIO BANK": "WIO", "EMIRATES ISLAMIC BANK": "EIB", "EMIRATES ISLAMIC": "EIB", "M BANK": "MBANK"}.get(text, text)


def to_row(task):
    fields = {f["field_name"]: f["value"] for f in json.loads(task["custom_fields"])}
    monthly = task["folder_name"] == MONTHLY
    pick = 1 if monthly else 0
    mapped = {name: clean(fields.get(names[pick])) if names[pick] else None for name, names in FIELDS.items()}
    mapped["company"] = clean(task["title"])
    mapped["fee"] = money(fields.get("FEES" if monthly else "Fees"))
    mapped["rm_fee"] = money(fields.get("RM FEES" if monthly else "RM KB"))
    mapped["signing_date"] = iso_date(fields.get("OPENING DATE" if monthly else "Signing Date"))
    mapped["opening_date"] = None if monthly else iso_date(fields.get("Opening Date"))
    month = iso_date(fields.get("Month_Year"))
    mapped["lead_date"] = mapped["signing_date"] or month
    bank = (mapped["bank_raw"] or "").upper()
    if "PERSONAL" in bank:
        mapped["account_kind"] = "Personal"
        mapped["bank_raw"] = clean(re.sub(r"\bPERSONAL\b", " ", bank))
    status, note = status_of(mapped["status_raw"], task["status"])
    return {
        "task_id": task["source_task_id"],
        "folder": task["folder_name"],
        "status": status,
        "payment_note": payment_note(fields.get("PAYMENT STATUS" if monthly else "Payment")),
        "issues": [note] if note else [],
        "holds": [],
        "raw": {task["folder_name"]: {"Task ID": task["source_task_id"], "Task Status": task["status"], "Title": task["title"], "Created": task["created_at"], **fields}},
        "mapped": mapped,
        "month": (mapped["signing_date"] or month or "")[:7],
    }


def merge(main, other):
    """Folds a Monthly row into its Banking Sheet row. Blanks fill; real disagreements are held for a person."""
    a, b = main["mapped"], other["mapped"]
    for name, value in b.items():
        if a.get(name) in (None, ""):
            a[name] = value
    if b["fee"] and a["fee"] and a["fee"] != b["fee"]:
        main["holds"].append(f"Fee differs between folders: Banking Sheet {a['fee']:.0f}, Monthly {b['fee']:.0f}")
    s1, s2 = main["status"], other["status"]
    if s1 and s2 and s1 != s2:
        if s1 in FINAL and s2 in FINAL:
            main["holds"].append(f"Status differs between folders: Banking Sheet {s1}, Monthly {s2}")
        else:
            # A final result outranks work in progress; On Hold outranks plain work in progress.
            order = {"Document Collection": 0, "On Hold": 1, "Approved": 2, "Rejected": 2}
            main["status"] = s1 if order[s1] >= order[s2] else s2
            main["issues"].append(f"Status differs between folders: Banking Sheet {s1}, Monthly {s2}. Used {main['status']}")
    else:
        main["status"] = s1 or s2
    if other["payment_note"] and other["payment_note"] != main["payment_note"]:
        main["payment_note"] = " | ".join(filter(None, [main["payment_note"], other["payment_note"]]))
    main["issues"] += [i for i in other["issues"] if i not in main["issues"]]
    main["raw"].update(other["raw"])
    main["month"] = main["month"] or other["month"]


def combine(rows):
    """One row per deal. Returns the rows and counts of what was merged."""
    sheet = collections.defaultdict(list)
    for row in rows:
        if row["folder"] != MONTHLY:
            sheet[company_key(row["mapped"]["company"]), bank_key(row["mapped"]["bank_raw"])].append(row)
    taken, out, counts = set(), [r for r in rows if r["folder"] != MONTHLY], collections.Counter()
    monthly = [r for r in rows if r["folder"] == MONTHLY]
    for test, label in ((lambda m, s: m["mapped"]["signing_date"] and m["mapped"]["signing_date"] == s["mapped"]["signing_date"], "same date"),
                        (lambda m, s: m["month"] and m["month"] == s["month"], "same month")):
        rest = []
        for m in monthly:
            pool = sheet.get((company_key(m["mapped"]["company"]), bank_key(m["mapped"]["bank_raw"])), [])
            hit = next((s for s in pool if s["task_id"] not in taken and test(m, s)), None)
            if hit:
                taken.add(hit["task_id"])
                merge(hit, m)
                counts[f"merged, {label}"] += 1
            else:
                rest.append(m)
        monthly = rest
    for m in monthly:
        pool = sheet.get((company_key(m["mapped"]["company"]), bank_key(m["mapped"]["bank_raw"])), [])
        if pool:
            m["holds"].append("Same company and bank is in the Banking Sheet with another date: same deal or a new attempt?")
            counts["held, other date"] += 1
        else:
            counts["monthly only"] += 1
        out.append(m)
    for row in out:
        if row["holds"]:
            row["mapped"]["hold_reason"] = "; ".join(row["holds"])
        del row["holds"], row["folder"], row["month"]
    return out, counts


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv_path")
    ap.add_argument("--admin", required=True, help="profiles.id of the admin the import is recorded under")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    data = open(args.csv_path, "rb").read()
    tasks = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
    rows, counts = combine([to_row(t) for t in tasks])
    name = args.csv_path.replace("\\", "/").rsplit("/", 1)[-1]
    body = json.dumps(rows, ensure_ascii=False)
    if "$legacy$" in body:
        raise SystemExit("The export contains the SQL quote marker")
    with open(args.out, "w", encoding="utf-8") as out:
        out.write("begin;\n")
        out.write(f"select set_config('request.jwt.claim.sub', '{args.admin}', true);\n")
        out.write(f"select public.banking_legacy_stage('{name}', '{hashlib.sha256(data).hexdigest()}', $legacy${body}$legacy$::jsonb);\n")
        out.write("commit;\n")
    print(f"{len(tasks)} tasks became {len(rows)} rows: {dict(counts)}. Written to {args.out}")


if __name__ == "__main__":
    main()
