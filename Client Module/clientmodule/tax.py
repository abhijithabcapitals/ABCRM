"""Tax compliance tracker (Tax Agent, AGT-03-TAX, phase: deadline tracking only).

Reads the Client Master and lists every tax/renewal obligation per client with its due date and status,
so nothing is missed. Read-only: it never writes to the master.

Rules follow the Tax Agent spec (Agent Module/03_Tax_Agent/CLAUDE.md):
- Never infer TRN, CT number, tax period or financial year. Missing or unclear inputs become a
  "missing" item asking for the data, never a guessed date.
- A due date confirmed in the master (VAT/CT Return Due Date) wins over a computed one.
- Every computed date states the rule it used (RULE_VERSION + basis).

UAE (FTA) rules applied:
- VAT return and payment: 28 days after the end of each tax period.
- Corporate Tax return and payment: within 9 months after the end of the tax period (financial year);
  first tax periods start on/after 01/06/2023, so financial years ending before 31/05/2024 have no return.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, timedelta
from typing import Any

from .master import NA, NP, needs_verification, parse_uae_date, plain
from .master import today as dubai_today

RULE_VERSION = "UAE-FTA 2026-10 (VAT: period end + 28 days; CT: period end + 9 months)"
CT_FIRST_PERIOD_END = date(2024, 5, 31)

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
FY_RE = re.compile(r"(\d{1,2})/(\d{1,2})(?:/\d{4})?\s*[-–]\s*(\d{1,2})/(\d{1,2})(?:/\d{4})?")
PERIOD_END_RE = re.compile(r"[-–]\s*(\d{1,2})/(\d{1,2})/(\d{4})")

# status order = urgency order on screen
STATUSES = ["overdue", "due_14", "due_30", "due_60", "upcoming", "missing", "review", "done"]


def _blank(v: str | None) -> bool:
    return not plain(v).strip() or plain(v).strip() in (NP, "Not Provided")


def _yes(v: str | None) -> bool:
    return plain(v).strip().lower() == "yes"


def _no(v: str | None) -> bool:
    return plain(v).strip().lower() == "no"


def _month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def _add_months_end(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    return _month_end(d.year + y, m + 1)


def _fmt(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def _status(due: date | None, today: date) -> str:
    if not due:
        return "missing"
    left = (due - today).days
    if left < 0:
        return "overdue"
    if left <= 14:
        return "due_14"
    if left <= 30:
        return "due_30"
    if left <= 60:
        return "due_60"
    return "upcoming"


def vat_period_end_months(frequency: str, tax_period: str) -> list[int] | None:
    """Month numbers (1-12) in which a VAT tax period ends; None when it can't be told without guessing."""
    freq = plain(frequency).strip().lower()
    if freq == "monthly":
        return list(range(1, 13))
    if freq != "quarterly":
        return None
    # e.g. "Feb-Apr / May-Jul / Aug-Oct / Nov-Jan": the last month of each range ends a period
    ends = []
    for part in re.split(r"[/;,]", plain(tax_period)):
        names = re.findall(r"[A-Za-z]{3,}", part)
        if len(names) >= 2 and names[-1][:3].lower() in MONTHS:
            ends.append(MONTHS[names[-1][:3].lower()])
    ends = sorted(set(ends))
    if not ends:
        return None
    first = ends[0]
    expected = sorted({(first - 1 + 3 * i) % 12 + 1 for i in range(4)})
    return expected if set(ends) <= set(expected) else None


def fy_end_day_month(rec: dict[str, str]) -> tuple[int, int] | None:
    """(day, month) the financial year ends, from 'Financial Year End' or 'Financial Year' (01/01 - 31/12)."""
    d = parse_uae_date(rec.get("Financial Year End"))
    if d:
        return d.day, d.month
    m = FY_RE.search(plain(rec.get("Financial Year")))
    if m:
        day, month = int(m.group(3)), int(m.group(4))
        if 1 <= month <= 12 and 1 <= day <= calendar.monthrange(2024, month)[1]:
            return day, month
    return None


def _item(rec: dict[str, str], category: str, title: str, due: date | None, today: date, basis: str,
          status: str | None = None, verify: bool = False, period: str = "",
          computed: bool = False) -> dict[str, Any]:
    # A computed date is an FTA-rule estimate from recorded inputs, not a verified deadline (CLAUDE.md:
    # never infer compliance deadlines), so it always carries computed=True for staff to confirm.
    st = status or _status(due, today)
    return {
        "clientId": rec.get("Client ID", ""),
        "clientName": plain(rec.get("Client Legal Name")) or plain(rec.get("Trade Name")) or rec.get("Client ID", ""),
        "taxSpecialist": plain(rec.get("Tax Specialist")),
        "accountManager": plain(rec.get("Account Manager")),
        "category": category,
        "title": title,
        "period": period,
        "dueDate": _fmt(due),
        "daysLeft": (due - today).days if due else None,
        "status": st,
        "basis": basis,
        "verify": verify,
        "computed": computed,
    }


def _missing(rec, category, title, basis):
    return _item(rec, category, title, None, dubai_today(), basis, status="missing")


def vat_items(rec: dict[str, str], today: date) -> list[dict[str, Any]]:
    reg = rec.get("VAT Registered")
    if _blank(reg):
        return [_missing(rec, "VAT", "VAT registration status not recorded",
                         "Record whether the client is VAT registered (Client Master > VAT).")]
    if not _yes(reg):
        return []
    out = []
    if _blank(rec.get("TRN")):
        out.append(_missing(rec, "VAT", "VAT TRN missing", "VAT registered but no TRN recorded. Never infer the TRN."))
    confirmed = parse_uae_date(rec.get("VAT Return Due Date"))
    if confirmed and confirmed >= today - timedelta(days=31):
        out.append(_item(rec, "VAT", "VAT return & payment", confirmed, today,
                         "Due date confirmed in Client Master (VAT Return Due Date).",
                         verify=needs_verification(rec.get("VAT Return Due Date"))))
        return out
    ends = vat_period_end_months(rec.get("VAT Filing Frequency", ""), rec.get("VAT Tax Period", ""))
    if not ends:
        out.append(_missing(rec, "VAT", "VAT tax period unclear",
                            "Set VAT Filing Frequency and VAT Tax Period (e.g. Feb-Apr / May-Jul / Aug-Oct / Nov-Jan) "
                            "as on the VAT certificate."))
        return out
    start = parse_uae_date(rec.get("VAT Effective Date")) or parse_uae_date(rec.get("VAT Registration Date"))
    # period ends around today: the latest whose return may still be open, and the next one
    candidates = []
    for y in (today.year - 1, today.year, today.year + 1):
        for m in ends:
            pe = _month_end(y, m)
            if start and pe < start:
                continue
            candidates.append(pe)
    candidates.sort()
    basis = f"{RULE_VERSION.split(' (')[0]}: tax period end + 28 days ({plain(rec.get('VAT Filing Frequency'))})."
    verify = any(needs_verification(rec.get(c)) for c in ("VAT Filing Frequency", "VAT Tax Period"))
    passed = [pe for pe in candidates if today - timedelta(days=31) <= pe + timedelta(days=28) < today]
    for pe in passed[-1:]:  # latest due date just passed: ask staff to confirm it was filed
        out.append(_item(rec, "VAT", "VAT return – confirm filed", pe + timedelta(days=28), today,
                         basis + " Due date passed; the Client Master does not record filing.", status="review",
                         verify=verify, period=f"Period ending {_fmt(pe)}", computed=True))
    upcoming = next((pe for pe in candidates if pe + timedelta(days=28) >= today), None)
    if upcoming:
        out.append(_item(rec, "VAT", "VAT return & payment", upcoming + timedelta(days=28), today, basis,
                         verify=verify, period=f"Period ending {_fmt(upcoming)}", computed=True))
    return out


def ct_items(rec: dict[str, str], today: date) -> list[dict[str, Any]]:
    reg = rec.get("Corporate Tax Registered")
    if _blank(reg):
        return [_missing(rec, "Corporate Tax", "Corporate Tax registration status not recorded",
                         "Record whether the client is registered for Corporate Tax (Client Master > Corporate Tax).")]
    if _no(reg):
        return [_item(rec, "Corporate Tax", "Corporate Tax registration needed?", None, today,
                      "Not registered for Corporate Tax. UAE juridical persons generally must register; "
                      "a tax specialist should confirm.", status="review")]
    out = []
    if _blank(rec.get("CT Registration Number")):
        out.append(_missing(rec, "Corporate Tax", "CT registration number missing",
                            "Registered for Corporate Tax but no CT TRN recorded. Never infer it."))
    status_txt = plain(rec.get("CT Return Status")).strip()
    confirmed = parse_uae_date(rec.get("CT Return Due Date"))
    if confirmed:
        st = "done" if status_txt == "Filed" else None
        out.append(_item(rec, "Corporate Tax", "Corporate Tax return & payment", confirmed, today,
                         f"Due date confirmed in Client Master (CT Return Due Date). Return status: {status_txt or 'not recorded'}.",
                         status=st, verify=needs_verification(rec.get("CT Return Due Date"))))
        return out
    fy = fy_end_day_month(rec)
    period_end = None
    m = PERIOD_END_RE.search(plain(rec.get("CT Tax Period")))
    if m:
        try:
            period_end = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            period_end = None
    if not period_end and fy:
        day, month = fy
        for y in (today.year - 1, today.year):  # latest financial year end not after today
            try:
                pe = date(y, month, min(day, calendar.monthrange(y, month)[1]))
            except ValueError:
                continue
            if pe <= today:
                period_end = pe
    if not period_end:
        out.append(_missing(rec, "Corporate Tax", "Financial year / CT tax period missing",
                            "Set Financial Year (e.g. 01/01 - 31/12) or CT Tax Period so the CT return date can be computed."))
        return out
    if period_end < CT_FIRST_PERIOD_END:
        return out
    due = _add_months_end(period_end, 9)
    st = "done" if status_txt == "Filed" else None
    out.append(_item(rec, "Corporate Tax", "Corporate Tax return & payment", due, today,
                     f"{RULE_VERSION.split(' (')[0]}: tax period end + 9 months. Return status: {status_txt or 'not recorded'}.",
                     status=st, verify=any(needs_verification(rec.get(c)) for c in ("Financial Year", "Financial Year End", "CT Tax Period")),
                     period=f"Tax period ending {_fmt(period_end)}", computed=True))
    return out


def renewal_items(rec: dict[str, str], today: date) -> list[dict[str, Any]]:
    out = []
    for col, category, title in (("License Expiry Date", "Trade Licence", "Trade licence renewal"),
                                 ("Renewal Date", "Engagement", "Engagement renewal")):
        d = parse_uae_date(rec.get(col))
        if d:
            out.append(_item(rec, category, title, d, today, f"Date from Client Master ({col}).",
                             verify=needs_verification(rec.get(col))))
        elif col == "License Expiry Date" and not _blank(rec.get("Trade License Number")) and rec.get(col) != NA:
            out.append(_missing(rec, category, "Trade licence expiry date missing",
                                "A trade licence is recorded but its expiry date is not."))
    return out


def compliance(rows: list[dict[str, str]], today: date | None = None) -> dict[str, Any]:
    today = today or dubai_today()
    items: list[dict[str, Any]] = []
    for rec in rows:
        for fn in (vat_items, ct_items, renewal_items):
            items.extend(fn(rec, today))
    order = {s: i for i, s in enumerate(STATUSES)}
    items.sort(key=lambda it: (order[it["status"]], it["daysLeft"] if it["daysLeft"] is not None else 10**6,
                               it["clientName"].lower()))
    summary = {s: sum(1 for it in items if it["status"] == s) for s in STATUSES}
    return {"asOf": _fmt(today), "ruleVersion": RULE_VERSION, "clientsChecked": len(rows),
            "summary": summary, "items": items}
