"""Makes corrected copies of the Business Setup quote templates. The originals are not touched.

    python fix_templates.py "<folder of originals>" "<output folder>"

Double-brace tags become the single-brace tags the CRM's generator reads. Under activity headings, business_name
becomes business_activity (Liquidation keeps business_name, where it is the company name). Fixed add-on USD
figures are recalculated from one rate; AED figures stay as they are. Above the Total row, a Net row ({net},
{net_usd}) and a VAT row ({vat}, {vat_usd}) are added, and Total becomes "Total (incl. VAT)". The
files hold prices, so keep the output out of the repository and upload it as master templates in Settings.
"""
import re
import sys
import zipfile
from pathlib import Path

RATE = 3.6725
ACTIVITY_FIX = ("Mainland.docx", "Rakez.docx", "SHAMS.docx")
ALL = ("IFZA.docx", "Liquidation.docx", "Mainland.docx", "Rakez.docx", "SHAMS.docx")
ROW = re.compile(r"<w:tr[ >].*?</w:tr>", re.S)
CELL = re.compile(r"<w:tc>.*?</w:tc>", re.S)
PARA = re.compile(r"<w:p(?: [^>]*)?>.*?</w:p>", re.S)
TEXT = re.compile(r"(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)")


def cell_text(cell):
    return "".join(m.group(2) for m in TEXT.finditer(cell)).strip()


def set_cell(cell, value):
    """Puts value in the cell's first text run and empties the others, keeping all formatting."""
    done = [False]

    def sub(m):
        if done[0]:
            return m.group(1) + m.group(3)
        done[0] = True
        return m.group(1) + value + m.group(3)

    return TEXT.sub(sub, cell)


def number(s):
    s = s.replace(",", "").replace("$", "").strip()
    return int(s) if s.isdigit() else None


def fix_usd(xml):
    """Recalculates USD in add-on rows: rows after the Add-on heading with AED and USD numbers."""
    start = xml.find("Add-on")
    if start < 0:
        return xml, 0
    head, tail = xml[:start], xml[start:]
    changed = [0]

    def fix_row(m):
        row = m.group(0)
        cells = CELL.findall(row)
        if len(cells) < 3 or "{" in row:
            return row
        aed, usd = number(cell_text(cells[1])), number(cell_text(cells[2]))
        if aed is None or usd is None:
            return row
        want = round(aed / RATE)
        if want == usd:
            return row
        changed[0] += 1
        prefix = "$ " if "$" in cell_text(cells[2]) else ""
        return row.replace(cells[2], set_cell(cells[2], f"{prefix}{want:,}"))

    return head + ROW.sub(fix_row, tail), changed[0]


def _copy_row(row, label, tags):
    """A copy of the Total row with its own label and tags. Word's paragraph ids and bookmarks must be unique, so the copy drops them."""
    row = re.sub(r' w14:(?:paraId|textId)="[^"]*"', "", row)
    row = re.sub(r"<w:bookmark(?:Start|End)[^>]*/>", "", row)
    for old, new in tags.items():
        row = row.replace(old, new)
    return _label(row, label)


def _label(row, label):
    for cell in CELL.findall(row):
        text = cell_text(cell)
        if text.lower() == "total":
            return row.replace(cell, set_cell(cell, label.upper() if text.isupper() else label))
    return row


def add_vat_rows(xml):
    """Puts a Net row and a VAT row above the row that holds {total}. Returns the xml and how many rows were added; safe to run twice."""
    if "{net}" in xml:
        return xml, 0
    added = [0]

    def fix_row(m):
        row = m.group(0)
        if "{total}" not in row:
            return row
        if not any(cell_text(c).lower() == "total" for c in CELL.findall(row)):
            print("  WARNING: the row with {total} has no cell labelled Total, so the Net and VAT rows were not added")
            return row
        added[0] += 2
        net = _copy_row(row, "Net amount", {"{total_usd}": "{net_usd}", "{total}": "{net}"})
        vat = _copy_row(row, "VAT", {"{total_usd}": "{vat_usd}", "{total}": "{vat}"})
        return net + vat + _label(row, "Total (incl. VAT)")

    xml = ROW.sub(fix_row, xml)
    if not added[0]:
        print("  WARNING: no table row holds {total}; add the Net and VAT rows by hand")
    return xml, added[0]


def fix_activity(xml):
    return re.sub(r"\{\s*business_name\s*\}", "{business_activity}", xml)


def single_braces(xml):
    """Word may split a tag over several runs, so tags are rewritten per paragraph, in the paragraph's first run."""

    def fix_para(m):
        para = m.group(0)
        text = "".join(t.group(2) for t in TEXT.finditer(para))
        if "{" not in text and "}" not in text:
            return para
        fixed = re.sub(r"\{\{\s*", "{", re.sub(r"\s*\}\}", "}", text))
        return set_cell(para, fixed)

    return PARA.sub(fix_para, xml)


def fix_file(src, dst):
    changes = (0, 0)
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.fullmatch(r"word/(document|header\d*|footer\d*)\.xml", item.filename):
                xml = single_braces(data.decode("utf8"))
                if src.name in ACTIVITY_FIX:
                    xml = fix_activity(xml)
                if item.filename == "word/document.xml":
                    xml, changes = fix_usd(xml)
                    xml, rows = add_vat_rows(xml)
                    changes = (changes, rows)
                data = xml.encode("utf8")
            zout.writestr(item, data)
    return changes


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 2:
        print(__doc__)
        return 2
    src, out = Path(argv[0]), Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name in ALL:
        usd, rows = fix_file(src / name, out / name)
        print(f"{name}: {usd} USD cells changed, {rows} VAT rows added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
