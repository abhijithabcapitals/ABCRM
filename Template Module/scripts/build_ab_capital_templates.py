"""Builds the AB Capital quotation and engagement letter templates from the two original designs.

    python "Template Module/scripts/build_ab_capital_templates.py"

Reads Template Module/templates/originals and writes four files with {single brace} tags, keeping the design:
Service_Quotation_Template.docx and Service_Engagement_Template.docx here, and the same two designs as
Quotation_Template.docx and Engagement_Letter_Template.docx for Business Banking (these two with the AB Capital Authorized
Signatory place, {@signature_xml}, for signing). Prices and bank details stay out:
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
PHONE = "+971 52 3655193"
SECOND_PHONE = "+971 58 561 9500"
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


def add_fee_rows(xml, name, breakdown=False):
    """A VAT row that shows only when VAT applies, and a Total row, in the style of the fee row.
    breakdown (the service templates): a Business Setup line prints its scope after its name, and Net and VAT rows show when
    show_breakdown is set (a quote or letter with line VAT). Other documents never send these tags, so they print as before."""
    m = next((r for r in ROW.finditer(xml) if "{#lines}" in r.group(0)), None)
    if not m:
        raise DesignError(f"{name}: the fee row was not found")
    row = m.group(0)
    extra = ""
    if breakdown:
        row = set_row_text(row, ("{#lines}{description}{#scope_note}: {scope_note}{/scope_note}", "{amount}{/lines}"))
        extra = set_row_text(row, ("{#show_breakdown}Net amount", "{net}{/show_breakdown}"), bold=True) + set_row_text(row, ("{#show_breakdown}VAT", "{vat}{/show_breakdown}"), bold=True)
    vat = set_row_text(row, ("{#has_vat}{vat_label}", "{vat}{/has_vat}"))
    total = set_row_text(row, ("Total", "{total}"), bold=True)
    return xml[: m.start()] + row + extra + vat + total + xml[m.end() :]


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
        weight = '<w:b w:val="0"/>' if tag else "<w:b/>"
        lines += f'<w:p>{props}<w:r><w:rPr>{weight}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    return xml[: m.end()] + lines + xml[m.end() :]


def add_letter_ref(xml, name):
    """The letter's serial number, on a line of its own under Date, in the style of the quotation's."""
    m = para_with(xml, "{document_date}", name)
    line = m.group(0).replace("Date:", "Ref.:").replace("{document_date}", "{document_number}")
    return xml[: m.end()] + line + xml[m.end() :]


# Business Banking only: the AB Capital Authorized Signatory place. Banking Module/logic/documents.js fills {@signature_xml} with a blank
# space for a hand signature when the document is unsigned, and with the signature picture (Template Module/logic/signDocx.js) once an
# approver signs. The tag is alone in its paragraph, as docxtemplater needs for a raw tag. The service templates are unchanged.
SIGN_TAG = "<w:p><w:r><w:t>{@signature_xml}</w:t></w:r></w:p>"
SIGN_LINE = "____________________________"


def add_quote_signatory(xml, name):
    """A signatory block after the closing line, in the closing line's style; the lines keep together on one page."""
    m = para_with(xml, "Thank you for considering", name)
    keep = '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="40"/></w:pPr>'
    block = (f'<w:p>{keep}<w:r><w:rPr><w:b/></w:rPr><w:t>For AB CAPITAL SERVICES (FZE)</w:t></w:r></w:p>' + SIGN_TAG
             + f'<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>{SIGN_LINE}</w:t></w:r></w:p>'
             + '<w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr><w:r><w:t>Authorized Signatory</w:t></w:r></w:p>')
    return xml[: m.end()] + block + xml[m.end() :]


def add_letter_signatory(xml, name):
    """The AB Capital cell of the signing table: the blank lines above the signature line become the signature place."""
    m = para_with(xml, "For AB CAPITAL SERVICES (FZE)", name)
    para = m.group(0)
    head = "<w:t>For AB CAPITAL SERVICES (FZE)</w:t><w:br/><w:br/><w:br/><w:br/>"
    if head not in para:
        raise DesignError(f"{name}: the AB Capital signing cell changed shape")
    ppr = re.search(r"<w:pPr>.*?</w:pPr>", para, re.S).group(0)
    rpr = re.search(r"<w:rPr>.*?</w:rPr>", para, re.S).group(0)
    first = para.split(head)[0] + "<w:t>For AB CAPITAL SERVICES (FZE)</w:t></w:r></w:p>"
    rest = f"<w:p>{ppr}<w:r>{rpr}" + para.split(head)[1]
    return xml[: m.start()] + first + SIGN_TAG + rest + xml[m.end() :]


def fix_quote(xml, breakdown=False, sign=False):
    xml = fill_brackets(xml, QUOTE_TAGS, QUOTE)
    xml = add_bank_details(add_fee_rows(xml, QUOTE, breakdown), QUOTE)
    return add_quote_signatory(xml, QUOTE) if sign else xml


def fix_letter(xml, breakdown=False, sign=False):
    xml = fill_brackets(xml, LETTER_TAGS, LETTER)
    xml = add_letter_ref(add_bank_details(add_fee_rows(xml, LETTER, breakdown), LETTER), LETTER)
    return add_letter_signatory(xml, LETTER) if sign else xml


def add_second_phone(xml, name):
    """Both company numbers in the header, each on its own line, as the user asked on 2026-11-05."""
    if PHONE not in xml:
        raise DesignError(f"{name}: the phone number was not found in the header")
    def both(m):
        para = m.group(0)
        if PHONE not in para:
            return para
        # No space after these two lines, so the taller box stays clear of the page body.
        tight = para.replace("<w:pPr>", '<w:pPr><w:spacing w:after="0"/>', 1)
        return tight + tight.replace(PHONE, SECOND_PHONE)

    return PARA.sub(both, xml)


def rewrite(src, dst, change):
    temp = dst.with_name(dst.name + ".tmp")
    with zipfile.ZipFile(src) as old, zipfile.ZipFile(temp, "w") as new:
        for item in old.infolist():
            data = old.read(item.filename)
            if item.filename == "word/document.xml":
                data = change(data.decode("utf-8")).encode("utf-8")
            elif re.fullmatch(r"word/header\d*\.xml", item.filename):
                data = add_second_phone(data.decode("utf-8"), src.name).encode("utf-8")
            new.writestr(item, data)
    temp.replace(dst)


if __name__ == "__main__":
    rewrite(ORIGINALS / QUOTE, SERVICE / "Service_Quotation_Template.docx", lambda x: fix_quote(x, True))
    rewrite(ORIGINALS / LETTER, SERVICE / "Service_Engagement_Template.docx", lambda x: fix_letter(x, True))
    rewrite(ORIGINALS / QUOTE, BANKING / "Quotation_Template.docx", lambda x: fix_quote(x, sign=True))
    rewrite(ORIGINALS / LETTER, BANKING / "Engagement_Letter_Template.docx", lambda x: fix_letter(x, sign=True))
    print("built 4 templates")
