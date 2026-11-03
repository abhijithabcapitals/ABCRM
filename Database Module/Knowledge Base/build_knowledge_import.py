"""Build data/knowledge_import.sql for the staff Knowledge tab.

Reads the pricing study workbook (sheet "Proposed Prices") and the old wiki article export, and writes
INSERT statements for knowledge_price_lines and knowledge_entries. Every insert ends with
"on conflict (source_ref) do nothing", so a re-run adds new rows and never overwrites edited ones.
The output holds prices, so it goes to the git-ignored data/ folder.

    python build_knowledge_import.py --study "path/to/Pricing Study 2026-11-03.xlsx"
"""
import argparse
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDY_DATE = "2026-11-03"
SHEET = "Proposed Prices"
PRICE_CATEGORY = "Business Setup"
CATEGORY_MAP = {
    "Business Set Up": "Business Setup",
    "Banking Team": "Banking",
    "Accounting and Tax Compliances": "Accounting",
}
FLAGGED_PREFIXES = ("sponsor visa cost", "services price list for")


def _text(value):
    return "" if value is None else str(value).strip()


def _amount(value):
    """Return a two-place Decimal, or None when the cell is blank, text, negative or not a plain number."""
    if value is None or isinstance(value, (bool, str)):
        return None
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None
    return amount if amount.is_finite() and amount >= 0 else None


def parse_price_rows(rows, study_date=STUDY_DATE):
    """Return (lines, skipped) from every row of the sheet. The USD column is ignored."""
    rows = list(rows)
    header_at = next((i for i, r in enumerate(rows) if any(_text(c) == "Template" for c in r)), None)
    if header_at is None:
        raise ValueError("No header row with a Template cell was found.")
    col = {_text(c): i for i, c in enumerate(rows[header_at]) if _text(c)}
    missing = [n for n in ("Template", "Group", "Item", "AED", "Who gets it", "Confidence", "Basis") if n not in col]
    if missing:
        raise ValueError(f"Header is missing: {', '.join(missing)}")

    def cell(row, name):
        return row[col[name]] if col[name] < len(row) else None

    lines, skipped, seen = [], [], set()
    for number, row in enumerate(rows[header_at + 1:], start=header_at + 2):  # number = sheet row number
        if not any(_text(c) for c in row):
            continue
        template, group, item = _text(cell(row, "Template")), _text(cell(row, "Group")), _text(cell(row, "Item"))
        if not (template and group and item):
            skipped.append({"row": number, "reason": "Template, Group or Item is blank"})
            continue
        amount = _amount(cell(row, "AED"))
        if amount is None:
            skipped.append({"row": number, "reason": "AED is blank, text or not a valid amount"})
            continue
        payee, confidence = _text(cell(row, "Who gets it")), _text(cell(row, "Confidence"))
        internal = confidence.lower() == "low" or payee.lower() == "third party"
        ref = f"study:{study_date}:{template}|{group}|{item}"
        if ref in seen:
            ref = f"{ref}|row {number}"
        seen.add(ref)
        lines.append({
            "category": PRICE_CATEGORY, "template": template, "line_group": group, "item": item,
            "amount_aed": amount, "payee": payee or None, "confidence": confidence or None,
            "basis": _text(cell(row, "Basis")) or None, "status": "Draft",
            "visibility": "Internal" if internal else "Shareable", "source_ref": ref,
        })
    return lines, skipped


def parse_articles(rows, categories):
    """Return (entries, skipped, flagged). categories maps old category id to old category name."""
    skipped, kept = [], {}
    for row in rows:
        title = _text(row.get("title"))
        if _text(row.get("deleted_at")):
            skipped.append({"id": row["id"], "title": title, "reason": "deleted in the old wiki"})
            continue
        entry = {
            "category": CATEGORY_MAP.get(categories.get(_text(row.get("category_id")), ""), "General"),
            "entry_type": "checklist" if "documents" in title.lower() else "procedure",
            "title": title, "body": row.get("content") or "", "status": "Draft", "visibility": "Internal",
            "source_ref": f"wiki:{row['id']}",
        }
        key = title.casefold()
        if key in kept:
            old = kept[key]
            winner, loser = (entry, old) if len(entry["body"]) > len(old["body"]) else (old, entry)
            kept[key] = winner
            skipped.append({"id": loser["source_ref"][5:], "title": title, "reason": (
                f"duplicate title: kept {winner['source_ref']} ({len(winner['body'])} chars), "
                f"dropped {loser['source_ref']} ({len(loser['body'])} chars)")})
        else:
            kept[key] = entry
    entries = list(kept.values())
    flagged = [{"title": e["title"], "source_ref": e["source_ref"]} for e in entries
               if e["title"].lower().startswith(FLAGGED_PREFIXES)]
    return entries, skipped, flagged


def q(value):
    """SQL string literal, or null."""
    if value is None:
        return "null"
    return "'" + str(value).replace("\x00", "").replace("'", "''") + "'"


def _category(name):
    return f"(select id from public.knowledge_categories where name = {q(name)})"


def build_sql(lines, entries):
    out = [
        "-- Knowledge import. Holds prices: keep it out of Git. Re-running adds new rows only.",
        f"-- {len(lines)} price lines, {len(entries)} entries",
        "set client_encoding to 'UTF8';",
        "begin;",
    ]
    for l in lines:
        out.append(
            "insert into public.knowledge_price_lines (category_id, template, line_group, item, amount_aed, payee, "
            "confidence, basis, status, visibility, source_ref) values ("
            f"{_category(l['category'])}, {q(l['template'])}, {q(l['line_group'])}, {q(l['item'])}, "
            f"{l['amount_aed']}, {q(l['payee'])}, {q(l['confidence'])}, {q(l['basis'])}, {q(l['status'])}, "
            f"{q(l['visibility'])}, {q(l['source_ref'])}) on conflict (source_ref) do nothing;")
    for e in entries:
        out.append(
            "insert into public.knowledge_entries (category_id, entry_type, title, body, status, visibility, source_ref) "
            f"values ({_category(e['category'])}, {q(e['entry_type'])}, {q(e['title'])}, {q(e['body'])}, "
            f"{q(e['status'])}, {q(e['visibility'])}, {q(e['source_ref'])}) on conflict (source_ref) do nothing;")
    out.append("commit;")
    return "\n".join(out) + "\n"


def read_study(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)  # data_only: a formula gives its saved value
    try:
        return list(wb[SHEET].iter_rows(values_only=True))
    finally:
        wb.close()


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--study", required=True, help="path to the pricing study workbook")
    ap.add_argument("--articles", default=str(HERE / "wiki_articles_rows.csv"))
    ap.add_argument("--categories", default=str(HERE / "wiki_categories_rows.csv"))
    ap.add_argument("--out", default=str(HERE / "data" / "knowledge_import.sql"))
    args = ap.parse_args()
    csv.field_size_limit(2**31 - 1)

    lines, price_skipped = parse_price_rows(read_study(args.study))
    article_rows = read_csv(args.articles)
    categories = {r["id"]: r["name"] for r in read_csv(args.categories)}
    entries, art_skipped, flagged = parse_articles(article_rows, categories)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_sql(lines, entries), encoding="utf-8")

    low = sum(1 for l in lines if (l["confidence"] or "").lower() == "low")
    held = sum(1 for l in lines if l["visibility"] == "Internal")
    deleted = sum(1 for s in art_skipped if s["reason"].startswith("deleted"))
    dupes = [s for s in art_skipped if s["reason"].startswith("duplicate")]
    print(f"Price lines: {len(lines) + len(price_skipped)} read ({low} Low confidence), {len(lines)} to import "
          f"({held} held Internal, {len(lines) - held} Shareable), {len(price_skipped)} skipped")
    for s in price_skipped:
        print(f"  skipped sheet row {s['row']}: {s['reason']}")
    print(f"Articles: {len(article_rows)} rows, {deleted} deleted, {len(dupes)} duplicate dropped, {len(entries)} to import")
    for s in dupes:
        print(f"  duplicate '{s['title']}': {s['reason']}")
    print(f"Flagged for review before sharing ({len(flagged)}):")
    for f in flagged:
        print(f"  {f['title']}")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
