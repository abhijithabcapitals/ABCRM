"""Document AI pipeline. Every uploaded document goes through:

    1 Upload                    receive()          streamed to a staging batch, size-limited, SHA-256, duplicate check
    2 Virus / file validation   validation.py      extension, signature, archive safety, Windows Defender scan
    3 OCR                       readers.py         PDF/Word/Excel text, Windows OCR for scans and photos
    4 Document classification   classify.py        type, storage category, period, credential detection
    5 Information extraction    extract.py, ai.py  canonical fields (fields.py); AI only on request
    6 Confidence evaluation     confidence.py      format checks, OCR/AI caps, evidence check
    7 CRM update                crm.py             plan_updates() through the project's CrmAdapter
    8 Human review if required  confidence.py      review reasons per document, review decisions per update
    9 File organization         organize.py        verified copies into the client folders + register

Each document keeps a stage log (`stages`: stage, status ok|warn|fail|skipped, detail, ms) for audit. Staging
lives under <work_dir>/inbox/<batch>/; staged copies are removed once every filed copy exists. Credential files
are stored but their text is never kept, returned, logged or sent to AI.
"""
from __future__ import annotations

import csv
import json
import re
import secrets
import shutil
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO

from . import ai, confidence, organize
from .classify import FINANCIALS, RULES, classify, detect_period
from .crm import CrmAdapter, plan_updates
from .extract import extract_fields
from .files import extension_of, safe_join, sha256_file
from .readers import read_text
from .validation import validate

BATCH_RE = re.compile(r"^[a-f0-9]{16}$")
DOC_RE = re.compile(r"^[a-f0-9]{12}$")
DOC_LABELS = {r[0]: r[2] for r in RULES} | {"Credentials": "Credentials", "TallyBackup": "Tally Backup", "Other": "Other Document"}
REGISTER_COLS = ["Timestamp", "Owner ID", "Document Type", "Category", "Original Name", "Stored As", "SHA256", "Folders"]
DUBAI = timezone(timedelta(hours=4))


class PipelineError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


@dataclass
class PipelineConfig:
    work_dir: Path                        # inbox, register, AI ledger
    max_upload_mb: int = 40
    max_archive_mb: int = 500
    virus_scan: bool = True
    ai_enabled: bool = True
    ai_model: str = "haiku"
    ai_cap_usd: float = 0.10
    ai_monthly_budget_usd: float = 5.0
    extra: dict[str, Any] = field(default_factory=dict)


def now() -> datetime:
    return datetime.now(DUBAI)


def document_types() -> list[dict[str, str]]:
    return [{"id": r[0], "label": r[2], "category": r[1]} for r in RULES] + [
        {"id": "Other", "label": "Other Document", "category": "Others"}]


class DocumentPipeline:
    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self.inbox = cfg.work_dir / "inbox"
        self.register = cfg.work_dir / "documents.csv"
        self.ledger = cfg.work_dir / "ai-usage.csv"
        self.lock = threading.RLock()
        self.inbox.mkdir(parents=True, exist_ok=True)

    # ---------- batches ----------
    def _dir(self, batch: str) -> Path:
        if not BATCH_RE.match(batch or ""):
            raise PipelineError(400, "Invalid batch.")
        return safe_join(self.inbox, batch)

    def _meta(self, batch: str) -> dict[str, Any]:
        p = self._dir(batch) / "meta.json"
        if not p.exists():
            raise PipelineError(404, "Upload batch not found.")
        return json.loads(p.read_text(encoding="utf-8"))

    def _save(self, batch: str, meta: dict[str, Any]) -> None:
        p = self._dir(batch) / "meta.json"
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(p)

    @staticmethod
    def _doc(meta: dict[str, Any], doc_id: str) -> dict[str, Any]:
        if not DOC_RE.match(doc_id or ""):
            raise PipelineError(400, "Invalid document.")
        d = next((x for x in meta["docs"] if x["id"] == doc_id), None)
        if not d:
            raise PipelineError(404, "Document not found in this batch.")
        return d

    def new_batch(self, owner: str = "") -> str:
        batch = secrets.token_hex(8)
        self._dir(batch).mkdir(parents=True)
        self._save(batch, {"batch": batch, "owner": owner, "created": now().isoformat(), "docs": []})
        return batch

    def set_owner(self, batch: str, owner: str) -> None:
        with self.lock:
            meta = self._meta(batch)
            meta["owner"] = owner
            self._save(batch, meta)

    def batches_for(self, owner: str) -> list[dict[str, Any]]:
        out = []
        for p in self.inbox.glob("*/meta.json"):
            meta = json.loads(p.read_text(encoding="utf-8"))
            if owner and meta.get("owner") == owner:
                out.append(meta)
        return out

    def view(self, batch: str) -> dict[str, Any]:
        meta = self._meta(batch)
        docs = meta["docs"]
        conflicts = confidence.batch_conflicts([d for d in docs if not d.get("filed")])
        return {"batch": batch, "owner": meta.get("owner", ""), "docs": [self.public(d) for d in docs],
                "conflicts": conflicts}

    @staticmethod
    def public(d: dict[str, Any]) -> dict[str, Any]:
        keys = ("id", "name", "size", "doc_type", "label", "category", "classification_confidence", "reasons",
                "sensitive", "is_tally", "method", "chars", "year", "month", "scan", "scan_detail", "status", "review",
                "filed", "stored_as", "stages", "extraction", "ai")
        return {k: d.get(k) for k in keys}

    # ---------- stages 1-6 (+8) ----------
    def _stage(self, d: dict[str, Any], stage: str, status: str, detail: str, t0: float) -> None:
        d.setdefault("stages", []).append({"stage": stage, "status": status, "detail": detail[:200],
                                           "ms": int((time.perf_counter() - t0) * 1000), "at": now().isoformat(timespec="seconds")})

    def receive(self, batch: str, name: str, stream: BinaryIO) -> dict[str, Any]:
        """Stages 1-2, then 3-6 and the review decision. Rejected files are not kept."""
        d: dict[str, Any] = {"id": secrets.token_hex(6), "name": Path(name).name[:180], "ext": extension_of(name),
                             "filed": False}
        t0 = time.perf_counter()
        folder = self._dir(batch)
        self._meta(batch)
        tmp = folder / f"{d['id']}.upload"
        limit = (self.cfg.max_archive_mb if d["ext"] == ".zip" else self.cfg.max_upload_mb) * 1024 * 1024
        size = 0
        with open(tmp, "wb") as out:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    break
                out.write(chunk)
        d["size"] = size
        d["sha256"] = sha256_file(tmp)
        with self.lock:
            if any(x["sha256"] == d["sha256"] for x in self._meta(batch)["docs"]):
                tmp.unlink(missing_ok=True)
                raise PipelineError(409, f"{d['name']} is already in this upload.")
        self._stage(d, "upload", "ok", f"{size} bytes", t0)

        t0 = time.perf_counter()
        v = validate(tmp, d["ext"], size, self.cfg.max_upload_mb * 1024 * 1024, self.cfg.max_archive_mb * 1024 * 1024,
                     scan=self.cfg.virus_scan)
        d["scan"], d["scan_detail"] = v.scan, v.scan_detail
        if not v.ok:
            tmp.unlink(missing_ok=True)
            raise PipelineError(400, f"{d['name']}: {v.error}")
        self._stage(d, "validation", "ok" if v.scan == "clean" else "warn", f"file checks passed; virus scan: {v.scan}", t0)
        tmp.rename(folder / f"{d['id']}{d['ext']}")
        d["status"] = "validated"
        with self.lock:
            meta = self._meta(batch)
            meta["docs"].append(d)
            self._save(batch, meta)
        return self.process(batch, d["id"])

    def process(self, batch: str, doc_id: str, forced_type: str | None = None) -> dict[str, Any]:
        """Stages 3-6 and 8 for one document (re-run when staff correct the type)."""
        folder = self._dir(batch)
        with self.lock:
            d = dict(self._doc(self._meta(batch), doc_id))
        src = folder / f"{doc_id}{d['ext']}"
        cache = folder / f"{doc_id}.cache.txt"
        d["stages"] = [s for s in d.get("stages", []) if s["stage"] in ("upload", "validation")]

        t0 = time.perf_counter()
        if d.get("sensitive"):
            text, method = "", "none"
            self._stage(d, "ocr", "skipped", "credential file: contents not read", t0)
        elif cache.exists():
            text, method = cache.read_text(encoding="utf-8"), d.get("method", "text-layer")
            self._stage(d, "ocr", "ok", f"cached text ({method})", t0)
        else:
            text, method = read_text(src, d["ext"])
            self._stage(d, "ocr", "ok" if text.strip() else "warn",
                        f"{ {'text-layer': 'file text', 'ocr': 'Windows OCR', 'none': 'no text'}.get(method, method)}, {len(text)} characters", t0)

        t0 = time.perf_counter()
        c = classify(d["name"], d["ext"], text, path=src)
        if forced_type and forced_type in DOC_LABELS and forced_type != "Credentials" and not c.sensitive:
            rule = next((r for r in RULES if r[0] == forced_type), None)
            c.doc_type, c.label, c.confidence, c.reasons = forced_type, DOC_LABELS[forced_type], "high", ["set by staff"]
            c.category = rule[1] if rule else "Others"
            if c.category == FINANCIALS and not c.year:
                c.year, c.month, c.period_source = detect_period(d["name"], text)
        self._stage(d, "classification", "ok" if c.confidence != "low" else "warn",
                    f"{c.label} ({c.confidence}; {', '.join(c.reasons)})", t0)

        t0 = time.perf_counter()
        if c.sensitive:
            cache.unlink(missing_ok=True)
            text, method = "", "none"
            extraction = {"engine": "none", "fields": [], "rows": [], "people": [], "facts": [], "document_status": "Received",
                          "expiry_date": None, "summary": "Credential file: stored in Secrets. Contents are never shown or sent for reading."}
            self._stage(d, "extraction", "skipped", "credential file", t0)
        else:
            if text and not cache.exists():
                cache.write_text(text, encoding="utf-8")
            extraction = extract_fields(c.doc_type, text).to_dict()
            self._stage(d, "extraction", "ok", f"{len(extraction['fields'])} fields, {len(extraction['rows'])} list entries", t0)

        t0 = time.perf_counter()
        raw = len(extraction["fields"])
        extraction["fields"] = confidence.evaluate_fields(extraction["fields"], text=text, method=method, engine="text")
        extraction["rows"] = confidence.evaluate_rows(extraction["rows"], text=text, method=method, engine="text")
        if d.get("ai"):
            d["ai"]["fields"] = confidence.evaluate_fields(d["ai"]["fields"], text=text, method=method, engine="ai")
        levels = [f["confidence"] for f in extraction["fields"]]
        self._stage(d, "confidence", "ok", f"high {levels.count('high')}, medium {levels.count('medium')}, "
                    f"low {levels.count('low')}, dropped {raw - len(levels)}", t0)

        d.update({"doc_type": c.doc_type, "label": c.label, "category": c.category, "classification_confidence": c.confidence,
                  "reasons": c.reasons, "sensitive": c.sensitive, "is_tally": c.is_tally, "method": method, "chars": len(text),
                  "extraction": extraction, "forced_type": forced_type or d.get("forced_type")})
        if not d.get("period_set"):
            d["year"], d["month"] = c.year, c.month
        self._review(d)
        with self.lock:
            meta = self._meta(batch)
            meta["docs"] = [d if x["id"] == doc_id else x for x in meta["docs"]]
            self._save(batch, meta)
        return self.public(d)

    def _review(self, d: dict[str, Any]) -> None:
        t0 = time.perf_counter()
        d["review"] = confidence.review_reasons(d)
        d["status"] = "needs_review" if d["review"] else "ready"
        d["stages"] = [s for s in d["stages"] if s["stage"] != "review"]
        self._stage(d, "review", "warn" if d["review"] else "ok", "; ".join(d["review"]) or "no review needed", t0)

    def set_type(self, batch: str, doc_id: str, doc_type: str) -> dict[str, Any]:
        if doc_type not in DOC_LABELS or doc_type == "Credentials":
            raise PipelineError(400, "Unknown document type.")
        return self.process(batch, doc_id, forced_type=doc_type)

    def set_period(self, batch: str, doc_id: str, year: int, month: int) -> dict[str, Any]:
        if not (2000 <= year <= now().year + 1 and 1 <= month <= 12):
            raise PipelineError(400, "Enter a valid year and month.")
        with self.lock:
            meta = self._meta(batch)
            d = self._doc(meta, doc_id)
            d["year"], d["month"], d["period_set"] = year, month, True
            self._review(d)
            self._save(batch, meta)
            return self.public(d)

    def remove(self, batch: str, doc_id: str) -> None:
        with self.lock:
            meta = self._meta(batch)
            if self._doc(meta, doc_id).get("filed"):
                raise PipelineError(409, "This document is already filed.")
            for p in self._dir(batch).glob(f"{doc_id}*"):
                p.unlink(missing_ok=True)
            meta["docs"] = [x for x in meta["docs"] if x["id"] != doc_id]
            self._save(batch, meta)

    # ---------- optional AI extraction (stage 5, on request) ----------
    def ai_status(self) -> dict[str, Any]:
        exe = ai.find_claude()
        return {"enabled": self.cfg.ai_enabled and bool(exe), "cli": bool(exe), "spentThisMonth": round(ai.month_spend(self.ledger), 4),
                "monthlyBudget": self.cfg.ai_monthly_budget_usd, "capPerCall": self.cfg.ai_cap_usd, "model": self.cfg.ai_model}

    def ai_extract(self, batch: str) -> dict[str, Any]:
        if not self.cfg.ai_enabled:
            raise PipelineError(400, "AI extraction is switched off.")
        meta = self._meta(batch)
        folder = self._dir(batch)
        docs = [{"id": d["id"], "name": d["name"], "doc_type": d.get("doc_type", "Other"),
                 "text": (folder / f"{d['id']}.cache.txt").read_text(encoding="utf-8")}
                for d in meta["docs"] if not d.get("sensitive") and not d.get("filed") and (folder / f"{d['id']}.cache.txt").exists()]
        if not docs:
            raise PipelineError(400, "No readable document text to send. Credential files are never sent.")
        t0 = time.perf_counter()
        try:
            res = ai.ai_extract(docs, model=self.cfg.ai_model, cap_usd=self.cfg.ai_cap_usd,
                                monthly_budget=self.cfg.ai_monthly_budget_usd, ledger=self.ledger, ref=batch)
        except ai.AiError as exc:
            raise PipelineError(400, str(exc)) from exc
        texts = {x["id"]: x["text"] for x in docs}
        with self.lock:
            meta = self._meta(batch)
            for d in meta["docs"]:
                if d["id"] in res["per_doc"]:
                    a = res["per_doc"][d["id"]]
                    a["fields"] = confidence.evaluate_fields(a["fields"], text=texts[d["id"]], method=d.get("method", ""), engine="ai")
                    a["rows"] = confidence.evaluate_rows(a["rows"], text=texts[d["id"]], method=d.get("method", ""), engine="ai")
                    d["ai"] = a
                    self._stage(d, "extraction", "ok", f"AI: {len(a['fields'])} fields, {len(a['rows'])} list entries", t0)
                    self._review(d)
            self._save(batch, meta)
        return {**self.view(batch), "cost": res["cost"]}

    # ---------- stage 7 ----------
    def plan(self, batches: list[str], current: dict[str, str], adapter: CrmAdapter) -> dict[str, Any]:
        docs = []
        for b in batches:
            try:
                docs += [d for d in self._meta(b)["docs"] if not d.get("filed")]
            except PipelineError:
                continue
        return plan_updates(docs, current, adapter)

    # ---------- stage 9 ----------
    def organize(self, batch: str, owner_id: str, owner_name: str, root: Path, parents: list[list[str]]) -> dict[str, Any]:
        """Copy every unfiled document into `root/<parent>/<Name - ID>/...` for each parent folder path."""
        with self.lock:
            meta = self._meta(batch)
            meta["owner"] = owner_id
            self._save(batch, meta)
            pending = [d for d in meta["docs"] if not d.get("filed")]
            if not pending:
                return {"filed": [], "held": [], "folders": []}
            if not parents:
                return {"filed": [], "folders": [], "held": [{"name": d["name"], "reason": "No destination folder yet: "
                        "kept in the inbox and filed on the next save."} for d in pending]}
            if not root.is_dir():
                raise PipelineError(500, f"Storage folder not found: {root}")
            dirs = [organize.ensure_client_folder(root, p, owner_id, owner_name) for p in parents]
            folder = self._dir(batch)
            filed, held = [], []
            for d in pending:
                t0 = time.perf_counter()
                if d.get("is_tally") and not (d.get("year") and d.get("month")):
                    held.append({"name": d["name"], "reason": "Tally backup: set its year and month before it can be filed."})
                    continue
                stored = organize.file_document(folder / f"{d['id']}{d['ext']}", d, owner_id, dirs)
                d["filed"], d["stored_as"] = True, stored[0].name
                self._stage(d, "organization", "ok", f"{len(stored)} cop{'y' if len(stored) == 1 else 'ies'}: {stored[0].name}", t0)
                self._append_register(owner_id, d, stored)
                filed.append({"name": d["name"], "storedAs": d["stored_as"], "category": d.get("category"), "copies": len(stored)})
            self._save(batch, meta)
            for d in meta["docs"]:
                if d.get("filed"):
                    for p in folder.glob(f"{d['id']}*"):
                        p.unlink(missing_ok=True)
            if all(d.get("filed") for d in meta["docs"]):
                self._write_stage_log(meta)
                shutil.rmtree(folder, ignore_errors=True)
            return {"filed": filed, "held": held, "folders": [str(x) for x in dirs]}

    def _write_stage_log(self, meta: dict[str, Any]) -> None:
        """Keep the per-document stage log after the batch folder is removed (no document text in it)."""
        log = self.cfg.work_dir / "logs" / f"pipeline-{now():%Y-%m}.jsonl"
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "a", encoding="utf-8") as fh:
            for d in meta["docs"]:
                fh.write(json.dumps({"batch": meta["batch"], "owner": meta.get("owner"), "doc": d["id"], "name": d["name"],
                                     "type": d.get("doc_type"), "sha256": d["sha256"], "stages": d.get("stages", [])},
                                    ensure_ascii=False) + "\n")

    def _append_register(self, owner_id: str, d: dict[str, Any], stored: list[Path]) -> None:
        new = not self.register.exists()
        with open(self.register, "a", encoding="utf-8-sig" if new else "utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=REGISTER_COLS, quoting=csv.QUOTE_ALL)
            if new:
                w.writeheader()
            w.writerow({"Timestamp": now().strftime("%d/%m/%Y %H:%M:%S"), "Owner ID": owner_id,
                        "Document Type": d.get("label") or d.get("doc_type"), "Category": d.get("category"),
                        "Original Name": d["name"], "Stored As": d.get("stored_as", ""), "SHA256": d["sha256"],
                        "Folders": "; ".join(str(p) for p in stored)})

    def filed_for(self, owner_id: str) -> list[dict[str, str]]:
        if not self.register.exists():
            return []
        with open(self.register, encoding="utf-8-sig", newline="") as fh:
            return [r for r in csv.DictReader(fh) if r.get("Owner ID") == owner_id]
