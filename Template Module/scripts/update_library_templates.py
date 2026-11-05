"""Prepares the six Company Library templates for upload in Template Hub > Settings > Library Templates.

    python update_library_templates.py "<folder of originals>" "<output folder>"
    python update_library_templates.py --check "<output folder>"

The originals are not touched. The files hold prices and bank details and the repository is public, so the output
folder must be outside any git repository. This script holds only headings and labels.
"""
import html
import re
import sys
import zipfile
from pathlib import Path

AB_CAPITAL = ("IFZA.docx", "Liquidation.docx", "Mainland.docx", "Rakez.docx", "SHAMS.docx")
ACTIVITY_FIX = ("Mainland.docx", "Rakez.docx", "SHAMS.docx")
ARDENTAX = "Ardentax_Master_Template.docx"
CLIENT_BLOCK = (
    ("Ref", "ref_no"),
    ("Client", "client_name"),
    ("Contact", "contact_name"),
    ("Email", "contact_email"),
    ("Phone", "contact_phone"),
)
# Every [bracket] in the Ardentax Master, in document order. None is the fee table, which is handled apart;
# an empty string leaves room for a physical stamp.
ARDENTAX_BRACKETS = (
    "document_title", "document_subtitle",
    "ref_no", "date", "version_status", "prepared_by", "approved_by", "confidentiality",
    "client_name", "trade_name", "signatory", "contact_name", "contact_phone", "contact_email", "client_address",
    "city_country", "license_number", "vat_trn",
    "purpose", "subject_matter", "scope", "assumptions", "exclusions",
    None, None, None, None, None, None, None, None, None, None,
    "payment_terms", "validity_term", "currency_tax",
    "terms_conditions", "data_protection", "attachments", "additional_notes",
    "declaration",
    "ardentax_signatory_name", "ardentax_signatory_title", "",
    "client_signatory_name", "client_signatory_title", "",
    "prepared_by", "prepared_date", "reviewed_by", "reviewed_date", "approved_by", "approved_date",
    "acceptance_by", "acceptance_date",
)
PARA = re.compile(r"<w:p(?: [^>]*)?>(?:(?!<w:p[ >]).)*?</w:p>", re.S)
ROW = re.compile(r"<w:tr(?: [^>]*)?>.*?</w:tr>", re.S)
TEXT = re.compile(r"(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)")
BRACKET = re.compile(r"\[[^\]]*\]")
TAG = re.compile(r"\{\{\s*[#/]?\s*[A-Za-z_][\w.]*\s*\}\}")


class TemplateError(Exception):
    pass


def text_of(xml):
    return html.unescape("".join(m.group(2) for m in TEXT.finditer(xml)))


def add_client_block(xml, name):
    """Puts the Ref and client lines straight after the date, in the date's font, on the left margin."""
    date = next((m for m in PARA.finditer(xml) if re.search(r"\{\{\s*date\s*\}\}", text_of(m.group(0)))), None)
    if not date:
        raise TemplateError(f"{name}: the date line was not found")
    para = date.group(0)
    ppr = re.search(r"<w:pPr>.*?</w:pPr>", para, re.S)
    rpr = re.search(r"<w:r(?: [^>]*)?>\s*(<w:rPr>.*?</w:rPr>)", para, re.S)
    if not rpr:
        raise TemplateError(f"{name}: the date line has no run formatting")
    para_props = re.sub(r"<w:ind [^>]*/>", "", ppr.group(0)) if ppr else ""
    lines = "".join(
        f'<w:p>{para_props}<w:r>{rpr.group(1)}<w:t xml:space="preserve">{label}: {{{{ {tag} }}}}</w:t></w:r></w:p>'
        for label, tag in CLIENT_BLOCK
    )
    return xml[:date.end()] + lines + xml[date.end():]


def fix_activity(xml, name):
    fixed, count = re.subn(r"\{\{\s*business_name\s*\}\}", "{{ business_activity }}", xml)
    if not count:
        raise TemplateError(f"{name}: the business_name field was not found")
    return fixed


def fix_ab_capital(xml, name):
    if name in ACTIVITY_FIX:
        xml = fix_activity(xml, name)
    return add_client_block(xml, name)


def fix_fee_table(xml, name):
    """One repeating row and a total. The CRM does not calculate VAT, so the subtotal and VAT rows go."""
    head = xml.find("ITEM")
    end = xml.find("</w:tbl>", head)
    if head < 0 or end < 0:
        raise TemplateError(f"{name}: the fee table was not found")
    start = xml.rfind("<w:tbl>", 0, head)
    table = xml[start:end]
    rows = ROW.findall(table)
    if len(rows) != 6 or not all(word in text_of(rows[i]) for i, word in ((3, "Subtotal"), (4, "VAT"), (5, "Total"))):
        raise TemplateError(f"{name}: the fee table does not have the expected rows")

    def fill(row, values):
        left = iter(values)

        def sub(m):
            if not BRACKET.search(m.group(2)):
                return m.group(0)
            return m.group(1) + next(left) + m.group(3)

        return TEXT.sub(sub, row)

    table = table.replace(rows[1], fill(rows[1], ("{{#items}}{{ label }}", "{{ remarks }}", "{{ amount }}{{/items}}")), 1)
    table = table.replace(rows[2], "", 1).replace(rows[3], "", 1).replace(rows[4], "", 1)
    table = table.replace(rows[5], fill(rows[5], ("{{ total }}",)), 1)
    return xml[:start] + table + xml[end:]


def fix_ardentax(xml, name):
    found = [m for t in TEXT.finditer(xml) for m in BRACKET.finditer(t.group(2))]
    if len(found) != len(ARDENTAX_BRACKETS):
        raise TemplateError(f"{name}: expected {len(ARDENTAX_BRACKETS)} placeholders, found {len(found)}")
    tags = iter(ARDENTAX_BRACKETS)

    def bracket(_):
        tag = next(tags)
        if tag is None:
            return "[fee]"
        return f"{{{{ {tag} }}}}" if tag else ""

    def sub(m):
        return m.group(1) + BRACKET.sub(bracket, m.group(2)) + m.group(3)

    xml = TEXT.sub(sub, xml)
    xml = xml.replace("[fee]", "[0.00]")
    return fix_fee_table(xml, name)


def rewrite(src, dst, change):
    with zipfile.ZipFile(src) as old, zipfile.ZipFile(dst, "w") as new:
        for item in old.infolist():
            data = old.read(item.filename)
            if item.filename == "word/document.xml":
                data = change(data.decode("utf-8"), src.name).encode("utf-8")
            new.writestr(item, data)


def inside_git(folder):
    return any((p / ".git").exists() for p in [folder, *folder.parents])


def run(originals, output):
    if inside_git(output):
        raise TemplateError("The output folder is inside a git repository. These files must stay out of the repository.")
    output.mkdir(parents=True, exist_ok=True)
    for name in AB_CAPITAL:
        rewrite(originals / name, output / name, fix_ab_capital)
    rewrite(originals / ARDENTAX, output / ARDENTAX, fix_ardentax)


def check(output):
    for name in (*AB_CAPITAL, ARDENTAX):
        with zipfile.ZipFile(output / name) as z:
            text = "\n".join(text_of(p) for p in PARA.findall(z.read("word/document.xml").decode("utf-8")))
        tags = sorted({re.sub(r"[{}\s]", "", t) for t in TAG.findall(text)})
        print(f"{name}: {', '.join(tags)}")
        left = BRACKET.findall(text)
        if name == ARDENTAX and left:
            raise TemplateError(f"{name}: placeholders left: {left}")


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--check":
            check(Path(sys.argv[2]))
        elif len(sys.argv) == 3:
            run(Path(sys.argv[1]), Path(sys.argv[2]))
        else:
            sys.exit(__doc__)
    except TemplateError as e:
        sys.exit(str(e))
