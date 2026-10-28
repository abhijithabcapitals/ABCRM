"""Client Module side of document intake. The pipeline itself (upload, validation and virus scan, OCR,
classification, extraction, confidence, review, file organization) is the shared Document Module (`docai`).

This file supplies what is specific to the client master:
  - ClientMasterAdapter: canonical document fields -> the 134 schema columns, list cells and checklist cells
  - destinations: "Services Provided" -> DataBase service folders (config.json serviceFolders)
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from docai import CrmAdapter, DocumentPipeline, PipelineConfig, PipelineError

from .config import Settings
from .master import DASH, docs_from_cell, list_from_cell, normal_name, plain, split_cell, unknown

FIELD_MAP = {
    "legal_name": "Client Legal Name", "trade_name": "Trade Name", "entity_type": "Entity Type",
    "registration_number": "Company Registration Number", "licence_number": "Trade License Number",
    "licence_authority": "License Issuing Authority", "licence_issue_date": "License Issue Date",
    "licence_expiry_date": "License Expiry Date", "jurisdiction": "Jurisdiction", "emirate": "Emirate",
    "establishment_date": "Establishment Date", "website": "Website", "email": "General Email", "phone": "General Phone",
    "registered_address": "Registered Address", "office_address": "Office Address", "main_activity": "Main Business Activity",
    "secondary_activities": "Secondary Activities", "vat_registered": "VAT Registered", "vat_trn": "TRN",
    "vat_registration_date": "VAT Registration Date", "vat_effective_date": "VAT Effective Date",
    "vat_filing_frequency": "VAT Filing Frequency", "vat_first_period": "VAT Tax Period",
    "ct_registered": "Corporate Tax Registered", "ct_trn": "CT Registration Number", "ct_registration_date": "CT Registration Date",
    "ct_first_period": "CT Tax Period", "financial_year": "Financial Year", "employees": "Number of Employees",
}
ROW_MAP = {"contacts": "Contact Details", "shareholders": "Shareholders", "ubo": "UBO", "bank_accounts": "Bank Accounts"}
ITEM_KEYS = {"name": "Name", "designation": "Designation", "email": "Email", "mobile": "Mobile", "ownership": "Ownership",
             "nationality": "Nationality", "type": "Type", "bank": "Bank", "currency": "Currency", "iban_last4": "IBAN last 4"}
# Document type -> (checklist column, item) in schema.json.
CHECKLIST = {
    "TradeLicence": [("Corporate Documents Status", "Trade License")],
    "IncorporationCertificate": [("Corporate Documents Status", "Certificate of Incorporation")],
    "MOA": [("Corporate Documents Status", "MOA")], "AOA": [("Corporate Documents Status", "AOA")],
    "ShareCertificate": [("Corporate Documents Status", "Share Certificate")],
    "TenancyContract": [("Corporate Documents Status", "Lease Agreement")],
    "EstablishmentCard": [("Corporate Documents Status", "Establishment Card")],
    "ChamberCertificate": [("Corporate Documents Status", "Chamber Certificate")],
    "Passport": [("Identity Documents Status", "Passport")], "EmiratesID": [("Identity Documents Status", "Emirates ID")],
    "Visa": [("Identity Documents Status", "Visa")], "UBODocument": [("Identity Documents Status", "UBO Documents")],
    "VATCertificate": [("Tax Documents Status", "VAT Certificate")], "CTCertificate": [("Tax Documents Status", "CT Certificate")],
    "VATReturn": [("Tax Documents Status", "Previous VAT Returns")], "CTReturn": [("Tax Documents Status", "Previous CT Returns")],
    "TrialBalance": [("Financial Documents Status", "Trial Balance")], "GeneralLedger": [("Financial Documents Status", "General Ledger")],
    "BalanceSheet": [("Financial Documents Status", "Balance Sheet")], "PNL": [("Financial Documents Status", "Profit & Loss")],
    "FinancialStatements": [("Financial Documents Status", "Balance Sheet"), ("Financial Documents Status", "Profit & Loss")],
    "BankStatement": [("Financial Documents Status", "Bank Statements")],
    "Receivables": [("Financial Documents Status", "Receivables Report")],
    "Payables": [("Financial Documents Status", "Payables Report")],
    "FixedAssetRegister": [("Financial Documents Status", "Fixed Asset Register")],
    "InventoryReport": [("Financial Documents Status", "Inventory Report")],
}


def _uae(iso: str) -> str:
    try:
        return date.fromisoformat(iso).strftime("%d/%m/%Y")
    except ValueError:
        return iso


class ClientMasterAdapter(CrmAdapter):
    field_map = FIELD_MAP
    row_map = ROW_MAP

    def __init__(self, schema_fields: dict[str, dict[str, Any]]):
        self.fields = schema_fields

    def format_value(self, key: str, value: str) -> str:
        if key.endswith("_date"):
            return _uae(value)
        if key.endswith("_period") and "/" in value:
            s, e = value.split("/", 1)
            return f"{_uae(s)} {DASH} {_uae(e)}" + (" (first period)" if key == "vat_first_period" else "")
        return value

    def format_row(self, list_name: str, item: dict[str, str]) -> dict[str, str]:
        out = {ITEM_KEYS.get(k, k): v for k, v in item.items() if v}
        if list_name == "bank_accounts" and not out.get("Currency"):
            out["Currency"] = "AED"
        return out

    def checklist(self, doc_type: str, status: str) -> list[tuple[str, str, str]]:
        return [(col, item, status) for col, item in CHECKLIST.get(doc_type, [])]

    def is_blank(self, target: str, current: str) -> bool:
        return unknown(current) or current == "N/A"

    def same(self, target: str, current: str, value: str) -> bool:
        n = lambda s: re.sub(r"[^a-z0-9]", "", plain(s).lower())  # noqa: E731
        return bool(n(current)) and n(current) == n(value)

    def row_exists(self, target: str, current: str, item: dict[str, str]) -> bool:
        key = "Bank" if target == "Bank Accounts" else "Name"
        rows = list_from_cell(current, self.fields[target])
        return any(normal_name(r.get(key)) == normal_name(item.get(key)) and
                   (target != "Bank Accounts" or r.get("IBAN last 4", "") == item.get("IBAN last 4", "")) for r in rows)

    def checklist_status(self, target: str, current: str, item: str) -> str:
        return docs_from_cell(current).get(item, "")


class DocumentService:
    def __init__(self, settings: Settings, schema_fields: dict[str, dict[str, Any]]):
        self.s = settings
        self.adapter = ClientMasterAdapter(schema_fields)
        self.pipe = DocumentPipeline(PipelineConfig(
            work_dir=settings.data_dir, max_upload_mb=settings.max_upload_mb, virus_scan=settings.virus_scan,
            ai_enabled=settings.ai_enabled, ai_model=settings.ai_model, ai_cap_usd=settings.ai_cap_usd,
            ai_monthly_budget_usd=settings.ai_monthly_budget_usd))

    def destinations(self, record: dict[str, str]) -> list[list[str]]:
        out: list[list[str]] = []
        for svc in split_cell(record.get("Services Provided")):
            folder = self.s.service_folders.get(svc)
            if folder and folder.split("\\") not in out:
                out.append(folder.split("\\"))
        return out

    def plan(self, batches: list[str], current: dict[str, str]) -> dict[str, Any]:
        return self.pipe.plan(batches, current, self.adapter)

    def file_batch(self, batch: str, client_id: str, record: dict[str, str]) -> dict[str, Any]:
        legal = plain(record.get("Client Legal Name", "")) or client_id
        return self.pipe.organize(batch, client_id, legal, self.s.storage_root, self.destinations(record))

    def pending_batches(self, client_id: str) -> list[str]:
        return [m["batch"] for m in self.pipe.batches_for(client_id) if any(not d.get("filed") for d in m["docs"])]

    def client_documents(self, client_id: str) -> dict[str, Any]:
        filed = [{k: r[k] for k in ("Timestamp", "Document Type", "Category", "Original Name", "Stored As", "Folders")}
                 for r in self.pipe.filed_for(client_id)]
        waiting = [{"batch": m["batch"], "name": d["name"], "label": d.get("label")}
                   for m in self.pipe.batches_for(client_id) for d in m["docs"] if not d.get("filed")]
        return {"filed": filed, "waiting": waiting}


__all__ = ["ClientMasterAdapter", "DocumentService", "PipelineError"]
