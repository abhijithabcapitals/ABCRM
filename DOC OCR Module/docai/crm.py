"""Stage 7 - CRM update planning.

The pipeline never writes to a CRM itself. A project supplies a CrmAdapter that maps canonical fields (fields.py)
onto its own record, and plan_updates() turns a batch of processed documents into a list of proposed updates,
each with a decision:

    apply    - safe to apply without a person ticking it: high confidence, no conflict, the target is empty
    review   - a person must decide (lower confidence, conflicting documents, target already holds another value,
               or the document itself needs review)
    already  - the record already holds this value

Projects are free to apply "apply" updates automatically or to show everything for confirmation (Client Module
pre-ticks "apply" and leaves "review" unticked).
"""
from __future__ import annotations

import re
from typing import Any

from .confidence import AUTO_APPLY, CONF
from .fields import ROW_KEY


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


class CrmAdapter:
    """Override what you need. Defaults: canonical keys are the CRM field names and values pass through."""

    field_map: dict[str, str] = {}
    row_map: dict[str, str] = {}

    def field_target(self, key: str) -> str | None:
        return self.field_map.get(key, key if not self.field_map else None)

    def format_value(self, key: str, value: str) -> str:
        return value

    def row_target(self, list_name: str) -> str | None:
        return self.row_map.get(list_name, list_name if not self.row_map else None)

    def format_row(self, list_name: str, item: dict[str, str]) -> dict[str, str]:
        return item

    def checklist(self, doc_type: str, status: str) -> list[tuple[str, str, str]]:
        """(target field, checklist item, status) for an uploaded document type."""
        return []

    def is_blank(self, target: str, current: str) -> bool:
        return not (current or "").strip()

    def same(self, target: str, current: str, value: str) -> bool:
        return _norm(current) == _norm(value)

    def row_exists(self, target: str, current: str, item: dict[str, str]) -> bool:
        key = next(iter(item.values()), "")
        return bool(key) and _norm(key) in _norm(current)

    def checklist_status(self, target: str, current: str, item: str) -> str:
        return ""


def _source(d: dict[str, Any], f: dict[str, Any], engine: str) -> dict[str, Any]:
    return {"docId": d["id"], "file": d["name"], "engine": engine, "evidence": f.get("evidence", ""),
            "confidence": f.get("confidence"), "notes": f.get("notes", [])}


def plan_updates(docs: list[dict[str, Any]], current: dict[str, str], adapter: CrmAdapter) -> dict[str, Any]:
    scalar: dict[str, dict[str, Any]] = {}
    rows: dict[str, dict[str, Any]] = {}
    checks: dict[str, dict[str, Any]] = {}
    people: list[dict[str, Any]] = []
    for d in docs:
        doc_review = bool(d.get("review"))
        for src, engine in (("extraction", "local"), ("ai", "ai")):
            ex = d.get(src) or {}
            for f in ex.get("fields", []):
                target = adapter.field_target(f["key"])
                if not target:
                    continue
                value = adapter.format_value(f["key"], f["value"])
                g = scalar.setdefault(target, {"kind": "field", "target": target, "key": f["key"], "options": {}})
                o = g["options"].setdefault(_norm(value), {"value": value, "confidence": f["confidence"], "sources": [],
                                                           "docReview": False})
                o["sources"].append(_source(d, f, engine))
                o["docReview"] = o["docReview"] or doc_review
                if CONF.index(f["confidence"]) < CONF.index(o["confidence"]):
                    o["confidence"], o["value"] = f["confidence"], value
            for r in ex.get("rows", []):
                target = adapter.row_target(r["list"])
                if not target:
                    continue
                item = adapter.format_row(r["list"], r["item"])
                key = _norm(r["item"].get(ROW_KEY.get(r["list"], ""), "")) + _norm(r["item"].get("iban_last4", ""))
                if not key:
                    continue
                u = rows.setdefault(f"{target}:{key}", {"kind": "row", "target": target, "list": r["list"], "item": item,
                                                        "confidence": r["confidence"], "sources": []})
                u["sources"].append(_source(d, r, engine))
            for p in ex.get("people", []):
                if not any(_norm(x["name"]) == _norm(p["name"]) for x in people):
                    people.append({**p, "file": d["name"]})
        if d.get("doc_type") and not d.get("sensitive"):
            status = (d.get("extraction") or {}).get("document_status", "Received")
            for target, item, st in adapter.checklist(d["doc_type"], status):
                c = checks.setdefault(target, {"kind": "checklist", "target": target, "items": {}})
                if c["items"].get(item) != "Expired":
                    c["items"][item] = st

    updates = []
    for target, g in scalar.items():
        opts = sorted(g["options"].values(), key=lambda o: CONF.index(o["confidence"]))
        cur = current.get(target, "")
        conflict = len(opts) > 1
        reasons = []
        if any(adapter.same(target, cur, o["value"]) for o in opts) and not conflict:
            decision = "already"
        else:
            best = opts[0]
            if conflict:
                reasons.append("Documents disagree")
            if not adapter.is_blank(target, cur):
                reasons.append("Record already holds a different value")
            if best["confidence"] != AUTO_APPLY:
                reasons.append(f"{best['confidence'].capitalize()} confidence")
            if best["docReview"]:
                reasons.append("Source document needs review")
            decision = "review" if reasons else "apply"
        updates.append({**g, "options": opts, "current": cur, "conflict": conflict, "decision": decision, "reasons": reasons})
    for u in rows.values():
        exists = adapter.row_exists(u["target"], current.get(u["target"], ""), u["item"])
        reasons = [] if u["confidence"] == AUTO_APPLY else [f"{u['confidence'].capitalize()} confidence"]
        updates.append({**u, "decision": "already" if exists else "review" if reasons else "apply", "reasons": reasons})
    for c in checks.values():
        todo = {i: s for i, s in c["items"].items()
                if adapter.checklist_status(c["target"], current.get(c["target"], ""), i) in ("", "Missing")}
        updates.append({**c, "decision": "apply" if todo else "already", "items": todo or c["items"],
                        "reasons": ["Document has expired"] if "Expired" in c["items"].values() else []})
    return {"updates": updates, "people": people}
