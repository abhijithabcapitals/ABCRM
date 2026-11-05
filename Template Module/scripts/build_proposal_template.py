"""Builds the Business Formation Proposal template (tags only, no prices or bank details).

    python "Template Module/scripts/build_proposal_template.py" "<path to an old proposal .docx>"

The old proposal is only a source of the look: header (logos), footer (office address), page border, page size,
styles and theme are kept. Its body, custom XML and document properties are NOT copied: they hold private data.
Stops if the header holds anything but logos, the footer anything but the office address, or the header has no images.
Writes Template Module/templates/AB_Capital_Proposal_Template.docx.

Tags (docxtemplater, single braces): see Template Module/logic/proposalModel.js (proposalContext).
Raw tags {@logo_xml} {@timeline_xml} {@page_break} are filled by Template Module/logic/proposalDocx.js.
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "Template Module" / "templates" / "AB_Capital_Proposal_Template.docx"

RED = "C0504D"      # table title bar (from the IFZA proposal)
PALE = "F2DCDB"     # pale red rows
NOTE_RED = "C0504D"
TEXT_W = 10900      # table width in twips (page 12240 minus margins 580 x 2, a little narrower)

KEEP_RELS = ("styles", "numbering", "settings", "webSettings", "footnotes", "endnotes", "header", "footer", "theme", "fontTable")
REL_TYPE = re.compile(r'Type="[^"]*/relationships/([A-Za-z]+)"')


class SourceError(Exception):
    pass


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def run(text, bold=False, italic=False, color=None, size=None, preserve=True):
    pr = ""
    if bold:
        pr += "<w:b/><w:bCs/>"
    if italic:
        pr += "<w:i/><w:iCs/>"
    if color:
        pr += f'<w:color w:val="{color}"/>'
    if size:
        pr += f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    pr = f"<w:rPr>{pr}</w:rPr>" if pr else ""
    sp = ' xml:space="preserve"' if preserve else ""
    return f"<w:r>{pr}<w:t{sp}>{text}</w:t></w:r>"


def para(runs="", jc=None, before=0, after=60, keep_next=False, ind=None, extra=""):
    pr = ""
    if keep_next:
        pr += "<w:keepNext/>"
    pr += f'<w:spacing w:before="{before}" w:after="{after}"/>'
    if ind:
        pr += ind
    if jc:
        pr += f'<w:jc w:val="{jc}"/>'
    return f"<w:p><w:pPr>{pr}{extra}</w:pPr>{runs}</w:p>"


def tag(t):
    """A paragraph holding only a tag: removed on render with paragraphLoop."""
    return f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>"


def bullet(inner, color=None, italic=False):
    ind = '<w:ind w:left="540" w:hanging="270"/>'
    return para(run("•\t", color=color) + run(inner, color=color, italic=italic), ind=ind, after=40,
                extra='<w:tabs><w:tab w:val="left" w:pos="540"/></w:tabs>')


def border(sz=4, color="808080"):
    return "".join(f'<w:{s} w:val="single" w:sz="{sz}" w:space="0" w:color="{color}"/>' for s in ("top", "left", "bottom", "right", "insideH", "insideV"))


def cell(width, content, fill=None, span=None):
    pr = f'<w:tcW w:w="{width}" w:type="dxa"/>'
    if span:
        pr += f'<w:gridSpan w:val="{span}"/>'
    if fill:
        pr += f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>'
    pr += '<w:vAlign w:val="center"/>'
    return f"<w:tc><w:tcPr>{pr}</w:tcPr>{content}</w:tc>"


def row(cells, header=False):
    pr = '<w:cantSplit/>' + ("<w:tblHeader/>" if header else "")
    return f"<w:tr><w:trPr>{pr}</w:trPr>{''.join(cells)}</w:tr>"


def table(widths, rows):
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:jc w:val="center"/>'
            f'<w:tblBorders>{border()}</w:tblBorders><w:tblLayout w:type="fixed"/>'
            f'<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{"".join(rows)}</w:tbl>')


def cp(text, bold=False, jc=None, color=None, italic=False):
    """A cell paragraph."""
    return para(run(text, bold=bold, color=color, italic=italic, size=20), jc=jc, after=20, before=20)


def cp_raw(runs, jc=None):
    return para(runs, jc=jc, after=20, before=20)


def title_bar(widths, text):
    return row([cell(sum(widths), cp(text, bold=True, jc="center", color="FFFFFF"), fill=RED, span=len(widths))])


def head_row(widths, names):
    return row([cell(w, cp(n, bold=True, jc=("left" if i == 0 else "center")), fill=PALE) for i, (w, n) in enumerate(zip(widths, names))], header=True)


def service_table(with_remarks):
    widths = [4900, 1650, 1650, 2700] if with_remarks else [6600, 2150, 2150]
    names = ["Particulars", "AED", "USD", "Remarks"] if with_remarks else ["Particulars", "AED", "USD"]
    n = len(widths)

    def tail(open_t, close_t, bold, sub):
        # One service row. open_t starts the first cell, close_t ends the last cell.
        indent = "{#sub}  {/sub}"
        cells = []
        fields = ["{label}", "{aed}", "{usd}"] + (["{remarks}"] if with_remarks else [])
        for i, (w, f) in enumerate(zip(widths, fields)):
            text = (open_t if i == 0 else "") + (indent if i == 0 else "") + f + (close_t if i == n - 1 else "")
            jc = None if (i == 0 or (with_remarks and i == 3)) else "center"
            cells.append(cell(w, cp(text, bold=bold, jc=jc), fill=(PALE if bold else None)))
        return row(cells)

    rows = [
        title_bar(widths, "{title}"),
        head_row(widths, names),
        tail("{#rows}{#bold}", "{/bold}", True, False),
        tail("{^bold}", "{/bold}{/rows}", False, False),
    ]
    total = [cell(widths[0], cp("Total", bold=True), fill=PALE), cell(widths[1], cp("{total_aed}", bold=True, jc="center"), fill=PALE),
             cell(widths[2], cp("{total_usd}", bold=True, jc="center"), fill=PALE)]
    if with_remarks:
        total.append(cell(widths[3], cp(""), fill=PALE))
    rows.append(row(total))
    return table(widths, rows)


def addon_table():
    widths = [6600, 2150, 2150]
    rows = [
        title_bar(widths, "Add-on Services"),
        head_row(widths, ["Particulars", "AED", "USD"]),
        row([cell(widths[0], cp("{#addons}{name}")), cell(widths[1], cp("{aed}", jc="center")), cell(widths[2], cp("{usd}{/addons}", jc="center"))]),
    ]
    return table(widths, rows)


def h(text, color=None, size=24):
    return para(run(text, bold=True, color=color, size=size), before=160, after=80, keep_next=True)


def labelled(label, value):
    return para(run(label, bold=True, size=22) + run(value, size=22), after=40)


def list_block(items_tag):
    return tag("{#%s}" % items_tag) + bullet("{text}") + tag("{/%s}" % items_tag)


def body():
    b = []
    b.append(para(run("Business Formation Proposal", bold=True, size=36), jc="center", before=120, after=120))
    b.append(para(run("Date: ", bold=True) + run("{date}") + run("\t") + run("Ref: ", bold=True) + run("{ref_no}"), after=120,
                  extra='<w:tabs><w:tab w:val="right" w:pos="10900"/></w:tabs>'))
    b.append(tag("{#options}"))
    b.append(tag("{@page_break}"))
    b.append(tag("{#show_option_heading}"))
    b.append(para(run("Option {no}", bold=True, color=RED, size=28), before=120, after=80, keep_next=True))
    b.append(tag("{/show_option_heading}"))
    b.append(labelled("Business Activity", ": {activity}"))
    b.append(labelled("License Authority", ": {authority_name}"))
    b.append(tag("{@logo_xml}"))
    b.append(para(run("{description}"), after=80))
    b.append(h("Approximate Costing of Company Incorporation", size=26))
    b.append(tag("{#has_remarks}"))
    b.append(service_table(True))
    b.append(tag("{/has_remarks}"))
    b.append(tag("{^has_remarks}"))
    b.append(service_table(False))
    b.append(tag("{/has_remarks}"))
    b.append(para("", after=40))
    b.append(tag("{#has_package}"))
    b.append(h("Package Includes:"))
    b.append(list_block("package_includes"))
    b.append(tag("{/has_package}"))
    b.append(tag("{#red_notes}"))
    b.append(para(run("{text}", italic=True, color=NOTE_RED, size=20), after=40))
    b.append(tag("{/red_notes}"))
    b.append(tag("{@timeline_xml}"))
    b.append(tag("{/options}"))
    b.append(tag("{#has_addons}"))
    b.append(para(run("Add-on services provided by AB Capital", bold=True, size=26), before=240, after=80, keep_next=True))
    b.append(addon_table())
    b.append(para("", after=40))
    b.append(tag("{/has_addons}"))
    b.append(h("Terms & Conditions:".replace("&", "&amp;"), size=26))
    b.append(h("Documents Required"))
    b.append(list_block("documents"))
    b.append(h("Payment Terms"))
    b.append(list_block("payment"))
    b.append(h("Bank Details:"))
    for label, t in [("Account Name - ", "{ba_name}"), ("Bank Name- ", "{ba_bank}"), ("Account Number. -", "{ba_no}"), ("IBAN -", "{ba_iban}"), ("SWIFT -", "{ba_swift}"), ("CURRENCY - ", "{ba_ccy}")]:
        b.append(labelled(label, t))
    b.append(h("Scope of work"))
    b.append(list_block("scope"))
    b.append(h("Notes:"))
    b.append(list_block("notes"))
    b.append(para(run("Contact: - ", bold=True) + run("{contact_name}  {contact_phone}  {contact_email}  {contact_website}"), before=160, after=60))
    return "".join(b)


def check_source(z):
    for name in ("word/document.xml", "word/header1.xml", "word/footer1.xml", "word/_rels/header1.xml.rels"):
        if name not in z.namelist():
            raise SourceError(f"source has no {name}")
    header = z.read("word/header1.xml").decode("utf8")
    if "<w:drawing" not in header or not re.search(r'r:embed="', header):
        raise SourceError("source header has no logo images")
    if re.search(r"<w:t[ >]", header) and "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", header)).strip():
        raise SourceError("source header holds text, not only logos")
    if re.search(r"<w:(tbl|fldSimple|instrText|hyperlink)[ >]", header):
        raise SourceError("source header holds more than logos")
    footer = z.read("word/footer1.xml").decode("utf8")
    text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", footer))
    if "<w:drawing" in footer or re.search(r"<w:(tbl|fldSimple|instrText|hyperlink)[ >]", footer) or "Office No" not in text or len(text) > 140:
        raise SourceError("source footer holds more than the office address")
    if "word/_rels/footer1.xml.rels" in z.namelist():
        raise SourceError("source footer has relationships")


def build(source):
    with zipfile.ZipFile(source) as z:
        check_source(z)
        doc = z.read("word/document.xml").decode("utf8")
        head = doc[:doc.index("<w:body>") + len("<w:body>")]
        sect = re.findall(r"<w:sectPr.*?</w:sectPr>", doc, re.S)[-1]
        rels_src = z.read("word/_rels/document.xml.rels").decode("utf8")
        rels = [r for r in re.findall(r"<Relationship [^>]*/>", rels_src) if (m := REL_TYPE.search(r)) and m.group(1) in KEEP_RELS]
        keep = {"word/styles.xml", "word/numbering.xml", "word/settings.xml", "word/webSettings.xml", "word/footnotes.xml", "word/endnotes.xml",
                "word/header1.xml", "word/footer1.xml", "word/fontTable.xml", "word/theme/theme1.xml", "word/_rels/header1.xml.rels"}
        files = {n: z.read(n) for n in keep}
        header_rels = files["word/_rels/header1.xml.rels"].decode("utf8")
        media = re.findall(r'Target="(media/[^"]+)"', header_rels)
        if not media:
            raise SourceError("source header has no images")
        for m in media:
            files["word/" + m] = z.read("word/" + m)
        for n in ("word/settings.xml", "word/footnotes.xml", "word/endnotes.xml"):
            if re.search(r"customXml|attachedTemplate|r:id=", files[n].decode("utf8")):
                raise SourceError(f"{n} points outside the package")
    body_xml = body() + sect
    files["word/document.xml"] = (head + body_xml + "</w:body></w:document>").encode("utf8")
    files["word/_rels/document.xml.rels"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(rels) + "</Relationships>").encode("utf8")
    files["_rels/.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>").encode("utf8")
    files["docProps/core.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:title>Business Formation Proposal</dc:title></cp:coreProperties>").encode("utf8")
    files["docProps/app.xml"] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>').encode("utf8")
    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>']
    for part, t in [("/word/document.xml", "wordprocessingml.document.main"), ("/word/numbering.xml", "wordprocessingml.numbering"), ("/word/styles.xml", "wordprocessingml.styles"),
                    ("/word/settings.xml", "wordprocessingml.settings"), ("/word/webSettings.xml", "wordprocessingml.webSettings"), ("/word/footnotes.xml", "wordprocessingml.footnotes"),
                    ("/word/endnotes.xml", "wordprocessingml.endnotes"), ("/word/header1.xml", "wordprocessingml.header"), ("/word/footer1.xml", "wordprocessingml.footer"),
                    ("/word/fontTable.xml", "wordprocessingml.fontTable")]:
        ct.append(f'<Override PartName="{part}" ContentType="application/vnd.openxmlformats-officedocument.{t}+xml"/>')
    ct.append('<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>')
    ct.append('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>')
    ct.append('<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>')
    files["[Content_Types].xml"] = "".join(ct).encode("utf8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    order = ["[Content_Types].xml", "_rels/.rels"] + sorted(n for n in files if n not in ("[Content_Types].xml", "_rels/.rels"))
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as out:
        for n in order:
            out.writestr(n, files[n])
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes), header images: {len(media)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    try:
        build(sys.argv[1])
    except SourceError as e:
        sys.exit(f"STOP: {e}")
