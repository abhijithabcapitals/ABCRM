"""Information extraction stage: reads canonical fields (fields.py) from the text of UAE documents, without AI.

UAE licences and FTA certificates print an English label followed by its value and then the Arabic version, e.g.
"Trade Name Akasia Global Trading - F.Z.E اكاسيا...". Each reader finds the label, keeps the English text up to the
next Arabic character or the next known label, and checks the result.

Raw confidence: "high" = read straight from a printed label; "medium" = worked out from other text (emirate,
entity type, jurisdiction, filing frequency); "low" = a loose pattern. The confidence stage (confidence.py) then
adjusts it. Nothing is guessed when no text supports it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

ARABIC = "؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿"
_ARABIC_RUN = re.compile(f"[{ARABIC}]")
EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"]
STOP_LABELS = [
    r"Trade Name", r"Legal Name", r"Legal Form", r"Legal Type", r"Legal Status", r"Licen[cs]e No", r"Licen[cs]e Number",
    r"Registration No", r"Expiry Date", r"First Issue Date", r"Current Issue Date", r"Issue Date", r"Manager",
    r"Tax Registration Number", r"Effective Registration Date", r"Effective Date", r"Date of Issue", r"Version Number",
    r"Registered Address", r"Contact Number", r"Activities", r"Shareholder", r"Premises Number", r"Building Name",
    r"Business District", r"Makani", r"Corporate Tax Period", r"Company Name", r"Customs Code", r"Account Name",
    r"Account Number", r"Currency", r"IBAN", r"Address", r"Owner", r"Partners?", r"First VAT Return Period",
    r"Tax Period", r"Email", r"E-mail", r"Phone", r"Mobile", r"website", r"Legal Name of",
]
_DATE_RE = re.compile(
    r"[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}"
    r"|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3}-\d{4}")
_DATE_FORMATS = ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y", "%d %B %Y", "%d %b %Y", "%d %B, %Y", "%d %b, %Y",
                 "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%b-%Y")
_TRN = re.compile(r"(?<!\d)(1\d{14})(?!\d)")
_EID = re.compile(r"784-?\d{4}-?\d{7}-?\d")
_IBAN = re.compile(r"\bAE\d{2}\s?(?:\d{4}\s?){4}\d{3}\b")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?:\+971|00971|\b0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b")
_WEB = re.compile(r"\b(?:https?://)?(?:www\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

# (pattern, licence issuing authority, emirate, jurisdiction). Specific free zones before emirate-wide authorities.
AUTHORITIES = [
    (r"free zones? authority of ajman|ajman free zone|fza\.ae", "Ajman Free Zone Authority", "Ajman", "Free Zone"),
    (r"dubai multi commodities|\bdmcc\b", "Dubai Multi Commodities Centre (DMCC)", "Dubai", "Free Zone"),
    (r"jebel ali free zone|\bjafza\b", "Jebel Ali Free Zone (JAFZA)", "Dubai", "Free Zone"),
    (r"international free zone authority|\bifza\b", "International Free Zone Authority (IFZA)", "Dubai", "Free Zone"),
    (r"dubai airport free ?zone|\bdafz", "Dubai Airport Freezone (DAFZ)", "Dubai", "Free Zone"),
    (r"meydan free zone", "Meydan Free Zone", "Dubai", "Free Zone"),
    (r"dubai silicon oasis", "Dubai Silicon Oasis Authority", "Dubai", "Free Zone"),
    (r"dubai international financial cent", "Dubai International Financial Centre (DIFC)", "Dubai", "Free Zone"),
    (r"abu dhabi global market|\badgm\b", "Abu Dhabi Global Market (ADGM)", "Abu Dhabi", "Free Zone"),
    (r"ras al khaimah economic zone|\brakez\b", "Ras Al Khaimah Economic Zone (RAKEZ)", "Ras Al Khaimah", "Free Zone"),
    (r"ras al khaimah international corporate|\brak ?icc\b", "RAK International Corporate Centre (RAK ICC)", "Ras Al Khaimah", "Offshore"),
    (r"sharjah media city|\bshams\b", "Sharjah Media City (Shams)", "Sharjah", "Free Zone"),
    (r"sharjah airport international free zone|saif ?zone", "Sharjah Airport International Free Zone (SAIF Zone)", "Sharjah", "Free Zone"),
    (r"hamriyah free zone", "Hamriyah Free Zone Authority", "Sharjah", "Free Zone"),
    (r"sharjah publishing city|spc free zone", "SPC Free Zone", "Sharjah", "Free Zone"),
    (r"fujairah free zone", "Fujairah Free Zone Authority", "Fujairah", "Free Zone"),
    (r"umm al quwain free trade zone|uaq ftz", "Umm Al Quwain Free Trade Zone", "Umm Al Quwain", "Free Zone"),
    (r"department of economy (and|&) tourism|dubai economy|\bdet\b|department of economic development.{0,30}dubai",
     "Department of Economy and Tourism, Dubai", "Dubai", "Mainland"),
    (r"abu dhabi department of economic development|department of economic development.{0,30}abu dhabi|\badded\b",
     "Abu Dhabi Department of Economic Development", "Abu Dhabi", "Mainland"),
    (r"sharjah economic development", "Sharjah Economic Development Department", "Sharjah", "Mainland"),
    (r"ajman department of economic development|ajman ded", "Ajman Department of Economic Development", "Ajman", "Mainland"),
    (r"ras al khaimah department of economic development|rak ded", "Ras Al Khaimah Department of Economic Development",
     "Ras Al Khaimah", "Mainland"),
]
# Mapped onto schema.json "entity_type" options; a form the options lack is passed through as printed.
ENTITY_RULES = [
    (r"free zone establishment|\bf\.?\s?z\.?\s?e\b", "FZE"),
    (r"\bfz[\s-]?llc\b|free zone limited liability", "FZ-LLC"),
    (r"free zone company|\bfzco\b", "FZCO"),
    (r"branch", "Branch"),
    (r"holding", "Holding Company"),
    (r"civil company", "Civil Company"),
    (r"partnership", "Partnership"),
    (r"sole (establishment|proprietorship)|individual establishment", "Sole Establishment"),
    (r"limited liability company|\bl\.?\s?l\.?\s?c\b", "LLC"),
]
UAE_BANKS = [
    "Emirates NBD", "Abu Dhabi Commercial Bank", "ADCB", "First Abu Dhabi Bank", "FAB", "Mashreq", "RAKBANK",
    "Dubai Islamic Bank", "Abu Dhabi Islamic Bank", "ADIB", "Commercial Bank of Dubai", "Emirates Islamic",
    "HSBC", "Standard Chartered", "Citibank", "Wio Bank", "Sharjah Islamic Bank", "Ajman Bank", "National Bank of Fujairah",
    "Bank of Baroda", "Habib Bank", "United Arab Bank", "Al Hilal Bank", "Noor Bank", "Liv", "Zand",
]

@dataclass
class Extraction:
    engine: str = "text"                                       # text | ai | none
    fields: list[dict[str, Any]] = field(default_factory=list)  # {key, value, confidence, evidence}
    rows: list[dict[str, Any]] = field(default_factory=list)    # {list, item: {...}, confidence, evidence}
    people: list[dict[str, str]] = field(default_factory=list)  # {name, nationality, source}
    facts: list[list[str]] = field(default_factory=list)
    document_status: str = "Received"                           # Received | Expired
    expiry_date: str | None = None
    summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def flat(text: str) -> str:
    return re.sub(r"\s+", " ", text or "")


def iso(d: date) -> str:
    return d.isoformat()


def mask_iban(value: str) -> str:
    return _IBAN.sub(lambda m: m.group(0).replace(" ", "")[:4] + " •••• " + m.group(0).replace(" ", "")[-4:], value)


def _dedupe_repeat(value: str) -> str:
    """'38263 38263' -> '38263'; licences often print the English and second-column value side by side."""
    tokens = value.split()
    n = len(tokens)
    if n >= 2 and n % 2 == 0 and tokens[: n // 2] == tokens[n // 2:]:
        return " ".join(tokens[: n // 2])
    return value


def after_label(text: str, labels: list[str], max_len: int = 220) -> tuple[str | None, str | None]:
    """English value following the first matching label, or (None, None)."""
    for label in labels:
        tail = r"\b" if re.search(r"\w$", label) else ""
        m = re.search(r"\b" + label + tail + r"\.?\s*[:\-–]?\s*", text, re.I)
        if not m:
            continue
        rest = _ARABIC_RUN.split(text[m.end(): m.end() + max_len])[0]
        cut = len(rest)
        for stop in STOP_LABELS:
            sm = re.search(r"\b" + stop + r"\b", rest, re.I)
            if sm and sm.start() > 0:
                cut = min(cut, sm.start())
        value = _dedupe_repeat(rest[:cut].strip(" :-–|,;()/"))
        if value:
            return value, (m.group(0) + value).strip()
    return None, None


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    m = _DATE_RE.search(value)
    if not m:
        return None
    raw = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", m.group(0))
    if re.match(r"[A-Za-z]", raw) or re.search(r"\s[A-Za-z]", raw):
        raw = raw.replace(".", "")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


class _Builder:
    def __init__(self) -> None:
        self.result = Extraction()
        self.labels: list[str] = []

    def field(self, key: str, value: str | None, confidence: str, evidence: str | None, label: str) -> None:
        value = (value or "").strip()
        if not value or any(s["key"] == key for s in self.result.fields):
            return
        self.result.fields.append({"key": key, "value": value, "confidence": confidence,
                                   "evidence": (evidence or value)[:300]})
        self.labels.append(label)

    def date_field(self, key: str, raw: str | None, confidence: str, evidence: str | None, label: str) -> None:
        d = parse_date(raw)
        if d and 1950 <= d.year <= 2100:
            self.field(key, iso(d), confidence, evidence, label)

    def row(self, lst: str, item: dict[str, str], confidence: str, evidence: str) -> None:
        self.result.rows.append({"list": lst, "item": item, "confidence": confidence, "evidence": evidence[:300]})

    def fact(self, label: str, value: str | None) -> None:
        if value:
            self.result.facts.append([label, mask_iban(value)[:120]])


def _authority(text: str):
    lowered = text.lower()
    for pattern, authority, emirate, jurisdiction in AUTHORITIES:
        m = re.search(pattern, lowered)
        if m:
            return authority, emirate, jurisdiction, text[max(0, m.start() - 20): m.end() + 20]
    return None


def _emirate_in(value: str | None) -> str | None:
    for emirate in EMIRATES:
        if value and re.search(r"\b" + emirate + r"\b", value, re.I):
            return emirate
    return None


def _entity_type(*values: str | None) -> str | None:
    for value in values:
        if value:
            for pattern, entity in ENTITY_RULES:
                if re.search(pattern, value, re.I):
                    return entity
    return None


def _cut_at_label(value: str) -> str:
    cut = len(value)
    for stop in STOP_LABELS:
        sm = re.search(r"\b" + stop + r"\b", value, re.I)
        if sm and sm.start() > 0:
            cut = min(cut, sm.start())
    return value[:cut].strip(" -|,;")


def _activities(text: str) -> list[str]:
    m = re.search(r"\bActivit(?:y|ies)\b(.{0,1500}?)(?:\bShareholder|\bLicen[cs]e Details|\bBusiness Licen|\bPartners?\b"
                  r"|\bManager\b|\bOwner|$)", text, re.I)
    if not m:
        return []
    english = re.sub(f"[{ARABIC}]+", "|", m.group(1))
    items = [i.strip(" -|,;") for i in re.findall(r"\d+\s*[.)-]\s*([A-Za-z][^|]*?)(?=\s*\d+\s*[.)-]\s*[A-Za-z|]|\||$)", english)]
    items = [_cut_at_label(i) for i in items]
    items = [i for i in items if len(i) > 2]
    if not items:
        first = english.split("|")[0].strip(" :-")
        first = _cut_at_label(first)
        return [first[:200]] if first else []
    return list(dict.fromkeys(items))


def _contacts(b: _Builder, text: str, confidence: str = "medium") -> None:
    email = _EMAIL.search(text)
    if email:
        b.field("email", email.group(0).lower(), confidence, email.group(0), "email")
    phone, ev = after_label(text, [r"Contact Number", r"Phone(?: No\.?)?", r"Tel(?:ephone)?", r"Mobile(?: No\.?)?"], 40)
    m = _PHONE.search(phone or "") or (None if phone else None)
    if m:
        b.field("phone", m.group(0).strip(), confidence, ev, "phone")
    web = _WEB.search(text)
    if web:
        b.field("website", web.group(0).lower(), "medium", web.group(0), "website")


def _licence(b: _Builder, text: str) -> None:
    trade, ev_trade = after_label(text, [r"Trade Name", r"Commercial Name"])
    legal, ev_legal = after_label(text, [r"Legal Name", r"Company Name", r"Name of (?:the )?Company"])
    b.field("legal_name", legal or trade, "high" if legal else "medium", ev_legal or ev_trade, "company name")
    b.field("trade_name", trade, "high", ev_trade, "trade name")
    number, ev = after_label(text, [r"Licen[cs]e No", r"Licen[cs]e Number", r"Licen[cs]e #"])
    if number:
        number = number.split()[0]
    b.field("licence_number", number, "high", ev, "licence number")
    reg, ev = after_label(text, [r"Registration No", r"Registration Number", r"Register No", r"CR No"], 40)
    if reg:
        b.field("registration_number", reg.split()[0], "high", ev, "registration number")
    form, ev = after_label(text, [r"Legal Form", r"Legal Type", r"Legal Status", r"Company Type"])
    entity = _entity_type(form, legal, trade)
    b.field("entity_type", entity, "high" if form and _entity_type(form) else "medium", ev or legal or trade, "entity type")
    issue, ev = after_label(text, [r"Current Issue Date", r"Issue Date", r"Date of Issue", r"Issued On"])
    b.date_field("licence_issue_date", issue, "high", ev, "issue date")
    expiry, ev = after_label(text, [r"Expiry Date", r"Expiration Date", r"Valid Until", r"Date of Expiry", r"Expires On"])
    b.date_field("licence_expiry_date", expiry, "high", ev, "expiry date")
    first_issue, ev = after_label(text, [r"First Issue Date", r"Establishment Date", r"Date of Establishment",
                                         r"Incorporation Date"], 40)
    b.date_field("establishment_date", first_issue, "medium", ev, "first issue date")
    acts = _activities(text)
    if acts:
        b.field("main_activity", acts[0], "high", "Activities: " + acts[0], "activities")
        if len(acts) > 1:
            b.field("secondary_activities", "; ".join(acts[1:]), "high", "Activities: " + "; ".join(acts[1:]), "activities")
    parts = [after_label(text, [lab])[0] for lab in (r"Premises Number", r"Building Name", r"Business District")]
    address = ", ".join(p for p in parts if p) or after_label(text, [r"Registered Address", r"Address"])[0]
    found = _authority(text)
    if found:
        b.field("licence_authority", found[0], "medium", found[3], "issuing authority")
        b.field("jurisdiction", found[2], "medium", found[3], "jurisdiction")
    elif re.search(r"\boffshore\b", text, re.I):
        b.field("jurisdiction", "Offshore", "medium", "offshore", "jurisdiction")
    emirate = _emirate_in(address) or (found[1] if found else None)
    b.field("registered_address", address, "medium", address, "address")
    b.field("emirate", emirate, "medium", address or (found[3] if found else emirate), "emirate")
    _contacts(b, text)
    manager, _ = after_label(text, [r"Manager"], 80)
    b.fact("Manager", manager)
    if manager:
        b.result.people.append({"name": manager, "nationality": "", "source": "Licence (manager)"})
    owners, _ = after_label(text, [r"Owner", r"Shareholders?", r"Partners?"], 160)
    b.fact("Owners / partners", owners)
    exp = parse_date(expiry)
    if exp:
        b.result.expiry_date = iso(exp)
        if exp < date.today():
            b.result.document_status = "Expired"


def _vat_frequency(start: date, end: date) -> str | None:
    months = (end.year - start.year) * 12 + end.month - start.month
    return "Monthly" if months == 0 else "Quarterly" if months == 2 else None


def _registration_certificate(b: _Builder, text: str, corporate_tax: bool) -> None:
    trn, ev = after_label(text, [r"Tax Registration Number", r"\bTRN\b", r"Corporate Tax Registration Number"], 60)
    digits = re.sub(r"\D", "", trn or "")[:15]
    if not re.fullmatch(r"\d{15}", digits):
        m = _TRN.search(text)
        digits, ev = (m.group(1), m.group(1)) if m else ("", None)
    legal, ev_l = after_label(text, [r"Legal Name of (?:the )?(?:Person/)?Entity \(English\)", r"Legal Name of (?:the )?(?:Person/)?Entity",
                                     r"Legal Name \(English\)", r"Legal Name", r"Name of (?:the )?Registrant"])
    b.field("legal_name", legal, "high", ev_l, "legal name")
    address, ev_a = after_label(text, [r"Registered Address, and Contact Number", r"Registered Address", r"Address"])
    if address:
        address = re.sub(r"\+?\d[\d\s]{8,}$", "", address).strip(" ,")
    b.field("registered_address", address, "high", ev_a, "registered address")
    b.field("emirate", _emirate_in(address), "medium", address, "emirate")
    effective, ev_e = after_label(text, [r"Effective Registration Date", r"Effective Date of Registration", r"Effective Date"])
    if corporate_tax:
        b.field("ct_registered", "Yes", "high", "Corporate Tax registration certificate", "registration status")
        b.field("ct_trn", digits or None, "high", ev, "CT TRN")
        b.date_field("ct_registration_date", effective, "high", ev_e, "registration date")
        m = re.search(r"(?:First )?(?:Corporate )?Tax Period.{0,200}?(\d{1,2}/\d{1,2}/\d{4})\D{1,25}(\d{1,2}/\d{1,2}/\d{4})", text, re.I)
        if m:
            s, e = parse_date(m.group(1)), parse_date(m.group(2))
            if s and e:
                b.field("ct_first_period", f"{iso(s)}/{iso(e)}", "high", m.group(0)[-90:], "tax period")
                b.field("financial_year", f"{s.strftime('%d %B')} {chr(0x2013)} {e.strftime('%d %B')}", "medium",
                        m.group(0)[-90:], "financial year")
    else:
        b.field("vat_registered", "Yes", "high", "VAT registration certificate", "registration status")
        b.field("vat_trn", digits or None, "high", ev, "TRN")
        b.date_field("vat_effective_date", effective, "high", ev_e, "effective date")
        registered, ev_r = after_label(text, [r"Date of Registration", r"(?<!Effective )Registration Date"])
        b.date_field("vat_registration_date", registered, "high", ev_r, "registration date")
        m = re.search(r"(?:First )?(?:VAT )?(?:Tax|Return) Period.{0,200}?(\d{1,2}/\d{1,2}/\d{4})\D{1,25}(\d{1,2}/\d{1,2}/\d{4})", text, re.I)
        if m:
            s, e = parse_date(m.group(1)), parse_date(m.group(2))
            if s and e:
                b.field("vat_first_period", f"{iso(s)}/{iso(e)}", "high", m.group(0)[-90:], "tax period")
                b.field("vat_filing_frequency", _vat_frequency(s, e), "medium", m.group(0)[-90:], "filing frequency")
    _contacts(b, text, "medium")
    issued, _ = after_label(text, [r"Date of Issue"], 40)
    b.fact("Certificate issued", issued)


def _bank(b: _Builder, text: str) -> None:
    iban = _IBAN.search(text)
    bank = next((n for n in UAE_BANKS if re.search(r"\b" + re.escape(n) + r"\b", text, re.I)), None)
    cur = re.search(r"\bCurrency\s*:?\s*([A-Z]{3})\b", text) or re.search(r"\b(AED|USD|EUR|GBP)\b", text)
    item = {"bank": bank or "", "currency": cur.group(1) if cur else "", "iban_last4": iban.group(0).replace(" ", "")[-4:] if iban else ""}
    if any(item.values()):
        b.row("bank_accounts", item, "medium", " · ".join(filter(None, [bank, mask_iban(iban.group(0)) if iban else None,
                                                                       item["currency"]])))
    b.fact("IBAN", mask_iban(iban.group(0)) if iban else None)
    b.fact("Statement period", after_label(text, [r"Statement Period", r"Period"], 60)[0])


def _mrz_name(text: str) -> tuple[str, str] | None:
    m = re.search(r"P<([A-Z]{3})([A-Z<]+)", text.replace(" ", ""))
    if not m:
        return None
    surname, _, given = m.group(2).partition("<<")
    name = " ".join(x for x in (given.replace("<", " ").strip(), surname.replace("<", " ").strip()) if x)
    return (name.title(), m.group(1)) if name else None


def _person(b: _Builder, text: str, doc_type: str) -> None:
    if doc_type == "Passport":
        mrz = _mrz_name(text)
        if mrz:
            b.result.people.append({"name": mrz[0], "nationality": mrz[1], "source": "Passport"})
            return
    name, _ = after_label(text, [r"Name", r"Full Name", r"Given Names?"], 60)
    nationality, _ = after_label(text, [r"Nationality"], 40)
    if name and len(name.split()) >= 2:
        b.result.people.append({"name": name.title(), "nationality": (nationality or "").title(), "source": doc_type})
    eid = _EID.search(text)
    b.fact("ID number", eid.group(0)[:3] + "-••••-•••••••-" + eid.group(0)[-1] if eid else None)


def extract_fields(doc_type: str, text: str) -> Extraction:
    b = _Builder()
    t = flat(text)
    if not t.strip():
        b.result.engine = "none"
        b.result.summary = "No readable text in this file. Enter its details by hand, or use AI extraction."
    elif doc_type == "TradeLicence":
        _licence(b, t)
    elif doc_type in ("VATCertificate", "CTCertificate"):
        _registration_certificate(b, t, corporate_tax=doc_type == "CTCertificate")
    elif doc_type in ("BankStatement", "BankLetter", "CardStatement"):
        _bank(b, t)
    elif doc_type in ("EmiratesID", "Passport", "Visa"):
        _person(b, t, doc_type)
    if t.strip():
        names = list(dict.fromkeys(b.labels))
        if names:
            joined = ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]
            b.result.summary = joined[0].upper() + joined[1:] + " found."
        elif b.result.rows:
            b.result.summary = "Bank account details found." if any(r["list"] == "bank_accounts" for r in b.result.rows) else "List entries found."
        elif b.result.people:
            b.result.summary = "Person found: " + b.result.people[0]["name"] + "."
        else:
            b.result.summary = "Sorted and recorded. No onboarding fields recognised in the text."
    return b.result
