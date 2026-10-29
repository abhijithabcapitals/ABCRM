"""Canonical field catalogue: the CRM-neutral names every extractor (local rules and AI) reports in.

A project maps these keys onto its own record (see crm.CrmAdapter). Dates are ISO (YYYY-MM-DD); periods are
"YYYY-MM-DD/YYYY-MM-DD"; yes/no values are "Yes" / "No".
"""
from __future__ import annotations

# key: (label, type, options)
FIELDS: dict[str, tuple[str, str, list[str] | None]] = {
    "legal_name": ("Legal name", "text", None),
    "trade_name": ("Trade name", "text", None),
    "entity_type": ("Legal form / entity type", "text",
                    ["LLC", "FZ-LLC", "FZE", "FZCO", "Sole Establishment", "Civil Company", "Branch", "Holding Company",
                     "Partnership", "Other"]),
    "registration_number": ("Company registration number", "text", None),
    "licence_number": ("Trade licence number", "text", None),
    "licence_authority": ("Licence issuing authority", "text", None),
    "licence_issue_date": ("Licence issue date", "date", None),
    "licence_expiry_date": ("Licence expiry date", "date", None),
    "jurisdiction": ("Jurisdiction", "select", ["Mainland", "Free Zone", "Offshore", "Foreign Entity", "Other"]),
    "emirate": ("Emirate", "select", ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"]),
    "establishment_date": ("Establishment / first issue date", "date", None),
    "website": ("Website", "text", None),
    "email": ("Company email", "text", None),
    "phone": ("Company phone", "text", None),
    "registered_address": ("Registered address", "text", None),
    "office_address": ("Office address", "text", None),
    "main_activity": ("Main business activity", "text", None),
    "secondary_activities": ("Other business activities ('; ' separated)", "text", None),
    "vat_registered": ("VAT registered", "yesno", None),
    "vat_trn": ("VAT TRN (15 digits)", "trn", None),
    "vat_registration_date": ("VAT registration date", "date", None),
    "vat_effective_date": ("VAT effective registration date", "date", None),
    "vat_filing_frequency": ("VAT filing frequency", "select", ["Monthly", "Quarterly", "Other"]),
    "vat_first_period": ("First VAT return period", "period", None),
    "ct_registered": ("Corporate Tax registered", "yesno", None),
    "ct_trn": ("Corporate Tax registration number (15 digits)", "trn", None),
    "ct_registration_date": ("Corporate Tax effective registration date", "date", None),
    "ct_first_period": ("First Corporate Tax period", "period", None),
    "financial_year": ("Financial year (e.g. 01 January – 31 December)", "text", None),
    "employees": ("Number of employees", "number", None),
}

# List entries (rows) and their item keys.
ROWS: dict[str, list[str]] = {
    "contacts": ["name", "designation", "email", "mobile"],
    "shareholders": ["name", "ownership", "nationality", "type"],
    "ubo": ["name", "nationality"],
    "bank_accounts": ["bank", "currency", "iban_last4"],
}
ROW_KEY = {"contacts": "name", "shareholders": "name", "ubo": "name", "bank_accounts": "bank"}
