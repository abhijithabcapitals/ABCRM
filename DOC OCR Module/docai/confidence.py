"""Stage 6 - confidence evaluation, and stage 8 - the human-review decision.

Field confidence starts from the extractor ("high" printed label, "medium" worked out, "low" loose pattern) and is
then adjusted by fixed, explainable rules:
  - the value fails its format check (TRN 15 digits, ISO date, period, option list, yes/no)  -> dropped
  - the value was read by OCR (scan / photo), so characters may be misread                     -> at most medium
  - AI-extracted                                                                                 -> at most medium
  - the quoted evidence is not found in the document's own text                                 -> low
  - a licence/ID issue date after its expiry date                                               -> both low

Document-level review reasons (any one sends the document to human review):
  not virus-scanned · classification not confident · no readable text · document expired · credential file ·
  financial document with no period · field values that conflict with another document in the same batch.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from .fields import FIELDS

CONF = ["high", "medium", "low"]
AUTO_APPLY = "high"          # only values at this level may be applied without a person ticking them


def _cap(c: str, cap: str) -> str:
    return CONF[max(CONF.index(c if c in CONF else "low"), CONF.index(cap))]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def check_format(key: str, value: str) -> str | None:
    """Cleaned value, or None if it fails the format rules for that canonical field."""
    value = (value or "").strip()
    if not value:
        return None
    kind = FIELDS.get(key, ("", "text", None))[1]
    opts = FIELDS.get(key, ("", "text", None))[2]
    if kind == "trn":
        digits = re.sub(r"[\s-]", "", value)
        return digits if re.fullmatch(r"\d{15}", digits) else None
    if kind == "date":
        try:
            date.fromisoformat(value)
            return value
        except ValueError:
            return None
    if kind == "period":
        parts = value.split("/")
        try:
            return value if len(parts) == 2 and date.fromisoformat(parts[0]) <= date.fromisoformat(parts[1]) else None
        except ValueError:
            return None
    if kind == "yesno":
        return value if value in ("Yes", "No") else None
    if kind == "select" and opts:
        return value if value in opts else None
    if kind == "number":
        return value if re.fullmatch(r"\d+", value) else None
    return value


def evaluate_fields(fields: list[dict[str, Any]], *, text: str, method: str, engine: str) -> list[dict[str, Any]]:
    out = []
    norm_text = _norm(text)
    for f in fields:
        clean = check_format(f["key"], f.get("value", ""))
        if clean is None:
            continue
        c = f.get("confidence", "low")
        notes = []
        if method == "ocr":
            c = _cap(c, "medium")
            notes.append("read by OCR")
        if engine == "ai":
            c = _cap(c, "medium")
            notes.append("AI extracted")
            ev = _norm(f.get("evidence", ""))
            if not ev or ev not in norm_text:
                c = "low"
                notes.append("quote not found in the document")
        out.append({**f, "value": clean, "confidence": c, "notes": notes})
    by = {f["key"]: f for f in out}
    for a, b in (("licence_issue_date", "licence_expiry_date"),):
        if a in by and b in by and by[a]["value"] >= by[b]["value"]:
            for k in (a, b):
                by[k]["confidence"] = "low"
                by[k]["notes"].append("issue date is not before expiry date")
    return out


def evaluate_rows(rows: list[dict[str, Any]], *, text: str, method: str, engine: str) -> list[dict[str, Any]]:
    norm_text = _norm(text)
    out = []
    for r in rows:
        c = r.get("confidence", "low")
        if method == "ocr" or engine == "ai":
            c = _cap(c, "medium")
        if engine == "ai":
            ev = _norm(r.get("evidence", ""))
            if not ev or ev not in norm_text:
                c = "low"
        out.append({**r, "confidence": c})
    return out


def review_reasons(doc: dict[str, Any]) -> list[str]:
    """Why a person must look at this document (empty list = no review needed)."""
    reasons = []
    if doc.get("scan") != "clean":
        reasons.append(f"Virus scan: {doc.get('scan', 'not scanned')}")
    if doc.get("sensitive"):
        reasons.append("Credential file: restricted handling")
    elif doc.get("classification_confidence") == "low":
        reasons.append("Document type not recognised confidently")
    if not doc.get("sensitive") and doc.get("method") == "none":
        reasons.append("No readable text")
    ex = doc.get("extraction") or {}
    if ex.get("document_status") == "Expired":
        reasons.append("Document has expired")
    if doc.get("is_tally") and not (doc.get("year") and doc.get("month")):
        reasons.append("Tally backup: period must be confirmed")
    elif doc.get("category") == "Financials" and not doc.get("year"):
        reasons.append("Financial period not found")
    if any(f["confidence"] == "low" for f in ex.get("fields", [])):
        reasons.append("Some values are low confidence")
    return reasons


def batch_conflicts(docs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Canonical fields for which documents in one batch disagree: {key: [{value, doc_id, name}]}."""
    seen: dict[str, dict[str, dict[str, Any]]] = {}
    for d in docs:
        for src in ("extraction", "ai"):
            for f in (d.get(src) or {}).get("fields", []):
                seen.setdefault(f["key"], {}).setdefault(_norm(f["value"]), {"value": f["value"], "doc_id": d["id"], "name": d["name"]})
    return {k: list(v.values()) for k, v in seen.items() if len(v) > 1}
