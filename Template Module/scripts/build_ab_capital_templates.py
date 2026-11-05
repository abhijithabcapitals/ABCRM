"""Builds the AB Capital quotation and engagement letter templates from the two original designs.

    python "Template Module/scripts/build_ab_capital_templates.py"

Reads Template Module/templates/originals and writes four files with {single brace} tags, keeping the design:
Service_Quotation_Template.docx and Service_Engagement_Template.docx here, and the same two designs as
Quotation_Template.docx and Engagement_Letter_Template.docx for Business Banking. Prices and bank details stay out:
they come from the data at generation time. Stops if the designs change shape.
"""
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ORIGINALS = ROOT / "Template Module" / "templates" / "originals"
SERVICE = ROOT / "Template Module" / "templates"
BANKING = ROOT / "Banking Module" / "templates"
QUOTE = "AB_Capital_Quotation_Template_Original_Design.docx"
LETTER = "AB_Capital_Engagement_Letter_Template_Original_Design.docx"

# Every [bracket] in each design, in document order.
QUOTE_TAGS = ["{client_name}", "{client_address}", "{document_date}", "{document_number}", "{intro}", "{understanding}", "{scope_text}",
              "{#lines}{description}", "{amount}{/lines}", "{payment_text}", "{additional}"]
LETTER_TAGS = ["{client_name}", "{client_address}", "{document_date}", "{understanding}", "{scope_text}", "{fee_intro}",
               "{#lines}{description}", "{amount}{/lines}", "{payment_text}", "{reps}", "{other_terms}",
               "Company Seal", "{client_name}", "{contact_name}", "______________________"]
BANK_LINES = [("Bank details", ""), ("Account name", "{ba_name}"), ("Bank", "{ba_bank}"), ("Account number", "{ba_no}"), ("IBAN", "{ba_iban}"), ("SWIFT", "{ba_swift}"), ("Currency", "{ba_ccy}")]

TEXT = re.compile(r"(<w:t(?: [^>]*)?>)([^<]*)(</w:t>)")
BRACKET = re.compile(r"\[[^\]]*\]")
ROW = re.compile(r"<w:tr(?: [^>]*)?>.*?</w:tr>", re.S)
PARA = re.compile(r"<w:p(?: [^>]*)?>(?:(?!<w:p[ >]).)*?</w:p>", re.S)


class DesignError(Exception):
    pass


def fill_brackets(xml, tags, name):
    found = sum(len(BRACKET.findall(m.group(2))) for m in TEXT.finditer(xml))
    if found != len(tags):
        raise DesignError(f"{name}: expected {len(tags)} placeholders, found {found}")
    left = iter(tags)

    def sub(m):
        text = BRACKET.sub(lambda _: next(left), m.group(2))
        space = ' xml:space="preserve"' if text != text.strip() else ""
        open_tag = m.group(1) if "xml:space" in m.group(1) or not space else f"<w:t{space}>"
        return open_tag + text + m.group(3)

    return TEXT.sub(sub, xml)


def set_row_text(row, values, bold=False):
    left = iter(values)

    def sub(m):
        return m.group(1) + next(left) + m.group(3)

    row = TEXT.sub(sub, row)
    if bold:
        row = row.replace("<w:rPr><w:rFonts", "<w:rPr><w:b/><w:rFonts")
    return row


def add_fee_rows(xml, name):
    """A VAT row that shows only when VAT applies, and a Total row, in the style of the fee row."""
    m = next((r for r in ROW.finditer(xml) if "{#lines}" in r.group(0)), None)
    if not m:
        raise DesignError(f"{name}: the fee row was not found")
    row = m.group(0)
    vat = set_row_text(row, ("{#has_vat}VAT", "{vat}{/has_vat}"))
    total = set_row_text(row, ("Total", "{total}"), bold=True)
    return xml[: m.end()] + vat + total + xml[m.end() :]


def para_with(xml, tag, name):
    m = next((p for p in PARA.finditer(xml) if tag in p.group(0)), None)
    if not m:
        raise DesignError(f"{name}: the paragraph for {tag} was not found")
    return m


def add_bank_details(xml, name):
    """Bank details from Settings, straight after the payment terms, in the same style."""
    m = para_with(xml, "{payment_text}", name)
    para = m.group(0)
    ppr = re.search(r"<w:pPr>.*?</w:pPr>", para, re.S)
    props = ppr.group(0) if ppr else ""
    lines = ""
    for label, tag in BANK_LINES:
        text = f"{label}: {tag}" if tag else label
        bold = "" if tag else "<w:b/>"
        lines += f'<w:p>{props}<w:r><w:rPr>{bold or "<w:b w:val=\"0\"/>"}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    return xml[: m.end()] + lines + xml[m.end() :]


def add_letter_ref(xml, name):
    """The letter's serial number, on a line of its own under Date, in the style of the quotation's."""
    m = para_with(xml, "{document_date}", name)
    line = m.group(0).replace("Date:", "Ref.:").replace("{document_date}", "{document_number}")
    return xml[: m.end()] + line + xml[m.end() :]


def fix_quote(xml):
    xml = fill_brackets(xml, QUOTE_TAGS, QUOTE)
    return add_bank_details(add_fee_rows(xml, QUOTE), QUOTE)


def fix_letter(xml):
    xml = fill_brackets(xml, LETTER_TAGS, LETTER)
    return add_letter_ref(add_bank_details(add_fee_rows(xml, LETTER), LETTER), LETTER)


def rewrite(src, dst, change):
    temp = dst.with_name(dst.name + ".tmp")
    with zipfile.ZipFile(src) as old, zipfile.ZipFile(temp, "w") as new:
        for item in old.infolist():
            data = old.read(item.filename)
            if item.filename == "word/document.xml":
                data = change(data.decode("utf-8")).encode("utf-8")
            new.writestr(item, data)
    temp.replace(dst)


if __name__ == "__main__":
    rewrite(ORIGINALS / QUOTE, SERVICE / "Service_Quotation_Template.docx", fix_quote)
    rewrite(ORIGINALS / LETTER, SERVICE / "Service_Engagement_Template.docx", fix_letter)
    rewrite(ORIGINALS / QUOTE, BANKING / "Quotation_Template.docx", fix_quote)
    rewrite(ORIGINALS / LETTER, BANKING / "Engagement_Letter_Template.docx", fix_letter)
    print("built 4 templates")
