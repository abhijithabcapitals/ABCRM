"""Reads the old AB Capital proposal files into starting wording for the work types.

    python "Template Module/scripts/extract_work_types.py" "<folder of old files>" "<output folder>"

Writes work_types.json and work_types_review.md, for a person to read before loading. The files hold prices, so the output
folder must be outside any git repository. Bank details and contact lines are left out: Settings prints the bank details.
"""
import html
import json
import re
import sys
import zipfile
from pathlib import Path

FILES = {"IFZA": "IFZA.docx", "Rakez": "Rakez.docx", "SHAMS": "SHAMS.docx", "Mainland": "Mainland.docx", "Liquidation": "Liquidation.docx"}
BLOCK = re.compile(r"<w:tbl>.*?</w:tbl>|<w:p(?: [^>]*)?>(?:(?!<w:p[ >]).)*?</w:p>", re.S)
TEXT = re.compile(r"<w:t(?: [^>]*)?>([^<]*)</w:t>")
BANK = re.compile(r"account name|bank name|account number|\biban\b|swift|currency\b|bank details", re.I)
STOP = re.compile(r"^contact\s*:|@|www\.|^\+?\d[\d -]{7,}$", re.I)
HEADINGS = (
    (re.compile(r"^add-?on services", re.I), "addons"),
    (re.compile(r"^scope of work", re.I), "scope"),
    (re.compile(r"^terms\s*&\s*conditions", re.I), "skip"),
    (re.compile(r"^documents required", re.I), "documents"),
    (re.compile(r"^payment terms", re.I), "payment"),
    (re.compile(r"^bank details", re.I), "bank"),
    (re.compile(r"^notes\s*:?", re.I), "notes"),
)


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def text_of(xml):
    return clean("".join(TEXT.findall(re.sub(r"<w:txbxContent>.*?</w:txbxContent>", "", xml, flags=re.S))))


def read_blocks(path):
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    out = []
    for m in BLOCK.finditer(re.sub(r"<w:txbxContent>.*?</w:txbxContent>", "", xml, flags=re.S)):
        block = m.group(0)
        if block.startswith("<w:tbl"):
            rows = [[text_of(c) for c in re.findall(r"<w:tc>.*?</w:tc>", r, re.S)] for r in re.findall(r"<w:tr[ >].*?</w:tr>", block, re.S)]
            out.append(("table", rows))
        else:
            t = text_of(block)
            if t:
                out.append(("para", t))
    return out


def bullets(lines):
    return "\n".join(f"• {x}" for x in lines)


def extract(path):
    parts = {"about": [], "addons": [], "documents": [], "payment": [], "scope": [], "notes": []}
    state = "about"
    for kind, value in read_blocks(path):
        if kind == "table":
            for row in value:
                if state == "addons" and len(row) >= 2 and row[0] and "{{" not in row[0] and not re.match(r"^(add-on|particulars)", row[0], re.I):
                    parts["addons"].append(f"{row[0]}: AED {row[1]}" if re.search(r"\d", row[1]) else row[0] if not row[1] else f"{row[0]}: {row[1]}")
            continue
        line = value.replace("PartnerActive", "Partner")
        # These sit anywhere in the old files, whatever heading came before.
        if re.match(r"^\W*(please note\s*:?\s*-?\s*)?process will start", line, re.I):
            text = re.sub(r"^\W*(please note\s*:?\s*-?\s*)?", "", line, flags=re.I).rstrip(")")
            parts["payment"].append(text[0].upper() + text[1:])
            continue
        if re.match(r"^\W*please note", line, re.I):
            parts["notes"].append(line)
            continue
        if "{{" in line or BANK.search(line) or STOP.search(line):
            if BANK.search(line) and state in ("payment", "bank"):
                state = "scope"
            continue
        match = next((name for rx, name in HEADINGS if rx.match(line)), None)
        if match:
            state = match
            continue
        if state == "skip":
            continue
        if state in parts:
            parts[state].append(line)
    return parts


def to_sections(parts):
    about = [x for x in parts["about"] if not re.match(r"^(business formation proposal|business activity|license activity|license authority|approximate costing|business formation|particulars|aed|usd|remarks|total|sl\. no\.|description|quotation for|company formation \(uae)", x, re.I)]
    payment = list(parts["payment"])
    additional = []
    if parts["documents"]:
        additional.append("Documents required:\n" + bullets(parts["documents"]))
    if parts["addons"]:
        additional.append("Add-on services:\n" + bullets(parts["addons"]))
    if parts["notes"]:
        additional.append("Notes:\n" + bullets(parts["notes"]))
    understanding = "\n".join(about)
    scope = bullets(parts["scope"])
    pay = "\n".join(payment)
    other = "\n\n".join(additional)
    quote = {"understanding": understanding, "scope": scope, "payment": pay, "additional": other}
    letter = {"understanding": understanding, "scope": scope, "payment": pay, "other": other}
    drop = lambda d: {k: v for k, v in d.items() if v}
    return {"quote": drop(quote), "letter": drop(letter)}


def main(src, out):
    if any((p / ".git").exists() for p in [out, *out.parents]):
        sys.exit("The output folder is inside a git repository. These files hold prices.")
    out.mkdir(parents=True, exist_ok=True)
    data = {name: to_sections(extract(src / file)) for name, file in FILES.items()}
    joined = json.dumps(data)
    if re.search(r"AE\d{10,}|account (name|number)|iban", joined, re.I):
        sys.exit("Bank details were found in the extracted wording. Nothing was written.")
    (out / "work_types.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Starting wording for AB Capital work types", ""]
    for name, sections in data.items():
        lines += [f"## {name}", ""]
        for key, text in sections["quote"].items():
            lines += [f"### {key}", "", text.replace("\n", "  \n"), ""]
    (out / "work_types_review.md").write_text("\n".join(lines), encoding="utf-8")
    print({k: {s: len(v) for s, v in d["quote"].items()} for k, d in data.items()})


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
