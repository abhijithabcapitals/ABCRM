"""Builds the AB Capital Accounting quote and agreement Word templates.

    python "Template Module/scripts/build_accounting_templates.py" "<path to the source proposal .docx>"

The source proposal supplies the header, footer, styles and numbering. Its whole body is replaced: the agreement body is the
fixed generic wording plus {single brace} tags, the quote body is a costing layout of tags. Client details, fees and bank details
never go into a template: they come from the data at generation time. Stops if the source holds an image over 15 KB (a header
logo is small; a signature or stamp is not) or if its shape is not what this script expects.

Raw tags used (filled by renderAccountingDoc, each alone in its paragraph): {@signature_xml} and {@page_break}.
Both templates end their signing part with the AB Capital "Authorized Signatory" block: {@signature_xml} stays empty until an approver
signs through the shared signing step (Template Hub 011/012). Rebuilding keeps the block.
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "Template Module" / "templates"
MAX_IMAGE = 15 * 1024
FONT = '<w:rFonts w:ascii="Palatino Linotype" w:hAnsi="Palatino Linotype" w:cs="Palatino Linotype"/>'
TITLE_FILL = "FFFF00"
HEAD_FILL = "D9D9D9"


class SourceError(Exception):
    pass


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def run(text, b=False, u=False, i=False, sz=20, color=None):
    pr = FONT + ("<w:b/>" if b else "") + ("<w:i/>" if i else "") + (f'<w:color w:val="{color}"/>' if color else "") + f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/>' + ('<w:u w:val="single"/>' if u else "")
    return f'<w:r><w:rPr>{pr}</w:rPr><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def para(*runs, jc="both", num=None, left=None, hanging=None, before=0, after=100, keep=False, border=False, cant_split=False):
    ppr = ("<w:keepNext/>" if keep else "")
    if num:
        ppr += f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num}"/></w:numPr>'
    if border:
        ppr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>'
    ppr += f'<w:spacing w:before="{before}" w:after="{after}"/>'
    if left is not None:
        ppr += f'<w:ind w:left="{left}"' + (f' w:hanging="{hanging}"' if hanging else "") + "/>"
    ppr += f'<w:jc w:val="{jc}"/>'
    return f"<w:p><w:pPr>{ppr}</w:pPr>{''.join(runs)}</w:p>"


def text(t, **kw):
    return para(run(t), **kw)


def heading(t, num=True):
    return para(run(t, b=True, u=True, sz=24), num=3 if num else None, left=460 if num else None, hanging=360 if num else None, before=200, after=100, keep=True, jc="left")


def sub_heading(t):
    return para(run(t, b=True), before=120, after=60, keep=True, jc="left")


def bullet(t, lead=None):
    parts = (run(lead, b=True) if lead else "") + run(t)
    return para(parts, num=20, left=720, hanging=360, after=40)


def lead_bullets(items):
    return "".join(bullet(" " + rest, lead=lead + ":") if rest else bullet(lead) for lead, rest in items)


def tag_para(t, **kw):
    return para(run(t), **kw)


def tc(width, content, span=None, fill=None):
    pr = f'<w:tcW w:w="{width}" w:type="dxa"/>' + (f'<w:gridSpan w:val="{span}"/>' if span else "") + (f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else "")
    return f"<w:tc><w:tcPr>{pr}</w:tcPr>{content}</w:tc>"


def tr(*cells, header=False):
    pr = "<w:cantSplit/>" + ("<w:tblHeader/>" if header else "")
    return f"<w:tr><w:trPr>{pr}</w:trPr>{''.join(cells)}</w:tr>"


def tbl(widths, *rows, borders=True):
    style = '<w:tblStyle w:val="TableGrid"/>' if borders else '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    return f'<w:tbl><w:tblPr>{style}<w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>{grid}</w:tblGrid>{"".join(rows)}</w:tbl>'


def cell_p(t, b=False, jc="left", left=None, sz=20, fill_bold=False):
    return para(run(t, b=b, sz=sz), jc=jc, left=left, before=40, after=40)


def title_bar(widths, t):
    return tr(tc(sum(widths), para(run(t, b=True, sz=22), jc="center", before=60, after=60), span=len(widths), fill=TITLE_FILL))


def head_row(widths, labels, jc=None):
    return tr(*[tc(w, cell_p(l, b=True, jc=(jc[i] if jc else "left")), fill=HEAD_FILL) for i, (w, l) in enumerate(zip(widths, labels))], header=True)


def page_break():
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def block(tag, inner, inverted=False):
    """Repeats inner for each item of tag (or keeps it when tag is true, with inverted=False, or false, with inverted=True).
    The two marker paragraphs are removed by docxtemplater, so no blank line or bullet is left when nothing prints."""
    return loop_marker(("{^" if inverted else "{#") + tag + "}") + inner + loop_marker("{/" + tag + "}")


def loop_marker(t):
    """A paragraph holding only a section tag: docxtemplater removes it and repeats or drops what lies between the markers."""
    return para(run(t), after=0)


# --- Agreement ---------------------------------------------------------------------------------------------------------------

INTRO = ("AB CAPITAL SERVICES is a leading provider of professional accounting and bookkeeping services in the UAE. We offer a comprehensive suite "
         "of solutions designed to meet the unique needs of businesses operating in the dynamic and evolving regional environment. With the recent "
         "implementation of Corporate Tax, navigating the complexities of UAE financial regulations can be challenging. We empower businesses like "
         "yours to focus on core operations while confidently complying with all tax and accounting requirements.")
OFFER_INTRO = "Under wide array of services that we cater for our clients, based on your requirement, we can offer the following:"
TRANSACTIONS = [("Bookkeeping & Data Entry", "Accurate capture of daily financials."), ("Bank Reconciliation", "Ensuring seamless bank statement alignment."),
                ("Accounts Payable & Receivable", "Efficient invoice processing & payments."), ("Payroll Accounting & Tax Administration", "Streamlined salary management & tax compliance.")]
REPORTING = [("General Ledger Maintenance", "Up-to-date financial recordkeeping."), ("Financial Statement Preparation", "Clear & accurate P&L, Balance Sheets, etc."),
             ("Management Reporting & Insights", "Tailored reports for informed decision-making."), ("Internal Controls & Risk Management", "Safeguarding your financial system.")]
BEYOND = [("Fixed Asset Management", "Optimized tracking & depreciation of assets."), ("Inventory Management", "Streamlined inventory control & reporting."),
          ("Budgeting & Forecasting", "Planning for future financial success."), ("Cloud Accounting Integration", "Secure & efficient data management solutions.")]
SNAPSHOT = ("This is just a snapshot of our extensive accounting & bookkeeping services tailored for the UAE business environment. "
            "We are confident we can handle all your financial needs effectively.")
TAX_INTRO = "We simplify the complexities of VAT and Corporate Tax, ensuring seamless compliance and maximizing your tax efficiency."
VAT = [("Registration & Deregistration", "Streamlined processes for accurate filings."), ("Return Preparation & Filing", "Ensuring timely and error-free submissions."),
       ("Input Credit Reclaim Management", "Recovering every eligible dirham."), ("Record Keeping & Reporting", "Maintaining organized and accessible records."),
       ("Compliance Advisory", "Expert insights to proactively mitigate risk."), ("Training & Support", "Empowering your team with VAT knowledge.")]
CT = [("Registration & Compliance", "Efficient guidance through legal requirements."), ("Tax Planning & Optimization", "Strategies to minimize tax burden."),
      ("Return Preparation & Filing", "Accurate and compliant filings on your behalf."), ("Liaison with FTA", "Effective communication with tax authorities."),
      ("Representation during Tax Audits", "Protecting your interests during any inquiries."), ("CT Advisory", "Strategic guidance for informed tax decisions.")]
SERVICE = [("Dedicated Tax Specialists", "Your team of UAE tax experts."), ("Proactive & Timely Updates", "Stay informed about changing regulations."),
           ("Customized Solutions", "Tailored strategies to fit your unique needs."), ("Tech-driven Efficiency", "Modern tools for seamless collaboration.")]
TEAM = ("Our Team of Accountants and Tax consultants will carry out all accounting and tax compliance assignments. Moreover, the reporting and overall "
        "compliance we can handle on your behalf in a timely and efficient manner. All our consultants are having many years of experience and are "
        "capable to handle the assignments independently.")
REPORT = ("We shall report to the management on any significant weaknesses which come across to our notice and those that need to be brought to the "
          "attention of management. As a part of our assignment, we shall give recommendations and suggestions for any improvements, if necessary, in "
          "our report to management.")
NOTICES = ("All notices, requests and other communications under this Agreement shall be in writing and shall be deemed to have been given: (a) when "
           "delivered by hand (with written confirmation of receipt); (b) when received by the addressee if sent by a nationally recognized overnight "
           "courier (with written confirmation of receipt); or (c) on the date sent by email to the email addresses specified below (with confirmation "
           "of transmission), provided that a copy is also sent by one of the methods described in (a) or (b) above if required by law.")
PLEASE_NOTE = ["Any or all revisions in terms and conditions will be discussed and agreed upon by the parties to this agreement in advance.",
               "Out of pocket expenses (i.e., Attestation from Ministry of Economy) will be invoiced separately.",
               "Work can be started once the information are ready and as soon as the terms are agreed and accepted."]


def offer_group(title, items):
    return para(run(title, b=True), before=100, after=40, keep=True, jc="left") + lead_bullets(items)


def signature_block():
    left = (para(run("Yours sincerely,"), after=40, jc="left") + para(run("For AB CAPITAL SERVICES (FZE)", b=True), after=60, jc="left")
            + block("draft_mark", para(run("Draft, not approved", b=True, color="C00000"), jc="left", after=0))
            + para(run("{@signature_xml}"), jc="left", after=0)
            + para(run("______________________________"), jc="left", before=240, after=0) + para(run("Authorized Signatory"), jc="left", after=0))
    right = (para(run("We hereby confirm the above assignment."), after=40, jc="left") + para(run("Accepted by", b=True), after=60, jc="left")
             + para(run(""), jc="left", after=0, before=480)
             + para(run("______________________________"), jc="left", before=240, after=0)
             + para(run("{signatory_name}"), jc="left", after=0) + para(run("{signatory_title}"), jc="left", after=0) + para(run("For {client_name}"), jc="left", after=0))
    return tbl([4775, 4775], tr(tc(4775, left), tc(4775, right)), borders=False)


def agreement_body():
    b = []
    b.append(block("draft_mark", para(run("Draft, not approved", b=True, sz=24, color="C00000"), jc="center", after=100)))
    b.append(para(run("Date: ", b=True), run("{date}"), jc="left", after=0) + para(run("Ref.: ", b=True), run("{document_number}"), jc="left", after=120))
    b.append(para(run("To,"), jc="left", after=0) + para(run("{client_name}", b=True), jc="left", after=0) + block("address", para(run("{.}"), jc="left", after=0)))
    b.append(para(run("Attention: ", b=True), run("{attention}"), jc="left", before=100, after=160))
    b.append(text(INTRO))
    b.append(heading("What We Offer"))
    b.append(text(OFFER_INTRO))
    b.append(sub_heading("Accounting and Book-Keeping"))
    b.append(offer_group("Transaction Management:", TRANSACTIONS) + offer_group("Financial Reporting & Analysis:", REPORTING) + offer_group("Beyond the Basics:", BEYOND))
    b.append(text(SNAPSHOT, before=80))
    b.append(sub_heading("Taxation – VAT & Corporate Tax"))
    b.append(text(TAX_INTRO))
    b.append(offer_group("VAT Services:", VAT) + offer_group("CT Services:", CT) + offer_group("Unparalleled Service:", SERVICE))
    b.append(heading("Our Team") + text(TEAM))
    b.append(heading("Report to management") + text(REPORT))
    b.append(heading("Scope of Services") + text("{scope_sentence}"))
    b.append(para(run("Note that, fees charged will be for the services mentioned under “Schedule 1: Scope of Services”", b=True)))
    b.append(text("Any additional services required will attract extra service fees."))
    b.append(block("scope_notes", bullet("{.}")))
    b.append(heading("Fees for Services"))
    b.append(text("In consideration of our above services, our professional charges would be as follows:"))
    b.append(para(run("Detailed structure and related terms and conditions are mentioned under “Schedule 2: Fees for Services”.", b=True)))
    b.append(block("billing_notes", bullet("{.}")) + block("fee_notes", bullet("{.}")))
    b.append(heading("Effective Period") + text("{period_text}"))
    b.append(heading("Notices and Communications") + text(NOTICES))
    b.append(para(run("For AB Capital Services FZE:", b=True), jc="left", before=100, after=0) + para(run("Email: {ab_notices_email}"), jc="left", after=100))
    b.append(para(run("For {client_name}:", b=True), jc="left", after=0) + para(run("Email: {notices_email}"), jc="left", after=160))
    b.append(text("If you agree with the above, please sign and revert a copy of the contract. Looking forward to hearing from you."))
    b.append(text("We thank you for the confidence you have on us."))
    b.append(signature_block())
    # Schedule 1
    s1 = [1000, 3000, 5550]
    s1_row = tr(tc(s1[0], cell_p("{#schedule1}{no}.")), tc(s1[1], cell_p("{name}")), tc(s1[2], cell_p("{description}{/schedule1}")))
    b.append(page_break() + tbl(s1, title_bar(s1, "Schedule 1: Scope of Services"), head_row(s1, ["S. No.", "Name of Services", "Description of Services"]), s1_row))
    b.append(text(""))
    # Schedule 2
    s2 = [1000, 4500, 4050]
    s2_row = tr(tc(s2[0], cell_p("{#schedule2}{no}")),
                tc(s2[1], block("sub", para(run("{description}"), jc="left", before=40, after=40), inverted=True) + block("sub", para(run("{description}", i=True), jc="left", left=360, before=40, after=40))),
                tc(s2[2], para(run("{fee}{/schedule2}", b=True), jc="left", before=40, after=40)))
    b.append(page_break() + tbl(s2, title_bar(s2, "Schedule 2: Fees for Services"), head_row(s2, ["S. No.", "Description of Services", "Fees for Services"]), s2_row))
    b.append(para(run("Payment Mode: Cash/ Cheque in favor of “AB CAPITAL SERVICES”", b=True), jc="left", before=200, after=60))
    for label, tag in [("Account Name", "account_name"), ("Bank", "bank"), ("Account No.", "account_no"), ("IBAN", "iban"), ("SWIFT Code", "swift"), ("Currency", "currency")]:
        b.append(para(run(f"{label}: "), run("{bank." + tag + "}"), jc="left", after=0))
    b.append(para(run("Please Note:", b=True), jc="left", before=200, after=60, keep=True))
    b.append("".join(bullet(t) for t in PLEASE_NOTE))
    return "".join(b)


# --- Quote -------------------------------------------------------------------------------------------------------------------

def quote_signature_block():
    return (para(run("For AB CAPITAL SERVICES (FZE)", b=True), jc="left", before=240, after=60, keep=True)
            + para(run("{@signature_xml}"), jc="left", after=0)
            + para(run("______________________________"), jc="left", before=240, after=0, keep=True) + para(run("Authorized Signatory"), jc="left", after=0))


def quote_body():
    w = [5400, 2400, 1750]
    right = ["left", "left", "right"]
    b = []
    b.append(para(run("QUOTATION", b=True, sz=28), jc="center", after=120))
    b.append(para(run("Date: ", b=True), run("{date}"), jc="left", after=0) + para(run("Ref.: ", b=True), run("{document_number}"), jc="left", after=160))
    b.append(loop_marker("{#options}"))
    b.append(para(run("{@page_break}"), after=0))
    b.append(block("show_option_heading", para(run("Option {number}: {name}", b=True, sz=24), jc="left", before=120, after=80, keep=True)))
    b.append(block("description", para(run("{description}"), after=80)))
    row = tr(tc(w[0], block("is_sub", para(run("{name}"), jc="left", before=40, after=40), inverted=True) + block("is_sub", para(run("{name}", i=True), jc="left", left=360, before=40, after=40))),
             tc(w[1], cell_p("{basis}")), tc(w[2], cell_p("{aed}", jc="right")))
    first = row.replace("{^is_sub}", "{#rows}{^is_sub}", 1).replace("{aed}", "{aed}{/rows}", 1)
    total = tr(tc(w[0], para(run("{#totals}Total", b=True), jc="left", before=40, after=40), fill=HEAD_FILL), tc(w[1], cell_p("{basis}", b=True), fill=HEAD_FILL),
               tc(w[2], cell_p("{aed}{/totals}", b=True, jc="right"), fill=HEAD_FILL))
    b.append(tbl(w, title_bar(w, "{name}"), head_row(w, ["Particulars", "Basis", "AED"], right), first, total))
    b.append(block("notes", bullet("{.}")))
    b.append(loop_marker("{/options}"))
    for flag, title, key in [("has_scope", "Scope of Services", "scope"), ("has_payment", "Payment Terms", "payment"), ("has_notes", "Notes", "notes")]:
        b.append(block(flag, heading(title, num=False) + block(key, bullet("{.}"))))
    b.append(heading("Bank Details", num=False))
    for label, tag in [("Account Name", "account_name"), ("Bank", "bank"), ("Account No.", "account_no"), ("IBAN", "iban"), ("SWIFT Code", "swift"), ("Currency", "currency")]:
        b.append(para(run(f"{label}: "), run("{bank." + tag + "}"), jc="left", after=0))
    b.append(heading("Contact", num=False))
    b.append(para(run("{contact.name}"), jc="left", after=0) + para(run("Mobile: {contact.phone}"), jc="left", after=0)
             + para(run("Email: {contact.email}"), jc="left", after=0) + para(run("Website: {contact.website}"), jc="left", after=0))
    b.append(quote_signature_block())
    return "".join(b)


# --- Package -----------------------------------------------------------------------------------------------------------------

def section_props():
    return ('<w:sectPr><w:headerReference w:type="default" r:id="HEADER"/><w:footerReference w:type="default" r:id="FOOTER"/>'
            '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="2700" w:right="800" w:bottom="1100" w:left="1000" w:header="720" w:footer="500" w:gutter="0"/>'
            '<w:pgBorders w:offsetFrom="page"><w:top w:val="single" w:sz="4" w:space="24" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="24" w:color="000000"/>'
            '<w:bottom w:val="single" w:sz="4" w:space="24" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="24" w:color="000000"/></w:pgBorders><w:cols w:space="720"/></w:sectPr>')


def check_source(z):
    names = z.namelist()
    for n in names:
        if n.startswith("word/media/") and not n.endswith("/") and z.getinfo(n).file_size > MAX_IMAGE:
            raise SourceError(f"{n} is over 15 KB: this looks like a signature or stamp, not a header logo. Use the proposal without a signature image.")
    for need in ("word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml"):
        if need not in names:
            raise SourceError(f"the source has no {need}")
    if "word/header1.xml" not in names or "word/footer1.xml" not in names:
        raise SourceError("the source has no header1.xml or footer1.xml")
    num = z.read("word/numbering.xml").decode("utf-8")
    for need in ("3", "20"):
        if f'w:numId="{need}"' not in num:
            raise SourceError(f"numbering.xml has no list {need}")


def build(src, dst, body):
    with zipfile.ZipFile(src) as old:
        check_source(old)
        rels = old.read("word/_rels/document.xml.rels").decode("utf-8")
        header = re.search(r'Id="([^"]+)"[^>]*Type="[^"]*/header"|Type="[^"]*/header"[^>]*Id="([^"]+)"', rels)
        footer = re.search(r'Id="([^"]+)"[^>]*Type="[^"]*/footer"|Type="[^"]*/footer"[^>]*Id="([^"]+)"', rels)
        if not header or not footer:
            raise SourceError("the source has no header or footer relationship")
        hid = next(g for g in header.groups() if g)
        fid = next(g for g in footer.groups() if g)
        xml = old.read("word/document.xml").decode("utf-8")
        root = xml[: xml.index("<w:body>")]
        doc = root + "<w:body>" + body + section_props().replace("HEADER", hid).replace("FOOTER", fid) + "</w:body></w:document>"
        temp = dst.with_name(dst.name + ".tmp")
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as new:
            for item in old.infolist():
                data = old.read(item.filename)
                if item.filename == "word/document.xml":
                    data = doc.encode("utf-8")
                elif item.filename == "docProps/core.xml":
                    s = data.decode("utf-8")
                    s = re.sub(r"<dc:creator>[^<]*</dc:creator>", "<dc:creator>AB Capital Services FZE</dc:creator>", s)
                    s = re.sub(r"<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>", "<cp:lastModifiedBy>AB Capital Services FZE</cp:lastModifiedBy>", s)
                    data = s.encode("utf-8")
                new.writestr(item, data)
        temp.replace(dst)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit('usage: python build_accounting_templates.py "<source proposal .docx>"')
    source = Path(sys.argv[1])
    try:
        build(source, OUT / "AB_Capital_Accounting_Agreement_Template.docx", agreement_body())
        build(source, OUT / "AB_Capital_Accounting_Quote_Template.docx", quote_body())
    except SourceError as e:
        sys.exit(f"Stopped: {e}")
    print("built 2 templates")
