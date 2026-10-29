"""Pipeline tests with temporary folders and a minimal CRM adapter (no real storage is touched)."""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent))

from docai import CrmAdapter, DocumentPipeline, PipelineConfig, PipelineError  # noqa: E402
import make_samples  # noqa: E402

SAMPLES = Path(__file__).parent / "samples"


class DemoAdapter(CrmAdapter):
    field_map = {"legal_name": "company", "vat_trn": "vat_number", "licence_expiry_date": "licence_expiry"}
    row_map = {"bank_accounts": "banks"}

    def checklist(self, doc_type, status):
        return [("documents", doc_type, status)]


@pytest.fixture()
def pipe(tmp_path):
    make_samples.main()
    return DocumentPipeline(PipelineConfig(work_dir=tmp_path / "work", ai_enabled=False)), tmp_path


def add(p, batch, name):
    with open(SAMPLES / name, "rb") as fh:
        return p.receive(batch, name, fh)


def test_all_stages_and_review(pipe):
    p, _ = pipe
    b = p.new_batch("C1")
    vat = add(p, b, "VAT Certificate.pdf")
    stages = [s["stage"] for s in vat["stages"]]
    assert stages == ["upload", "validation", "ocr", "classification", "extraction", "confidence", "review"]
    assert vat["scan"] in ("clean", "not scanned")
    f = {x["key"]: x for x in vat["extraction"]["fields"]}
    assert f["vat_trn"]["value"] == "100123456700003" and f["vat_trn"]["confidence"] == "high"
    assert f["legal_name"]["value"] == "Falcon General Trading L.L.C"
    assert "vat_registration_date" not in f  # only the effective date is printed

    scan = add(p, b, "vat_scan.png")
    assert scan["method"] == "ocr" and all(x["confidence"] != "high" for x in scan["extraction"]["fields"])

    sec = add(p, b, "portal logins.txt")
    assert sec["sensitive"] and sec["status"] == "needs_review" and sec["extraction"]["fields"] == []
    assert not list((p.inbox / b).glob(f"{sec['id']}.cache.txt"))

    with open(SAMPLES / "VAT Certificate.pdf", "rb") as fh:
        with pytest.raises(PipelineError) as e:
            p.receive(b, "again.pdf", fh)
    assert e.value.status == 409

    plan = p.plan([b], {"company": ""}, DemoAdapter())
    by = {u["target"]: u for u in plan["updates"]}
    assert by["company"]["conflict"] and by["company"]["decision"] == "review"   # scan says "Falcon Trading LLC"
    assert by["vat_number"]["decision"] == "apply"                             # high (PDF) + medium (OCR), same value
    assert "documents" in by and by["documents"]["items"]["VATCertificate"] == "Received"
    assert p.view(b)["conflicts"]["legal_name"]


def test_existing_value_needs_review(pipe):
    p, _ = pipe
    b = p.new_batch()
    add(p, b, "VAT Certificate.pdf")
    by = {u["target"]: u for u in p.plan([b], {"vat_number": "100999999999999"}, DemoAdapter())["updates"]}
    assert by["vat_number"]["decision"] == "review" and "Record already holds a different value" in by["vat_number"]["reasons"]
    by = {u["target"]: u for u in p.plan([b], {"vat_number": "100123456700003"}, DemoAdapter())["updates"]}
    assert by["vat_number"]["decision"] == "already"


def test_validation_rejects(pipe):
    p, _ = pipe
    b = p.new_batch()
    with pytest.raises(PipelineError):
        p.receive(b, "fake.pdf", io.BytesIO(b"MZ this is not a pdf"))
    with pytest.raises(PipelineError):
        p.receive(b, "tool.exe", io.BytesIO(b"MZ"))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../escape.txt", "x")
    buf.seek(0)
    with pytest.raises(PipelineError) as e:
        p.receive(b, "bad.zip", buf)
    assert "unsafe" in e.value.message
    assert p.view(b)["docs"] == []


def test_organize_and_register(pipe):
    p, tmp = pipe
    root = tmp / "storage"
    root.mkdir()
    b = p.new_batch()
    add(p, b, "Trade License - Falcon.pdf")
    add(p, b, "ENBD statement March 2026.pdf")
    res = p.organize(b, "CL000007", "Falcon General Trading L.L.C", root, [["1. Accounting Clients"], ["3. VAT Clients"]])
    assert len(res["filed"]) == 2 and not res["held"]
    for svc in ("1. Accounting Clients", "3. VAT Clients"):
        d = root / svc / "Falcon General Trading LLC - CL000007"
        assert (d / "Company Documents" / "CL000007_TradeLicence.pdf").exists()
        assert (d / "Bank Statements" / "CL000007_BankStatement_March2026.pdf").exists()
        assert (d / "Secrets" / "_SENSITIVE - READ ME.txt").exists()
    assert len(p.filed_for("CL000007")) == 2
    assert not (p.inbox / b).exists()
    assert list((p.cfg.work_dir / "logs").glob("pipeline-*.jsonl"))


def test_type_override_and_no_destination(pipe):
    p, tmp = pipe
    b = p.new_batch()
    d = add(p, b, "VAT Certificate.pdf")
    d2 = p.set_type(b, d["id"], "Other")
    assert d2["doc_type"] == "Other" and d2["extraction"]["fields"] == []
    res = p.organize(b, "CL1", "X", tmp, [])
    assert res["held"] and not res["filed"]
