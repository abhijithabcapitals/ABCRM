"""Document classification engine.

Decides document type, storage category, financial period and sensitivity from the file name, the
readable text, the upload card the client used and (when available) the AI extraction result.
Anything that cannot be classified confidently goes to Others rather than being forced into a category.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from .readers import zip_member_names

BANK, COMPANY, KYC, PROPOSALS, FINANCIALS, SECRETS, OTHERS = (
    "Bank Statements", "Company Documents", "KYC", "Proposals", "Financials", "Secrets", "Others")
CATEGORIES = [BANK, COMPANY, KYC, PROPOSALS, FINANCIALS, SECRETS, OTHERS]

# (doc_type, category, label, filename pattern, text pattern). Earlier rules win ties, so specific ones come first.
RULES: list[tuple[str, str, str, str | None, str | None]] = [
    ("VATCertificate", COMPANY, "VAT / TRN Certificate", r"\bvat\b.{0,20}(cert|registration|trn)|\btrn\b|vat ?cert",
     r"vat registration certificate|certificate of (vat|value added tax) registration"
     r"|certificate of registration for value added tax|registered (person )?for (vat|value added tax)"),
    ("CTCertificate", COMPANY, "Corporate Tax Certificate",
     r"\bct\b.{0,20}(cert|registration)|corporate ?tax.{0,20}(cert|registration)",
     r"corporate tax registration certificate|certificate of corporate tax registration"
     r"|certificate of registration for corporate tax|registered person for corporate tax"),
    ("VATReturn", COMPANY, "VAT Return", r"vat ?(return|201)\b", r"vat return|vat 201"),
    ("CTReturn", COMPANY, "Corporate Tax Return", r"(ct|corporate ?tax) ?return", r"corporate tax return"),
    ("TaxComputation", FINANCIALS, "Tax Computation", r"tax ?computation|ct ?computation|vat ?(working|summary|return)", r"tax computation"),
    ("CTDocument", COMPANY, "Corporate Tax Document", r"corporate ?tax|\bct\b|\bfta\b|federal tax authority", r"corporate tax"),
    ("TradeLicence", COMPANY, "Trade Licence", r"trade ?licen[cs]e|commercial ?licen[cs]e|\blicen[cs]e\b|\btl\b",
     r"trade licen[cs]e|commercial licen[cs]e|licen[cs]e (no|number)"),
    ("MOA", COMPANY, "Memorandum of Association", r"\bmoa\b|memorandum", r"memorandum of association"),
    ("AOA", COMPANY, "Articles of Association", r"\baoa\b|articles of association", r"articles of association"),
    ("IncorporationCertificate", COMPANY, "Certificate of Incorporation", r"incorporation|\bcoi\b", r"certificate of incorporation"),
    ("EstablishmentCard", COMPANY, "Establishment Card", r"establishment ?card|immigration ?card", r"establishment card"),
    ("ChamberCertificate", COMPANY, "Chamber of Commerce Certificate", r"chamber", r"chamber of commerce"),
    ("ShareCertificate", COMPANY, "Share Certificate / Register", r"share ?cert|share ?register", r"share certificate|register of (members|shareholders)"),
    ("UBODocument", COMPANY, "UBO Document", r"\bubo\b|beneficial ?owner", r"ultimate beneficial owner"),
    ("CustomsDocument", COMPANY, "Customs Document", r"customs|bill of entry|importer ?code", r"customs (code|registration)|bill of entry"),
    ("TenancyContract", COMPANY, "Tenancy Contract", r"ejari|tenancy|lease ?agreement", r"ejari|tenancy contract"),
    ("Passport", KYC, "Passport", r"passport|\bpp\b", r"passport no|\bP<[A-Z]{3}"),
    ("EmiratesID", KYC, "Emirates ID", r"emirates ?id|\beid\b", r"784-\d{4}-\d{7}-\d|identity card|emirates id"),
    ("Visa", KYC, "Residence Visa", r"\bvisa\b|residence ?permit", r"residence visa|entry permit"),
    ("ProofOfAddress", KYC, "Proof of Address", r"proof of address|utility ?bill|dewa|sewa|addc", r"proof of address"),
    ("KYCForm", KYC, "KYC Form", r"\bkyc\b|due diligence", r"know your customer|kyc form"),
    ("CardStatement", BANK, "Credit Card Statement", r"credit ?card", r"credit card statement"),
    ("BankStatement", BANK, "Bank Statement", r"bank ?st(atement)?s?\b|\bstatement\b|e-?statement|\bacct? ?st",
     r"statement of account|account statement|opening balance|closing balance"),
    ("BankLetter", BANK, "Bank Document", r"\bbank\b|\biban\b|swift|cheque", r"\biban\b|bank confirmation|to whom it may concern"),
    ("FinancialStatements", FINANCIALS, "Financial Statements", r"financial ?statements?|\bfinancials?\b|audited|\bfs\b",
     r"notes to the financial statements|independent auditor"),
    ("BalanceSheet", FINANCIALS, "Balance Sheet", r"balance ?sheet|\bbs\b", r"balance sheet|statement of financial position"),
    ("PNL", FINANCIALS, "Profit & Loss", r"\bp ?(&|and|n)? ?l\b|pnl|profit ?(and|&)? ?loss|income ?statement",
     r"profit and loss|profit & loss|statement of (comprehensive )?income|income statement"),
    ("TrialBalance", FINANCIALS, "Trial Balance", r"trial ?balance|\btb\b", r"trial balance"),
    ("GeneralLedger", FINANCIALS, "General Ledger", r"general ?ledger|\bgl\b|\bledger\b", r"general ledger"),
    ("CashFlow", FINANCIALS, "Cash Flow Statement", r"cash ?flow", r"statement of cash flows|cash flow statement"),
    ("Receivables", FINANCIALS, "Accounts Receivable", r"receivables?|\bar\b ?ageing|\bar\b ?aging|debtors", r"accounts receivable|debtors ageing"),
    ("Payables", FINANCIALS, "Accounts Payable", r"payables?|\bap\b ?ageing|\bap\b ?aging|creditors", r"accounts payable|creditors ageing"),
    ("FixedAssetRegister", FINANCIALS, "Fixed Asset Register", r"fixed ?assets?|\bfar\b", r"fixed asset register"),
    ("InventoryReport", FINANCIALS, "Inventory Report", r"inventory|stock ?(report|summary|list|valuation)", r"stock summary|inventory valuation"),
    ("PayrollReport", FINANCIALS, "Payroll Report", r"payroll|salary|salaries|\bwps\b|\bsif\b", r"payroll|salary register"),
    ("ManagementAccounts", FINANCIALS, "Management Accounts", r"management ?accounts|\bmis\b", r"management accounts"),
    ("AuditWorkingPapers", FINANCIALS, "Audit Working Papers", r"working ?papers?|lead ?schedule", r"working paper|lead schedule"),
    ("AccountingRecords", FINANCIALS, "Accounting Records", r"sales ?register|purchase ?register|day ?book|journal", r"sales register|purchase register"),
    ("Quotation", PROPOSALS, "Quotation", r"quotation|\bquote\b", r"quotation"),
    ("EngagementLetter", PROPOSALS, "Engagement Letter", r"engagement ?letter", r"engagement letter"),
    ("Proposal", PROPOSALS, "Proposal", r"proposal|fee ?proposal", r"fee proposal|our proposal"),
    ("ScopeOfWork", PROPOSALS, "Scope of Work", r"scope of work|\bsow\b", r"scope of work"),
    ("Agreement", PROPOSALS, "Agreement", r"agreement|\bmou\b|addendum", r"service agreement|this agreement"),
    ("Contract", PROPOSALS, "Contract", r"contract", r"this contract"),
]
_RULE_BY_TYPE = {r[0]: r for r in RULES}

# A document type the user picked overrides the file name and text.
SLOT_DEFAULTS = {
    "licence": ("TradeLicence", COMPANY), "moa": ("MOA", COMPANY), "eid": ("EmiratesID", KYC),
    "passport": ("Passport", KYC), "fin": ("FinancialStatements", FINANCIALS), "bank": ("BankStatement", BANK),
}

_CRED_NAME = re.compile(r"password|passwd|credential|login|log-in|secret|access ?details", re.I)
_CRED_STRONG = re.compile(r"\b(password|passwd|pwd|passcode|pin)\s*[:=\-]", re.I)
_CRED_WEAK = re.compile(r"\b(user ?name|user ?id|login|email|portal|otp)\s*[:=\-]", re.I)
_TALLY_MEMBERS = re.compile(r"(^|/)(tranmgr|linkmgr|company|cmpsave)\.(900|1800)$|\.(900|1800)$", re.I)

_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
_MONTH_RE = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_MONTH_YEAR = re.compile(_MONTH_RE + r"[\s_\-.,']*(?:\d{1,2}(?:st|nd|rd|th)?[\s_\-.,]*)?((?:19|20)\d{2})", re.I)
_YEAR_MONTH = re.compile(r"((?:19|20)\d{2})[\s_\-.]*" + _MONTH_RE + r"(?![a-z])", re.I)
_NUM_YM = re.compile(r"(?<!\d)((?:19|20)\d{2})[-_.](0[1-9]|1[0-2])(?!\d)")
_NUM_MY = re.compile(r"(?<!\d)(0[1-9]|1[0-2])[-_.]((?:19|20)\d{2})(?!\d)")
_PERIOD_END = re.compile(r"(?:year|period|month)\s+end(?:ed|ing)?\s+(?:on\s+)?(?:\d{1,2}(?:st|nd|rd|th)?\s+)?" + _MONTH_RE + r"[\s,]+(?:\d{1,2},?\s*)?((?:19|20)\d{2})", re.I)
_YEAR_ONLY = re.compile(r"(?:\bfy\s*|(?<![\d]))((?:19|20)\d{2})(?!\d)", re.I)


@dataclass
class Classification:
    doc_type: str
    category: str
    label: str
    confidence: str                      # high | medium | low
    reasons: list[str] = field(default_factory=list)
    sensitive: bool = False
    is_tally: bool = False
    year: int | None = None
    month: int | None = None
    period_source: str | None = None


def words_of(file_name: str) -> str:
    """'ABC_PNL-March2026.pdf' -> 'abc pnl march 2026' so patterns can use word boundaries."""
    stem = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", file_name)
    stem = re.sub(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", stem)
    stem = re.sub(r"[_\-.()\[\]+,]+", " ", stem)
    return re.sub(r"\s+", " ", stem).strip().lower()


def _month_index(token: str) -> int:
    return _MONTHS.index(token[:3].lower()) + 1


def _valid_year(y: int) -> bool:
    return 2000 <= y <= date.today().year + 1


def detect_period(file_name: str, text: str = "") -> tuple[int | None, int | None, str | None]:
    """Financial year and month from the file name first, then the start of the document text."""
    name = words_of(file_name).replace(" ", "_")
    for source, sample in (("filename", name), ("document", (text or "")[:4000])):
        if not sample:
            continue
        if source == "document":
            m = _PERIOD_END.search(sample)
            if m and _valid_year(int(m.group(2))):
                return int(m.group(2)), _month_index(m.group(1)), "document period end"
        hits: list[tuple[int, int, int]] = []  # (position, year, month)
        for m in _MONTH_YEAR.finditer(sample):
            hits.append((m.start(), int(m.group(2)), _month_index(m.group(1))))
        for m in _YEAR_MONTH.finditer(sample):
            hits.append((m.start(), int(m.group(1)), _month_index(m.group(2))))
        for m in _NUM_YM.finditer(sample):
            hits.append((m.start(), int(m.group(1)), int(m.group(2))))
        for m in _NUM_MY.finditer(sample):
            hits.append((m.start(), int(m.group(2)), int(m.group(1))))
        hits = [h for h in hits if _valid_year(h[1])]
        if hits:
            hits.sort()
            _, y, mth = hits[-1]  # the last date in a range is the period end
            return y, mth, source
        if source == "filename":
            years = [int(y) for y in _YEAR_ONLY.findall(sample) if _valid_year(int(y))]
            if years:
                return years[-1], None, source
    return None, None, None


def looks_like_credentials(file_name: str, ext: str, text: str) -> bool:
    if _CRED_NAME.search(file_name):
        return True
    if ext.lower() != ".txt":
        return False
    strong = len(_CRED_STRONG.findall(text))
    weak = len(_CRED_WEAK.findall(text))
    return strong >= 1 or weak >= 2


def is_tally_backup(file_name: str, ext: str, path=None) -> bool:
    if ext.lower() not in (".zip", ".tbk", ".001"):
        return False
    if re.search(r"tally", file_name, re.I):
        return True
    return path is not None and any(_TALLY_MEMBERS.search(n) for n in zip_member_names(path))


def classify(file_name: str, ext: str, text: str = "", slot: str | None = None, path=None,
             ai_type: str | None = None, ai_confidence: str | None = None) -> Classification:
    name = words_of(file_name)
    squashed = name.replace(" ", "")

    if looks_like_credentials(file_name, ext, text):
        return Classification("Credentials", SECRETS, "Credentials", "high",
                              ["credential keywords"], sensitive=True)

    if is_tally_backup(file_name, ext, path):
        year, month, src = detect_period(file_name)
        return Classification("TallyBackup", FINANCIALS, "Tally Backup", "high", ["tally backup archive"],
                              is_tally=True, year=year, month=month, period_source=src)

    scores: dict[str, float] = {}
    reasons: dict[str, list[str]] = {}
    slot_category = SLOT_DEFAULTS.get(slot or "", (None, None))[1]
    lowered = re.sub(r"\s+", " ", (text or "").lower())  # PDF text breaks lines mid-phrase
    for doc_type, category, _label, fn_pat, txt_pat in RULES:
        score = 0.0
        if fn_pat and (re.search(fn_pat, name) or re.search(fn_pat, squashed)):
            score += 3
            reasons.setdefault(doc_type, []).append("file name")
        if txt_pat and lowered and re.search(txt_pat, lowered):
            score += 3  # the document's own wording is stronger evidence than its file name
            reasons.setdefault(doc_type, []).append("document text")
        if score and slot_category == category:
            score += 1.5
            reasons.setdefault(doc_type, []).append(f"uploaded as {slot}")
        if score:
            scores[doc_type] = score

    if ai_type and ai_type in _RULE_BY_TYPE:
        scores[ai_type] = scores.get(ai_type, 0) + (4 if ai_confidence == "high" else 2)
        reasons.setdefault(ai_type, []).append("AI reading")

    best = max(scores, key=lambda k: (scores[k], -list(_RULE_BY_TYPE).index(k)), default=None)
    if best is None or scores[best] < 3:
        if slot in SLOT_DEFAULTS and (best is None or scores[best] < 3):
            doc_type, category = SLOT_DEFAULTS[slot]
            result = Classification(doc_type, category, _RULE_BY_TYPE[doc_type][2], "medium", [f"uploaded as {slot}"])
        else:
            result = Classification("Other", OTHERS, "Other Document", "low", ["no confident match"])
    else:
        _, category, label, _, _ = _RULE_BY_TYPE[best]
        conf = "high" if scores[best] >= 5 else "medium"
        result = Classification(best, category, label, conf, reasons.get(best, []))

    if result.category == FINANCIALS:
        result.year, result.month, result.period_source = detect_period(file_name, text)
    elif result.category == BANK:
        result.year, result.month, result.period_source = detect_period(file_name, text)
    return result
