"""Build SQL Data/CRM_Onboarding_Database.xlsx from the Client Module's onboarding schema.

Every input on the Client Module onboarding form (clientmodule/schema.json, stages 1-15, plus the document
upload and final-review inputs) gets a column. Single-value fields live on the Clients sheet (one row per
client); list, multi-select and checklist fields get their own sheet keyed by Client ID.

    "D:\\Abhijith Projects\\CRM\\.venv\\Scripts\\python.exe" build_onboarding_workbook.py

Re-run after schema.json changes. It overwrites the workbook, so only run it while the workbook holds no
real client rows. Also writes SQL Data/FIELD_MAP.md.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).resolve().parent
CLIENT_MODULE = HERE.parent / "Client Module"
SCHEMA = CLIENT_MODULE / "clientmodule" / "schema.json"
CONFIG = CLIENT_MODULE / "config.json"
OUT_DIR = HERE / "SQL Data"
OUT = OUT_DIR / "CRM_Onboarding_Database.xlsx"
FIELD_MAP = OUT_DIR / "FIELD_MAP.md"

FIRST, LAST = 3, 2000  # data rows: row 1 = section band, row 2 = headers, row 3 = example
NP, NA = "Not Provided", "N/A"
VR = "Provided – Verification Required"

FONT = "Arial"
NAVY, SLATE, GREY = "1F3A4D", "5B7083", "8C8C8C"
BANDS = ["DCE6EE", "EEF2E6"]
EXAMPLE_FILL = PatternFill("solid", fgColor="FFF8E1")
THIN = Side(style="thin", color="C9D3DC")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# Document Module types (docai.pipeline.document_types) for the upload register
DOC_TYPES = [
    ("VAT / TRN Certificate", "Company Documents"), ("Corporate Tax Certificate", "Company Documents"),
    ("VAT Return", "Company Documents"), ("Corporate Tax Return", "Company Documents"),
    ("Tax Computation", "Financials"), ("Corporate Tax Document", "Company Documents"),
    ("Trade Licence", "Company Documents"), ("Memorandum of Association", "Company Documents"),
    ("Articles of Association", "Company Documents"), ("Certificate of Incorporation", "Company Documents"),
    ("Establishment Card", "Company Documents"), ("Chamber of Commerce Certificate", "Company Documents"),
    ("Share Certificate / Register", "Company Documents"), ("UBO Document", "Company Documents"),
    ("Customs Document", "Company Documents"), ("Tenancy Contract", "Company Documents"),
    ("Passport", "KYC"), ("Emirates ID", "KYC"), ("Residence Visa", "KYC"), ("Proof of Address", "KYC"),
    ("KYC Form", "KYC"), ("Credit Card Statement", "Bank Statements"), ("Bank Statement", "Bank Statements"),
    ("Bank Document", "Bank Statements"), ("Financial Statements", "Financials"), ("Balance Sheet", "Financials"),
    ("Profit & Loss", "Financials"), ("Trial Balance", "Financials"), ("General Ledger", "Financials"),
    ("Cash Flow Statement", "Financials"), ("Accounts Receivable", "Financials"),
    ("Accounts Payable", "Financials"), ("Fixed Asset Register", "Financials"),
    ("Inventory Report", "Financials"), ("Payroll Report", "Financials"), ("Management Accounts", "Financials"),
    ("Audit Working Papers", "Financials"), ("Accounting Records", "Financials"), ("Quotation", "Proposals"),
    ("Engagement Letter", "Proposals"), ("Proposal", "Proposals"), ("Scope of Work", "Proposals"),
    ("Agreement", "Proposals"), ("Contract", "Proposals"), ("Other Document", "Others"),
]

# Fictional example client. No real person, licence, TRN or KYC data.
EXAMPLE = {
    "Client ID": "CL000000", "Client Legal Name": "Example Trading LLC", "Trade Name": "Example Trading",
    "Entity Type": "LLC", "Company Registration Number": "Not Provided", "Trade License Number": "000000",
    "License Issuing Authority": "Dubai DET", "License Issue Date": date(2024, 1, 15),
    "License Expiry Date": date(2027, 1, 14), "Jurisdiction": "Mainland", "Emirate": "Dubai",
    "Establishment Date": date(2024, 1, 15), "Website": "https://www.example.com",
    "General Email": "info@example.com", "General Phone": "+971 4 000 0000",
    "Registered Address": "Office 000, Example Building, Dubai, UAE", "Office Address": "Same as registered",
    "Primary Contact": "Sample Contact", "Finance Contact": "Sample Contact", "Tax Contact": "Not Provided",
    "Audit Contact": "Not Provided", "Authorized Signatory": "Sample Signatory",
    "Ownership Structure": "100% held by one individual shareholder; no corporate parent.",
    "UBO Percentage": "Sample Shareholder - 100%", "UBO Documentation Status": "Under Review",
    "Main Business Activity": "General Trading", "Secondary Activities": "Not Provided", "Industry": "Trading",
    "Business Model Summary": "Example only: buys goods locally and sells to UAE businesses.",
    "B2B/B2C": "B2B", "Number of Employees": 5, "Number of Branches": 0, "UAE Sales": "Yes",
    "International Sales": "No", "Imports": "No", "Exports": "No", "E-commerce": "No",
    "Payment Gateways": "Not Provided", "POS": "No", "Cash Transactions": "No",
    "VAT Registered": "Yes", "TRN": "100000000000000", "VAT Registration Date": date(2024, 3, 1),
    "VAT Effective Date": date(2024, 3, 1), "VAT Filing Frequency": "Quarterly",
    "VAT Tax Period": "Mar-May / Jun-Aug / Sep-Nov / Dec-Feb", "VAT Return Due Date": "Not Provided",
    "VAT Penalties": "None reported", "VAT Issues": "None reported", "Corporate Tax Registered": "Yes",
    "CT Registration Number": "Not Provided", "CT Registration Date": "Not Provided",
    "CT Tax Period": "01/01/2025 - 31/12/2025", "Financial Year": "01/01 - 31/12",
    "CT Return Due Date": date(2026, 9, 30), "CT Return Status": "Not Yet Due", "CT Tax Payable": 0,
    "CT Tax Paid": 0, "CT Penalties": "None reported", "Small Business Relief": "Review Required",
    "Free Zone Person": "No", "Qualifying Free Zone Person": "N/A", "Tax Group": "Not a Member",
    "Tax Group Parent": "N/A", "Related Parties": "Not Provided", "Transfer Pricing Applicable": "No",
    "Transfer Pricing Documentation": "N/A", "Accounting Software": "Zoho Books",
    "Accounting Start Date": date(2025, 1, 1), "Financial Year Start": date(2025, 1, 1),
    "Financial Year End": date(2025, 12, 31), "Monthly Closing Deadline": "10th of the following month",
    "Bookkeeping Status": "Catch-up Required", "Opening Balances Available": "Yes",
    "Trial Balance Available": "Yes", "General Ledger Available": "No", "Chart of Accounts Available": "Yes",
    "Accounting Backup Available": "No", "Bank Statement Status": "Partially Received",
    "Bank Reconciliation Status": "Behind", "Payroll Applicable": "Yes", "Employee Count": 5,
    "Payroll Frequency": "Monthly", "WPS Applicable": "Yes", "Payroll Software": "Not Provided",
    "Audit Required": "No", "Audit Period": "N/A", "Previous Auditor": "N/A", "Previous Audit Report": "N/A",
    "Audit Issues": "N/A", "Previous Accountant": "Not Provided", "Previous Advisor": "Not Provided",
    "Handover Status": "Requested", "Engagement Letter Status": "Sent - Awaiting Signature",
    "Service Agreement Status": "Not Required", "Engagement Start Date": date(2026, 11, 1),
    "Engagement End Date": date(2027, 10, 31), "Renewal Date": date(2027, 10, 1), "Monthly Fee": 1500,
    "Annual Fee": 18000, "Billing Frequency": "Monthly", "Payment Terms": "30 days from invoice",
    "Outstanding Amount": 0, "Overdue Amount": 0, "Payment Status": "Not Yet Invoiced", "Risk Level": "Medium",
    "Risk Reason": "Missing documents; Incomplete previous records", "Onboarding Status": "Documents Pending",
    "Items Requiring Review": "Small Business Relief eligibility", "Account Manager": "Staff Member A",
    "Accountant": "Staff Member B", "Tax Specialist": "Staff Member C", "Auditor": "N/A",
    "Reviewer": "Staff Member D", "Business Notes": "Example row - delete or overwrite.",
    "Accounting Notes": "Zoho Books: Access Required", "Tax Notes": "Not Provided", "Audit Notes": "N/A",
    "Management Notes": "Not Provided", "Important Instructions": "Not Provided",
    "Onboarding Completion %": 0.72, "Missing Information": "CT Registration Number; General Ledger",
    "Last Updated": datetime(2026, 10, 28, 12, 0), "Onboarding Completed Date": "Not Provided",
    "Final Review Confirmed": "Yes", "Duplicate Override": "No",
}


def name_for(label: str) -> str:
    return "L_" + re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_")


class Builder:
    def __init__(self, schema: dict, config: dict):
        self.schema, self.config = schema, config
        self.wb = Workbook()
        self.lists_ws = None
        self.list_names: dict[str, str] = {}
        self.list_col = 0
        self.map_rows: list[list[str]] = []  # field map rows
        self.placed: set[str] = set()        # master columns that have a home in the workbook

    # ---------- shared dropdown lists ----------
    def add_list(self, label: str, values: list[str]) -> str:
        if label in self.list_names:
            return self.list_names[label]
        ws = self.lists_ws
        self.list_col += 1
        c = self.list_col
        L = get_column_letter(c)
        ws.cell(1, c, label).font = Font(name=FONT, bold=True, color="FFFFFF")
        ws.cell(1, c).fill = PatternFill("solid", fgColor=NAVY)
        ws.cell(1, c).alignment = Alignment(wrap_text=True, vertical="top")
        for i, v in enumerate(values, start=2):
            ws.cell(i, c, v).font = Font(name=FONT)
        ws.column_dimensions[L].width = max(16, min(40, max(len(str(v)) for v in values + [label]) + 2))
        nm = name_for(label)
        self.wb.defined_names[nm] = DefinedName(nm, attr_text=f"Lists!${L}$2:${L}${len(values) + 1}")
        self.list_names[label] = nm
        return nm

    def select_list(self, label: str, opts: list[str]) -> str:
        extra = [x for x in (NP, NA) if x not in opts]
        return self.add_list(label, list(opts) + extra)

    # ---------- sheet scaffolding ----------
    def sheet(self, title: str, columns: list[dict], tab: str) -> tuple:
        """columns: {header, section, kind(required|optional|auto|formula), width, fmt, dv, comment, example, formula}"""
        ws = self.wb.create_sheet(title)
        ws.sheet_properties.tabColor = tab
        sections: list[tuple[str, int, int]] = []
        for i, col in enumerate(columns, start=1):
            if sections and sections[-1][0] == col["section"]:
                sections[-1] = (col["section"], sections[-1][1], i)
            else:
                sections.append((col["section"], i, i))
        for n, (sec, a, b) in enumerate(sections):
            fill = PatternFill("solid", fgColor=BANDS[n % 2])
            for c in range(a, b + 1):
                ws.cell(1, c).fill = fill
                ws.cell(1, c).border = BORDER
            ws.cell(1, a, sec).font = Font(name=FONT, bold=True, color=NAVY)
            ws.cell(1, a).alignment = Alignment(horizontal="left", vertical="center")
            if b > a:
                ws.merge_cells(start_row=1, start_column=a, end_row=1, end_column=b)
        hdr_fill = {"required": NAVY, "optional": SLATE, "auto": GREY, "formula": GREY}
        for i, col in enumerate(columns, start=1):
            L = get_column_letter(i)
            h = ws.cell(2, i, col["header"])
            h.font = Font(name=FONT, bold=True, color="FFFFFF")
            h.fill = PatternFill("solid", fgColor=hdr_fill[col["kind"]])
            h.alignment = Alignment(wrap_text=True, vertical="center")
            h.border = BORDER
            if col.get("comment"):
                h.comment = Comment(col["comment"], "CRM")
                h.comment.width, h.comment.height = 300, 140
            ws.column_dimensions[L].width = col.get("width", 20)
            fmt = col.get("fmt", "@")
            ex = col.get("example")
            if col.get("formula"):
                cell = ws.cell(FIRST, i, col["formula"].format(r=FIRST))
            else:
                cell = ws.cell(FIRST, i, ex)
            cell.font = Font(name=FONT, italic=True, color="555555")
            cell.fill = EXAMPLE_FILL
            cell.number_format = fmt
            cell.alignment = Alignment(vertical="top", wrap_text=bool(col.get("wrap")))
            cell.border = BORDER
            # formulas pre-filled down so new rows work without copying
            if col.get("formula"):
                for r in range(FIRST + 1, FIRST + 200):
                    c2 = ws.cell(r, i, col["formula"].format(r=r))
                    c2.font = Font(name=FONT, color="000000")
                    c2.number_format = fmt
            dv = col.get("dv")
            if dv:
                dv.sqref = f"{L}{FIRST}:{L}{LAST}"
                ws.add_data_validation(dv)
            # number format for the empty input rows (text format keeps TRNs, phones and IBAN digits exact)
            if not col.get("formula"):
                for r in range(FIRST + 1, FIRST + 200):
                    ws.cell(r, i).number_format = fmt
                    ws.cell(r, i).font = Font(name=FONT)
        ws.row_dimensions[1].height = 20
        ws.row_dimensions[2].height = 45
        ws.freeze_panes = "C3" if title == "Clients" else "B3"
        ws.auto_filter.ref = f"A2:{get_column_letter(len(columns))}{LAST}"
        return ws

    # ---------- validations ----------
    @staticmethod
    def dv_list(nm: str, title: str) -> DataValidation:
        return DataValidation(type="list", formula1=f"={nm}", allow_blank=True, errorStyle="warning",
                              showErrorMessage=True, errorTitle=title,
                              error="Pick a value from the list (Not Provided / N/A are allowed). "
                                    "Click Yes to keep a value marked (Provided – Verification Required).")

    @staticmethod
    def dv_custom(formula: str, title: str, msg: str) -> DataValidation:
        return DataValidation(type="custom", formula1=formula, allow_blank=True, errorStyle="warning",
                              showErrorMessage=True, errorTitle=title, error=msg)

    def dv_for(self, f: dict, L: str) -> tuple[DataValidation | None, str, int]:
        """Validation, number format and width for a single-value schema field in column L."""
        t, col, cell = f["type"], f["col"], f"{L}{FIRST}"
        np_na = f'{cell}="{NP}",{cell}="{NA}"'
        if t == "select":
            return self.dv_list(self.select_list(col, f["opts"]), col), "@", 22
        if t == "yesno":
            return self.dv_list(self.add_list("Yes / No", ["Yes", "No", NP, NA]), col), "@", 14
        if t == "date":
            return self.dv_custom(f"=OR(ISNUMBER({cell}),{np_na})", col,
                                  "Enter a date (DD/MM/YYYY), Not Provided or N/A."), "dd/mm/yyyy", 14
        if t == "number":
            return self.dv_custom(f"=OR(AND(ISNUMBER({cell}),{cell}>=0,{cell}=INT({cell})),{np_na})", col,
                                  "Enter a whole number, Not Provided or N/A."), "0", 12
        if t == "money":
            return self.dv_custom(f"=OR(ISNUMBER({cell}),{np_na})", col,
                                  "Enter an amount in AED, Not Provided or N/A."), '"AED "#,##0.00', 16
        if t == "email":
            return self.dv_custom(f'=OR(ISNUMBER(SEARCH("@",{cell})),{np_na})', col,
                                  "Enter an email address, Not Provided or N/A."), "@", 26
        if col == "TRN":
            return self.dv_custom(f"=OR(AND(LEN({cell})=15,ISNUMBER(--{cell})),{np_na})", col,
                                  "TRN must be exactly 15 digits (or Not Provided / N/A)."), "@", 18
        if t in ("textarea", "review"):
            return None, "@", 36
        if t == "url":
            return None, "@", 26
        return None, "@", 22

    # ---------- field map ----------
    def map_row(self, stage: str, field: str, ftype: str, req: str, when: str, rule: str, sheet: str,
                column: str, master: str):
        self.map_rows.append([stage, field, ftype, req, when, rule, sheet, column, master])

    @staticmethod
    def when_text(f: dict) -> str:
        w = f.get("when")
        if not w:
            return ""
        return f'{w["col"]} = {w["eq"]}' if "eq" in w else f'{w["col"]} is not {w["ne"]}'

    @staticmethod
    def rule_text(f: dict) -> str:
        parts = []
        if f.get("opts"):
            parts.append("Options: " + ", ".join(f["opts"]))
        if f.get("suggest"):
            parts.append("Suggestions (free text): " + ", ".join(f["suggest"]))
        if f.get("hint"):
            parts.append(f["hint"])
        if f["col"] == "TRN":
            parts.append("Validation: 15 digits")
        if f["type"] == "date":
            parts.append("DD/MM/YYYY")
        if f["type"] == "money":
            parts.append("AED amount")
        return " | ".join(parts)

    # ---------- build ----------
    def build(self) -> Workbook:
        self.wb.remove(self.wb.active)
        legend = self.wb.create_sheet("Legend")
        self.lists_ws = self.wb.create_sheet("Lists")  # filled while sheets are built, moved to the end later
        stages = self.schema["stages"]
        fields = {f["col"]: f for st in stages for f in st["fields"]}
        stage_no = {f["col"]: (i + 2, st["title"]) for i, st in enumerate(stages) for f in st["fields"]}

        # ---- Clients: every single-value field, in form order ----
        cols: list[dict] = [{"header": "Client ID", "section": "System", "kind": "auto", "width": 12,
                             "example": EXAMPLE["Client ID"],
                             "comment": "Issued by the Client Module on first save (CL000001, CL000002 ...). Never reused."}]
        self.map_row("System", "Client ID", "auto", "Auto", "", "CL + 6 digits, issued on save", "Clients", "A",
                     "Client ID")
        child_fields = []
        for st in stages:
            for f in st["fields"]:
                if f["type"] in ("list", "docs", "multi"):
                    child_fields.append(f)
                    continue
                cols.append({"field": f, "section": f"{stage_no[f['col']][0]}. {st['title']}"})
        for extra, kind, comment, ex in [
            ("Onboarding Completion %", "auto", "Calculated by the Client Module: required fields that apply + "
             "checklist documents. 90-100% Fully Onboarded, 70-89% Mostly, 50-69% Incomplete, <50% High Attention.", None),
            ("Missing Information", "auto", "Filled by the Client Module from blank required fields and Missing documents.", None),
            ("Last Updated", "auto", "Timestamp of the last save (Asia/Dubai).", None),
            ("Onboarding Completed Date", "auto", "Set when the client reaches Fully Onboarded.", None),
        ]:
            cols.append({"header": extra, "section": "System (auto)", "kind": kind, "comment": comment})
        for extra, comment in [
            ("Final Review Confirmed", "Final Review tick box: the client/user reviewed the summary before saving. "
             "Not stored in client-master.csv; the Client Module refuses to save without it."),
            ("Duplicate Override", "Final Review: Yes only when staff confirmed a likely duplicate is a different "
             "legal entity (allowDuplicate). Not stored in client-master.csv."),
        ]:
            cols.append({"header": extra, "section": "Final Review", "kind": "optional", "comment": comment,
                         "special": "yesno_plain"})

        for i, c in enumerate(cols, start=1):
            L = get_column_letter(i)
            f = c.get("field")
            if f:
                dv, fmt, width = self.dv_for(f, L)
                kind = "required" if f.get("req") else ("auto" if f["type"] == "derived" else "optional")
                tip = [f"Stage {stage_no[f['col']][0]}: {stage_no[f['col']][1]}",
                       "Required" if f.get("req") else "Optional"]
                if f.get("when"):
                    tip.append("Applies when " + self.when_text(f) + "; otherwise N/A")
                if f["type"] == "derived":
                    tip.append(f"Filled from the Contacts sheet: contact with role '{f['role']}'.")
                if f.get("riskFactors"):
                    tip.append("Pick factors from Lists > Risk Factors; separate with '; '. Required when "
                               "Risk Level is High or Review Required.")
                if f.get("hint"):
                    tip.append(f["hint"])
                if f.get("suggest"):
                    tip.append("Suggestions: " + ", ".join(f["suggest"][:8]) + " ...")
                if f.get("ask"):
                    tip.append("Form asks: " + f["ask"])
                c.update(header=f["col"], kind=kind, dv=dv, fmt=fmt, width=width, comment="\n".join(tip),
                         example=EXAMPLE.get(f["col"]), wrap=f["type"] in ("textarea", "review"))
                self.placed.add(f["col"])
                self.map_row(f"{stage_no[f['col']][0]}. {stage_no[f['col']][1]}", f["col"], f["type"],
                             "Yes" if f.get("req") else "No", self.when_text(f), self.rule_text(f), "Clients", L,
                             f["col"])
                if f.get("riskFactors"):
                    self.add_list("Risk Factors", f["riskFactors"])
                if f.get("suggest"):
                    self.add_list(f["col"] + " (suggestions)", f["suggest"])
            else:
                h = c["header"]
                c["example"] = EXAMPLE.get(h)
                if h == "Onboarding Completion %":
                    c.update(fmt="0%", width=13)
                elif h == "Last Updated":
                    c.update(fmt="dd/mm/yyyy hh:mm", width=17)
                elif h == "Onboarding Completed Date":
                    c.update(fmt="dd/mm/yyyy", width=14)
                elif h == "Missing Information":
                    c.update(width=36, wrap=True)
                elif c.get("special") == "yesno_plain":
                    c.update(dv=self.dv_list(self.add_list("Yes / No (final review)", ["Yes", "No"]), h), width=14)
                if h != "Client ID":
                    sec = c["section"]
                    self.placed.add(h)
                    self.map_row(sec, h, "auto" if c["kind"] == "auto" else "yesno", "Auto" if c["kind"] == "auto"
                                 else "Yes" if h == "Final Review Confirmed" else "No", "", c["comment"], "Clients",
                                 L, h if c["kind"] == "auto" else "(not stored in client-master.csv)")
        self.placed.add("Client ID")
        self.sheet("Clients", cols, NAVY)

        # ---- child sheets ----
        name_formula = ('=IF(A{r}="","",IFERROR(INDEX(Clients!$B$3:$B$' + str(LAST) +
                        ',MATCH(A{r},Clients!$A$3:$A$' + str(LAST) + ',0)),"Client ID not on Clients sheet"))')
        key_cols = [
            {"header": "Client ID", "section": "Client", "kind": "required", "width": 12, "example": "CL000000",
             "comment": "Client ID from the Clients sheet. One client can have many rows here."},
            {"header": "Client Legal Name", "section": "Client", "kind": "formula", "width": 26,
             "formula": name_formula, "comment": "Looked up from the Clients sheet. Do not type here."},
        ]

        def sub_cols(f: dict, sheet_name: str, examples: dict) -> list[dict]:
            out = []
            st = f"{stage_no[f['col']][0]}. {stage_no[f['col']][1]}"
            for s in f["sub"]:
                label = s.get("label", s["key"])
                L = get_column_letter(len(key_cols) + len(out) + 1)
                c = {"header": label, "section": f["col"], "kind": "optional", "example": examples.get(s["key"]),
                     "width": 22}
                rule = ""
                if s["type"] == "select":
                    c["dv"] = self.dv_list(self.select_list(f"{f['col']}: {label}", s["opts"]), label)
                    rule = "Options: " + ", ".join(s["opts"])
                elif s["type"] == "email":
                    c["dv"] = self.dv_custom(f'=OR(ISNUMBER(SEARCH("@",{L}{FIRST})),{L}{FIRST}="{NP}")', label,
                                             "Enter an email address or Not Provided.")
                    c["width"] = 26
                elif s["type"] == "percent":
                    c.update(fmt="0.00%", width=12, dv=self.dv_custom(
                        f"=AND(ISNUMBER({L}{FIRST}),{L}{FIRST}>=0,{L}{FIRST}<=1)", label,
                        "Enter a percentage between 0% and 100%."))
                    rule = "0% - 100%; all shareholders of a client should total 100%"
                elif s["type"] == "last4":
                    c.update(width=12, dv=self.dv_custom(
                        f"=AND(LEN({L}{FIRST})=4,ISNUMBER(--{L}{FIRST}))", label,
                        "Store ONLY the last 4 digits of the IBAN."))
                    rule = "Last 4 digits only - never the full IBAN"
                elif s["type"] == "multi":
                    continue  # roles handled by caller
                if s.get("default"):
                    rule = (rule + " | " if rule else "") + f"Default {s['default']}"
                out.append(c)
                self.map_row(st, f"{f['col']} > {label}", s["type"], "Yes" if f.get("req") and s is f["sub"][0]
                             else "No", self.when_text(f), rule, sheet_name, L, f"{f['col']} (part '{s['key']}')")
            self.placed.add(f["col"])
            return out

        # Contacts (roles become Yes/No columns so each can be validated)
        cf = fields["Contact Details"]
        ccols = sub_cols(cf, "Contacts", {"Name": "Sample Contact", "Designation": "Finance Manager",
                                          "Department": "Finance", "Email": "contact@example.com",
                                          "Mobile": "+971 50 000 0000", "WhatsApp": "+971 50 000 0000",
                                          "Prefers": "Email"})
        roles = next(s for s in cf["sub"] if s["key"] == "Roles")["opts"]
        yn = self.add_list("Yes / No (final review)", ["Yes", "No"])
        for role in roles:
            L = get_column_letter(len(key_cols) + len(ccols) + 1)
            ccols.append({"header": f"Role: {role}", "section": "Roles (tick all that apply)", "kind": "optional",
                          "width": 12, "example": "Yes" if role in ("Primary", "Finance") else "No",
                          "dv": self.dv_list(yn, role)})
            self.map_row("2. Contacts", f"Contact Details > Roles > {role}", "multi (checkbox)", "No", "",
                         f"Contact with this role fills the '{role} Contact' column" if role in
                         ("Primary", "Finance", "Tax", "Audit") else "Authorized Signatory column" if
                         role == "Authorized Signatory" else "", "Contacts", L, "Contact Details (part 'Roles')")
        self.sheet("Contacts", key_cols + ccols, "2E7D6B")

        # Shareholders (+ total check)
        sf = fields["Shareholders"]
        scols = sub_cols(sf, "Shareholders", {"Name": "Sample Shareholder", "Ownership": 1,
                                              "Nationality": "Not Provided", "Type": "Individual"})
        pct = get_column_letter(len(key_cols) + 2)
        tot = (f'=IF(A{{r}}="","",SUMIFS(${pct}$3:${pct}${LAST},$A$3:$A${LAST},A{{r}}))')
        scols.append({"header": "Client Total %", "section": "Check", "kind": "formula", "width": 12,
                      "fmt": "0.00%", "formula": tot, "comment": "Sum of Ownership % for this client."})
        totL = get_column_letter(len(key_cols) + len(scols))
        scols.append({"header": "Shareholding Check", "section": "Check", "kind": "formula", "width": 20,
                      "formula": f'=IF(A{{r}}="","",IF(ROUND({totL}{{r}},4)=1,"OK","Total is not 100%"))',
                      "comment": "The Client Module flags shareholding that does not total 100%."})
        self.sheet("Shareholders", key_cols + scols, "6A4C93")

        uf = fields["UBO"]
        self.sheet("UBOs", key_cols + sub_cols(uf, "UBOs", {"Name": "Sample Shareholder",
                                                             "Nationality": "Not Provided", "Basis": "Ownership"}),
                   "8E3B46")

        bf = fields["Bank Accounts"]
        self.sheet("Bank Accounts", key_cols + sub_cols(bf, "Bank Accounts", {
            "Bank": "Example Bank", "Currency": "AED", "Type": "Current", "IBAN last 4": "0000", "Bank Feed": "No"}),
            "B7791F")

        # Services (+ DataBase folder from config.json)
        svf = fields["Services Provided"]
        svc_nm = self.add_list("Services Provided", svf["opts"])
        folders = self.config.get("serviceFolders", {})
        ws_l = self.lists_ws
        self.list_col += 1
        a = self.list_col
        self.list_col += 1
        ws_l.cell(1, a, "Service → DataBase folder").font = Font(name=FONT, bold=True, color="FFFFFF")
        ws_l.cell(1, a).fill = PatternFill("solid", fgColor=NAVY)
        ws_l.cell(1, a + 1, "Folder").font = Font(name=FONT, bold=True, color="FFFFFF")
        ws_l.cell(1, a + 1).fill = PatternFill("solid", fgColor=NAVY)
        for i, (svc, folder) in enumerate(folders.items(), start=2):
            ws_l.cell(i, a, svc).font = Font(name=FONT)
            ws_l.cell(i, a + 1, folder).font = Font(name=FONT)
        ws_l.column_dimensions[get_column_letter(a)].width = 28
        ws_l.column_dimensions[get_column_letter(a + 1)].width = 26
        rng = f"Lists!${get_column_letter(a)}$2:${get_column_letter(a + 1)}${len(folders) + 1}"
        self.wb.defined_names["L_Service_Folders"] = DefinedName("L_Service_Folders", attr_text=rng)
        self.sheet("Services", key_cols + [
            {"header": "Service", "section": "5. Services Required", "kind": "required", "width": 30,
             "example": "Bookkeeping", "dv": self.dv_list(svc_nm, "Service"),
             "comment": "One row per service. Multi-select on the form."},
            {"header": "DataBase Folder", "section": "5. Services Required", "kind": "formula", "width": 26,
             "formula": '=IF(C{r}="","",IFERROR(VLOOKUP(C{r},L_Service_Folders,2,FALSE),"No folder mapped"))',
             "comment": "Where the client's documents are filed for this service (Client Module config.json)."},
        ], "1F6F9F")
        self.placed.add("Services Provided")
        self.map_row("5. Services Required", "Services Provided", "multi", "Yes", "",
                     "Options: " + ", ".join(svf["opts"]), "Services", "C", "Services Provided ('; ' separated)")

        # Compliance flags
        cff = fields["Compliance Flags"]
        self.sheet("Compliance Flags", key_cols + [
            {"header": "Compliance Flag", "section": "14. Risk & Compliance", "kind": "optional", "width": 34,
             "example": "Payroll/WPS", "dv": self.dv_list(self.add_list("Compliance Flags", cff["opts"]), "Flag"),
             "comment": "One row per flag. Flags are for professional review only."},
        ], "5D6D7E")
        self.placed.add("Compliance Flags")
        self.map_row("14. Risk & Compliance", "Compliance Flags", "multi", "No", "",
                     "Options: " + ", ".join(cff["opts"]), "Compliance Flags", "C", "Compliance Flags ('; ' separated)")

        # Document checklist (stage 12 docs fields)
        docs_fields = [f for f in child_fields if f["type"] == "docs"]
        grp_nm = self.add_list("Checklist Group", [f["col"] for f in docs_fields])
        all_docs = [d for f in docs_fields for d in f["docs"]]
        doc_nm = self.add_list("Checklist Document", all_docs)
        st_nm = self.add_list("Document Status", self.schema["docStatuses"])
        dws = self.sheet("Document Checklist", key_cols + [
            {"header": "Checklist Group", "section": "12. Documents & Handover", "kind": "required", "width": 28,
             "dv": self.dv_list(grp_nm, "Checklist Group"), "example": docs_fields[0]["col"]},
            {"header": "Document", "section": "12. Documents & Handover", "kind": "required", "width": 30,
             "dv": self.dv_list(doc_nm, "Document"), "example": docs_fields[0]["docs"][0]},
            {"header": "Status", "section": "12. Documents & Handover", "kind": "required", "width": 16,
             "dv": self.dv_list(st_nm, "Status"), "example": "Received",
             "comment": "Received / Under Review / Not Applicable count toward completion; Missing is listed under "
                        "Missing Information."},
        ], "3C6E47")
        # one row per checklist document for the example client so the full checklist is visible
        r = FIRST
        for f in docs_fields:
            for d in f["docs"]:
                if r > FIRST:
                    vals = ["CL000000", None, f["col"], d, "Missing"]
                    for ci, v in enumerate(vals, start=1):
                        if ci == 2:
                            continue
                        cell = dws.cell(r, ci, v)
                        cell.font = Font(name=FONT, italic=True, color="555555")
                        cell.fill = EXAMPLE_FILL
                    dws.cell(r, 2).fill = EXAMPLE_FILL
                    dws.cell(r, 2).font = Font(name=FONT, italic=True, color="555555")
                r += 1
            self.placed.add(f["col"])
            self.map_row("12. Documents & Handover", f["col"], "docs checklist", "Yes", "",
                         "Documents: " + ", ".join(f["docs"]) + " | Status: " + ", ".join(self.schema["docStatuses"]),
                         "Document Checklist", "C-E", f"{f['col']} ('Doc: Status; ...')")

        # Uploaded documents (stage 1 / Document Module register)
        dt_nm = self.add_list("Document Type", [d for d, _ in DOC_TYPES])
        cat_nm = self.add_list("Document Category", sorted({c for _, c in DOC_TYPES}))
        month_nm = self.add_list("Month", [str(m) for m in range(1, 13)])
        up_cols = [
            ("Upload Timestamp", "auto", "dd/mm/yyyy hh:mm", 17, datetime(2026, 10, 28, 11, 30), None,
             "When the file was received (Asia/Dubai)."),
            ("Batch ID", "auto", "@", 18, "Not Provided", None, "Upload batch from the Document Module inbox."),
            ("Original File Name", "required", "@", 30, "trade-licence-example.pdf", None, "File as uploaded."),
            ("Document Type", "required", "@", 28, "Trade Licence", self.dv_list(dt_nm, "Document Type"),
             "Detected by the Document Module; staff can correct it on the form."),
            ("Category", "auto", "@", 18, "Company Documents", self.dv_list(cat_nm, "Category"),
             "Follows from the document type."),
            ("Period Year", "optional", "0", 11, None, self.dv_custom(
                "=AND(ISNUMBER({c}),{c}>=2000,{c}<=2100)", "Period Year", "Enter a 4-digit year."),
             "Statements / returns only: the year the document covers."),
            ("Period Month", "optional", "@", 11, None, self.dv_list(month_nm, "Period Month"),
             "Statements only: 1-12."),
            ("Stored As", "auto", "@", 30, None, None, "File name after filing."),
            ("SHA256", "auto", "@", 20, None, None, "Checksum of the filed copy."),
            ("Filed To Folders", "auto", "@", 36, None, None, "DataBase service folders the copy was filed into."),
        ]
        ucols = []
        for i, (h, kind, fmt, w, ex, dv, cm) in enumerate(up_cols, start=len(key_cols) + 1):
            L = get_column_letter(i)
            if dv is not None and dv.type == "custom":
                dv.formula1 = dv.formula1.replace("{c}", f"{L}{FIRST}")
            ucols.append({"header": h, "section": "1. Documents (upload)", "kind": kind, "fmt": fmt, "width": w,
                          "example": ex, "dv": dv, "comment": cm})
            self.map_row("1. Documents (upload)", f"Uploaded file > {h}", "upload" if kind != "auto" else "auto",
                         "Yes" if kind == "required" else "No", "", cm, "Documents Uploaded", L,
                         "data/documents.csv (Document Module register)")
        self.sheet("Documents Uploaded", key_cols + ucols, "7F7F7F")

        # ---- field map sheet ----
        fm = self.wb.create_sheet("Field Map")
        fm.sheet_properties.tabColor = "404040"
        heads = ["Stage", "Form Field", "Input Type", "Required", "Applies When", "Options / Rules",
                 "Workbook Sheet", "Workbook Column", "client-master.csv Column"]
        widths = [24, 40, 14, 10, 30, 60, 20, 12, 34]
        for i, (h, w) in enumerate(zip(heads, widths), start=1):
            c = fm.cell(1, i, h)
            c.font = Font(name=FONT, bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor=NAVY)
            c.alignment = Alignment(wrap_text=True, vertical="center")
            fm.column_dimensions[get_column_letter(i)].width = w
        order = {s: i for i, s in enumerate(
            ["System", "1. Documents (upload)"] + [f"{i + 2}. {st['title']}" for i, st in enumerate(stages)]
            + ["System (auto)", "Final Review"])}
        self.map_rows.sort(key=lambda r: order.get(r[0], 99))
        for r, row in enumerate(self.map_rows, start=2):
            for i, v in enumerate(row, start=1):
                c = fm.cell(r, i, v)
                c.font = Font(name=FONT)
                c.alignment = Alignment(wrap_text=i in (2, 5, 6, 9), vertical="top")
                c.number_format = "@"
        fm.freeze_panes = "C2"
        fm.auto_filter.ref = f"A1:I{len(self.map_rows) + 1}"

        # ---- legend ----
        self.legend(legend)
        # Lists last
        self.wb.move_sheet("Lists", offset=len(self.wb.sheetnames))
        self.lists_ws.sheet_properties.tabColor = "BFBFBF"
        self.lists_ws.freeze_panes = "A2"
        for row in self.wb["Lists"].iter_rows():
            for cell in row:
                if cell.font is None or cell.font.name != FONT:
                    cell.font = Font(name=FONT)
        missing = [c for c in self.schema["columns"] if c not in self.placed]
        if missing:
            raise SystemExit(f"Not every master column has a home in the workbook: {missing}")
        return self.wb

    def legend(self, ws):
        ws.sheet_properties.tabColor = "C00000"
        ws.column_dimensions["A"].width = 26
        ws.column_dimensions["B"].width = 100
        rows = [
            ("title", "CRM Onboarding Database", None),
            ("sub", "AB Capital Services FZE: every input entered when a client is onboarded through the CRM Client "
                    "Module (D:\\Abhijith Projects\\CRM\\Client Module).", None),
            ("head", "How the workbook is organised", None),
            ("row", "Clients", "One row per client (legal entity). One column per single-value field on the form, "
                               "in form order. Row 1 shows the onboarding stage of each column."),
            ("row", "Contacts, Shareholders, UBOs, Bank Accounts",
             "Fields where a client can have many entries. One row per person / account, linked by Client ID."),
            ("row", "Services, Compliance Flags", "Multi-select fields. One row per selected option."),
            ("row", "Document Checklist", "Stage 12 document statuses. One row per client per document."),
            ("row", "Documents Uploaded", "Stage 1 file uploads (Document Module register)."),
            ("row", "Field Map", "Every form field with its type, rule, sheet and column."),
            ("row", "Lists", "Dropdown options used by the data validation. Edit Client Module schema.json, not this "
                             "sheet, then rebuild."),
            ("head", "Which cells to edit", None),
            ("row", "Rows 3 onward", "Data rows. Type in the white cells under the headers."),
            ("row", "Yellow italic rows", "Example client CL000000 (fictional). Delete or overwrite it before real use."),
            ("row", "Grey cells / formulas", "Client Legal Name, Client Total %, Shareholding Check and DataBase Folder "
                                             "are formulas. Do not type in them."),
            ("head", "Header colours", None),
            ("hdr:" + NAVY, "Required", "Must be answered (where the field applies)."),
            ("hdr:" + SLATE, "Optional", "Answer if known."),
            ("hdr:" + GREY, "Auto / formula", "Filled by the Client Module or by a formula."),
            ("row", "Header comments", "Hover a header to see its stage, whether it is required, when it applies, and "
                                       "the form's hint."),
            ("head", "Data entry rules (same as the Client Module)", None),
            ("row", "Unknown", "Not Provided  (never guess)"),
            ("row", "Not applicable", "N/A  (conditional fields become N/A when their condition is false)"),
            ("row", "Needs verification", f"{VR}, or append ' ({VR})' to the value. Dropdowns warn but let you keep it."),
            ("row", "Dates", "DD/MM/YYYY"),
            ("row", "Yes/No fields", "Yes / No / Not Provided (N/A where the field does not apply)"),
            ("row", "Money", "AED amounts as numbers; the cell shows 'AED 1,500.00'"),
            ("row", "Multiple values in one cell", "Separate with '; '  (e.g. Risk Reason, Payment Gateways)"),
            ("row", "Dropdowns", "Pick from the list. Typing another value shows a warning, not a block."),
            ("head", "Sensitive data", None),
            ("row", "KYC", "Passport, Emirates ID, visa and trade licence copies are tracked by STATUS only "
                           "(Document Checklist). Do not type passport or Emirates ID numbers into this workbook."),
            ("row", "Bank accounts", "Only the last 4 digits of an IBAN. Never store online-banking credentials."),
            ("row", "System access", "Record only 'Access Required' / 'Access Received' in Accounting Notes. "
                                     "Never record passwords."),
            ("row", "Confidential", "Once it holds real clients this file is confidential client data: keep it on "
                                    "this PC and out of git (like Client Module/data/)."),
            ("head", "Source", None),
            ("row", "Schema", "Client Module/clientmodule/schema.json (134 master columns, 15 stages)"),
            ("row", "Rebuilt by", "Database Module/build_onboarding_workbook.py on "
                                  + datetime.now().strftime("%d/%m/%Y")),
        ]
        r = 1
        for kind, a, b in rows:
            if kind == "title":
                ws.cell(r, 1, a).font = Font(name=FONT, bold=True, size=16, color=NAVY)
            elif kind == "sub":
                ws.cell(r, 1, a).font = Font(name=FONT, italic=True, color="555555")
                ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
                r += 1
            elif kind == "head":
                r += 1
                c = ws.cell(r, 1, a)
                c.font = Font(name=FONT, bold=True, size=12, color="FFFFFF")
                for col in (1, 2):
                    ws.cell(r, col).fill = PatternFill("solid", fgColor=NAVY)
            else:
                c = ws.cell(r, 1, a)
                c.font = Font(name=FONT, bold=True)
                if kind.startswith("hdr:"):
                    c.fill = PatternFill("solid", fgColor=kind[4:])
                    c.font = Font(name=FONT, bold=True, color="FFFFFF")
                elif a == "Yellow italic rows":
                    c.fill = EXAMPLE_FILL
                d = ws.cell(r, 2, b)
                d.font = Font(name=FONT)
                d.alignment = Alignment(wrap_text=True, vertical="top")
                c.alignment = Alignment(vertical="top")
            r += 1
        ws.sheet_view.showGridLines = False

    # ---------- markdown field map ----------
    def write_markdown(self):
        lines = ["# Field map: Client Module onboarding form → CRM_Onboarding_Database.xlsx", "",
                 "Generated by `Database Module/build_onboarding_workbook.py` from "
                 "`Client Module/clientmodule/schema.json`. Each form field, the sheet and column it lands in, "
                 "and the `client-master.csv` column it corresponds to.", "",
                 "| Stage | Form field | Type | Req. | Sheet | Col | client-master.csv |",
                 "|---|---|---|---|---|---|---|"]
        for st, field, t, req, _w, _r, sheet, col, master in self.map_rows:
            lines.append(f"| {st} | {field} | {t} | {req} | {sheet} | {col} | {master} |")
        FIELD_MAP.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    config = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    b = Builder(schema, config)
    wb = b.build()
    wb.active = 0
    wb.calculation.fullCalcOnLoad = True  # openpyxl stores no cached results; Excel computes them on open
    wb.save(OUT)
    b.write_markdown()
    print(f"Wrote {OUT} ({len(b.map_rows)} field-map rows) and {FIELD_MAP}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
