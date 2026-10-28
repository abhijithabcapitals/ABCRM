# Document Module (`docai`)

Reusable document pipeline for CRM projects. Every uploaded document goes through:

```text
Upload
↓
Virus/File Validation
↓
OCR
↓
Document Classification
↓
Information Extraction
↓
Confidence Evaluation
↓
CRM Update
↓
Human Review if Required
↓
File Organization
```

Everything runs on this PC except the optional AI extraction, which you start yourself.

| # | Stage | Module | What it does |
|---|---|---|---|
| 1 | Upload | `pipeline.py` `receive()` | Streams the file into a staging batch (`<work_dir>/inbox/<batch>/`), enforces the size limit, computes SHA-256 and refuses the same file twice in one batch. |
| 2 | Virus / file validation | `validation.py` | Checks the allowed extension, rejects empty files, checks the file's content signature matches its extension and that TXT/CSV files are really text. ZIP, XLSX and DOCX archives are checked for unsafe paths, password protection, member count, unpacked size and extreme compression (zip bombs). It then scans with **Windows Defender** (`MpCmdRun.exe`, built into Windows). A flagged file is rejected and deleted. If no scanner is available, the file is accepted as "not scanned" and goes to human review. |
| 3 | OCR | `readers.py`, `ocr.ps1` | Reads the text layer of PDFs, Word, Excel, CSV and TXT. Scanned PDFs and photos go through **Windows OCR** (built in, no install), run with `-EncodedCommand`, so no script file is executed. |
| 4 | Classification | `classify.py` | Works out the document type (about 45 types) from the file name and document wording. It also sets the storage category (Company Documents, KYC, Bank Statements, Financials, Proposals, Secrets, Others) and the financial period, and detects credential files and Tally backups. Staff can override the type. |
| 5 | Information extraction | `extract.py` (rules), `ai.py` (optional) | Reads label/value pairs from UAE trade licences, FTA VAT and Corporate Tax certificates, bank statements, passports (machine-readable zone), Emirates IDs and visas. It reports them as **canonical fields** (`fields.py`) with the exact quoted evidence. Optional AI extraction (Claude Code CLI, Haiku) reads the text of a batch to find more fields. |
| 6 | Confidence evaluation | `confidence.py` | Fields that fail a format check (15-digit TRN, ISO date, period, option list) are dropped. Values read by OCR or AI are capped at *medium*. An AI quote that is not found in the document becomes *low*, and so do licence dates where the issue date is not before the expiry date. |
| 7 | CRM update | `crm.py` | `plan_updates()` maps fields through your `CrmAdapter` and returns proposed updates. Each one is marked **apply** (high confidence, no conflict, target empty), **review** (a person must decide, with reasons) or **already** (already recorded). It also detects conflicts between documents. |
| 8 | Human review if required | `confidence.py` `review_reasons()` | Each document gets `status` `ready` or `needs_review`, with reasons: not virus-scanned, unrecognised type, no readable text, expired, credential file, missing financial period, or low-confidence values. |
| 9 | File organization | `organize.py` | Copies each document into one or more client folders: `<parent>/<Name - ID>/<category>/[year/month/[Tally/]]ID_DocType[_Person/_MonthYear].ext`. Copies are hash-checked, identical files are never stored twice, and long Windows paths work. Each copy is recorded in `documents.csv`. Staging is removed only after every copy exists. |

Each document keeps a **stage log** (`stages`: stage, status ok/warn/fail/skipped, detail, milliseconds). After a batch is filed, the log is kept in `<work_dir>/logs/pipeline-YYYY-MM.jsonl` (no document text in it).

Credential files are stored in `Secrets`, but their text is never kept, returned, logged or sent to AI.

## Use it in a project

```python
import sys; sys.path.insert(0, r"D:\Abhijith Projects\CRM\Document Module")
from pathlib import Path
from docai import CrmAdapter, DocumentPipeline, PipelineConfig

class MyCrm(CrmAdapter):
    field_map = {"legal_name": "Company", "vat_trn": "VAT Number", "licence_expiry_date": "Licence Expiry"}
    row_map = {"bank_accounts": "Banks"}
    def checklist(self, doc_type, status):            # optional: document checklist fields
        return [("Documents", doc_type, status)]

pipe = DocumentPipeline(PipelineConfig(work_dir=Path("data")))
batch = pipe.new_batch(owner="")                      # one batch per record being edited
with open("licence.pdf", "rb") as fh:
    doc = pipe.receive(batch, "licence.pdf", fh)      # stages 1-6 + review
plan = pipe.plan([batch], current_record, MyCrm())    # stage 7: updates with apply / review / already
# ... apply the updates you accept to your record and save it ...
pipe.organize(batch, "CL000001", "ABC Trading LLC", Path(r"D:\Abhijith Projects\DataBase"),
              [["1. Accounting Clients"], ["3. VAT Clients"]])   # stage 9
```

Other calls: `set_type()` (correct the type), `set_period()` (financial / Tally period), `remove()`, `view()`, `ai_extract()`, `ai_status()`, `filed_for()`, `batches_for()`. `document_types()` lists the types.

Override `format_value` / `format_row` in the adapter to convert canonical values to your formats. For example, Client Module turns ISO dates into DD/MM/YYYY. Override `is_blank`, `same`, `row_exists` and `checklist_status` to read your record's conventions.

## Command line

```bash
python -m docai "D:\path\Trade Licence.pdf" "D:\path\scan.jpg"
```

This runs stages 1–6 and the review decision, then prints JSON. Nothing is filed and no CRM is touched. Add `--no-scan` to skip Defender, or `--type TradeLicence` to force a document type.

## AI extraction (optional)

`PipelineConfig(ai_enabled, ai_model="haiku", ai_cap_usd=0.10, ai_monthly_budget_usd=5.0)`.

AI extraction uses the Claude Code CLI already on this PC: no API key, no tools, and a neutral working folder. Only extracted **text** is sent, never credential files, and that text does leave this PC. Each run is capped with `--max-budget-usd`. Spending is logged in `ai-usage.csv`, and runs are blocked once the monthly budget is reached. AI values are never above *medium* confidence, so they always need verification.

## Requirements

Python 3.12 with `pypdf` and `openpyxl`. The tests need `pytest`. On Windows 10/11, OCR and the virus scan need no installs. It runs in the shared CRM environment `D:\Abhijith Projects\CRM\.venv` (versions pinned in `requirements.txt`).

```bash
"D:\Abhijith Projects\CRM\.venv\Scripts\python.exe" -m pytest tests
```

The tests use fictional sample documents (`tests/make_samples.py`) and temporary folders.

## Limits

- Extraction rules cover common English layouts of UAE licences and FTA certificates. Other layouts still get classified and filed, and AI extraction can fill the gaps. Arabic-only text is not read (the OCR engine is English).
- Windows Defender is the only virus scanner used. Files are scanned when uploaded, not again later.
