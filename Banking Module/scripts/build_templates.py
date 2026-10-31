"""Builds the reusable Word templates and the logo. Standard library plus pypdf (CRM .venv).
Writes to Banking Module/templates (used by the CRM) and Resources/Banking (the master copy for staff).
Placeholders use docxtemplater syntax: {name}, {#loop}...{/loop}.
The old agreement's signature and stamp are deliberately not copied: a person signs each letter.
    .venv\\Scripts\\python.exe "Banking Module\\scripts\\build_templates.py"
"""
import io
import shutil
import struct
import zipfile
import zlib
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "Banking Module" / "templates"
MASTER = ROOT / "Resources" / "Banking"
SOURCE_PDF = MASTER / "Agreement Full payment Agreement- NSP.pdf"
OUT.mkdir(exist_ok=True)


def png(width, height, rgba):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    rows = b"".join(b"\0" + rgba[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def logo_bytes():
    logo = OUT / "ab-capital-logo.png"
    if SOURCE_PDF.exists():
        import pypdf
        xobjects = pypdf.PdfReader(str(SOURCE_PDF)).pages[0]["/Resources"]["/XObject"]
        image = xobjects["/Image9"].get_object()
        width, height = image["/Width"], image["/Height"]
        rgb, alpha = image.get_data(), image["/SMask"].get_object().get_data()
        rgba = bytearray()
        for i in range(width * height):
            rgba += rgb[i * 3:i * 3 + 3] + alpha[i:i + 1]
        logo.write_bytes(png(width, height, bytes(rgba)))
    return logo.read_bytes()


def run(text, bold=False, size=None, color=None):
    props = ("<w:b/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "") + (f'<w:sz w:val="{size}"/>' if size else "")
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def para(text="", bold=False, size=None, align=None, after=80, color=None, bullet=False, keep=False):
    ppr = f'<w:spacing w:after="{after}"/>'
    if bullet:
        ppr = f'<w:ind w:left="300" w:hanging="200"/>{ppr}'
        text = "• " + text
    if align:
        ppr += f'<w:jc w:val="{align}"/>'
    if keep:
        ppr = "<w:keepNext/>" + ppr
    return f"<w:p><w:pPr>{ppr}</w:pPr>{run(text, bold, size, color)}</w:p>"


def heading(text):
    return para(text, bold=True, size=21, after=60, color="13363D", keep=True)


def cell(text, width, bold=False, align=None, fill=None):
    shade = f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ""
    return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shade}</w:tcPr>{para(text, bold=bold, align=align, after=20)}</w:tc>'


def table(rows, widths):
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    borders = "".join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="BCC7CB"/>' for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
    body = "".join("<w:tr>" + "".join(row) + "</w:tr>" for row in rows)
    return f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{body}</w:tbl>' + para(after=60)


LETTERHEAD = (
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1350000" cy="623000"/><wp:docPr id="1" name="AB Capital logo" descr="AB Capital logo"/>'
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>'
    '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1350000" cy="623000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
) + para("{company_name}", bold=True, align="right", after=0) + para("Website - {company_website}", align="right", after=0) + para("E-Mail - {company_email}", align="right", after=0) + para("Mobile No. - {company_mobile}", align="right", after=160)

PAYMENT = table([
    [cell("Payment details", 2600, bold=True, fill="EEF2F3"), cell("", 6400, fill="EEF2F3")],
    [cell("Account name", 2600), cell("{ba_name}", 6400)], [cell("Bank", 2600), cell("{ba_bank}", 6400)], [cell("Account no.", 2600), cell("{ba_no}", 6400)],
    [cell("IBAN", 2600), cell("{ba_iban}", 6400)], [cell("SWIFT", 2600), cell("{ba_swift}", 6400)], [cell("Currency", 2600), cell("{ba_ccy}", 6400)],
], [2600, 6400])

QUOTE = LETTERHEAD + para("Quotation", bold=True, size=32, color="13363D", after=120) + table([
    [cell("Quotation no.", 1800, bold=True), cell("{quotation_number}", 2700), cell("Date", 1800, bold=True), cell("{quotation_date}", 2700)],
    [cell("Client", 1800, bold=True), cell("{client_name}", 2700), cell("Valid until", 1800, bold=True), cell("{valid_until}", 2700)],
    [cell("Banking case", 1800, bold=True), cell("{case_ref}", 2700), cell("Prepared by", 1800, bold=True), cell("{prepared_by}", 2700)],
    [cell("Selected bank", 1800, bold=True), cell("{bank}", 2700), cell("Scheme", 1800, bold=True), cell("{scheme}", 2700)],
], [1800, 2700, 1800, 2700]) + table([
    [cell("#", 500, True, fill="EEF2F3"), cell("Category", 3000, True, fill="EEF2F3"), cell("Description", 4000, True, fill="EEF2F3"), cell("AED", 1500, True, "right", "EEF2F3")],
    [cell("{#lines}{no}", 500), cell("{category}", 3000), cell("{description}", 4000), cell("{amount}{/lines}", 1500, align="right")],
    [cell("{#has_discount}", 500), cell("Discount", 3000), cell("", 4000), cell("-{discount}{/has_discount}", 1500, align="right")],
    [cell("{#has_vat}", 500), cell("VAT", 3000), cell("{vat_statement}", 4000), cell("{vat}{/has_vat}", 1500, align="right")],
    [cell("", 500, fill="EEF2F3"), cell("Total quotation amount", 3000, True, fill="EEF2F3"), cell("", 4000, fill="EEF2F3"), cell("AED {total_plain}", 1500, True, "right", "EEF2F3")],
], [500, 3000, 4000, 1500]) + para("{#has_direct}Payable by you directly to the bank, not included above:{/has_direct}", bold=True, size=18, after=20) + para("{#direct_lines}{description}: AED {amount}. {/direct_lines}", size=18) + para("{#has_memo}Held in your own bank account, not a fee to AB Capital: initial deposit {deposit}; minimum balance {min_balance}.{/has_memo}", size=18) + heading("Payment terms") + para("{payment_terms}") + para("{remarks}") + PAYMENT + para("The decision to open an account rests solely with the bank. This quotation does not guarantee approval, timing or account terms. Bank fees and requirements are set by the bank and may change.", size=17, color="46565C")

LETTER = LETTERHEAD + table([[cell("To", 1200, True), cell("{client_name}", 3800), cell("Date", 1200, True), cell("{letter_date}", 2800)], [cell("Address", 1200, True), cell("{client_address}", 3800), cell("Ref", 1200, True), cell("{letter_number} · {case_ref}", 2800)]], [1200, 3800, 1200, 2800]) + para("Dear Sir / Madam,") + para("Sub: Engagement Letter", bold=True) + para("Greetings from {company_short}.") + para("Thank you for providing us with the opportunity to add value to your business.") + heading("A. OUR UNDERSTANDING OF YOUR REQUIREMENTS") + para("{understanding} Scheme: {scheme}.") + heading("B. SCOPE OF SERVICE") + para("{scope_title}", bold=True) + para("{#scope}{text}{/scope}", bullet=True) + heading("C. OUR FEES") + para("{fee_intro}") + table([
    [cell("#", 500, True, fill="EEF2F3"), cell("Scope of Work", 6500, True, fill="EEF2F3"), cell("Proposed Fees (AED)", 2000, True, "right", "EEF2F3")],
    [cell("{#fees}{no}", 500), cell("{description}", 6500), cell("{amount}{/fees}", 2000, align="right")],
    [cell("", 500, fill="EEF2F3"), cell("Total (quotation {quotation_number})", 6500, True, fill="EEF2F3"), cell("{total}", 2000, True, "right", "EEF2F3")],
], [500, 6500, 2000]) + heading("D. PAYMENT TERMS") + para("{#payment_terms}{text}{/payment_terms}", bullet=True) + heading("E. RESPONSIBILITIES OF AB CAPITAL") + para("{#ab_responsibilities}{text}{/ab_responsibilities}", bullet=True) + heading("F. RESPONSIBILITIES OF THE CLIENT") + para("{#client_responsibilities}{text}{/client_responsibilities}", bullet=True) + heading("G. LIMITATIONS AND DISCLAIMERS") + para("{limitations}") + heading("H. REPS & WARRANTIES") + para("{reps}") + PAYMENT + table([
    [cell("Sincerely,", 4500, True), cell("Accepted By", 4500, True)],
    [cell(" ", 4500), cell(" ", 4500)], [cell(" ", 4500), cell(" ", 4500)],
    [cell("Authorized Signatory, {company_short}", 4500), cell("Client Signature, {client_name}", 4500)],
    [cell("Date:", 4500), cell("Date:", 4500)],
], [4500, 4500])

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')


def build(path, body, logo):
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1100" w:bottom="900" w:left="1100" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>'
    styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", styles)
        z.writestr("word/media/logo.png", logo)


logo = logo_bytes()
for name, body in (("Quotation_Template.docx", QUOTE), ("Engagement_Letter_Template.docx", LETTER)):
    build(OUT / name, body, logo)
    if MASTER.exists():
        shutil.copy(OUT / name, MASTER / name)
    print("built", name)
