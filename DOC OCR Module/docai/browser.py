"""The same reading stages for a browser (Pyodide), where no server or Windows OCR exists.

browser/readDocument.js gets the text of PDFs and images itself and passes it here. Everything else (file checks,
Word and text reading, classification, extraction, confidence) is the normal docai code. No virus scan runs here.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import confidence
from .classify import classify
from .extract import extract_fields
from .files import extension_of
from .readers import read_text
from .validation import validate

MAX_UPLOAD = 40 * 1024 * 1024
MAX_ARCHIVE = 200 * 1024 * 1024


def read_document(path: str, name: str, text: str | None = None, method: str | None = None) -> dict[str, Any]:
    """One document's result, shaped like DocumentPipeline.public(). {"error": ...} if the file fails its checks."""
    src = Path(path)
    ext = extension_of(name)
    check = validate(src, ext, src.stat().st_size, MAX_UPLOAD, MAX_ARCHIVE, scan=False)
    if not check.ok:
        return {"name": name, "error": check.error}
    if text is None:
        text, method = read_text(src, ext)
    c = classify(name, ext, text, path=src)
    if c.sensitive:
        text, method = "", "none"
        extraction = {"engine": "none", "fields": [], "rows": [], "people": [], "facts": [], "document_status": "Received",
                      "expiry_date": None, "summary": "Credential file: stored in Secrets. Contents are never shown or sent for reading."}
    else:
        extraction = extract_fields(c.doc_type, text).to_dict()
    extraction["fields"] = confidence.evaluate_fields(extraction["fields"], text=text, method=method, engine="text")
    extraction["rows"] = confidence.evaluate_rows(extraction["rows"], text=text, method=method, engine="text")
    return {"id": name, "name": name, "doc_type": c.doc_type, "label": c.label, "category": c.category,
            "classification_confidence": c.confidence, "reasons": c.reasons, "sensitive": c.sensitive,
            "method": method, "chars": len(text), "scan": check.scan, "extraction": extraction}
