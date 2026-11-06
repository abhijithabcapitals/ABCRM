"""End-to-end tests with temporary folders (never the real DataBase or master files)."""
from __future__ import annotations

import csv
import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
DOC_TESTS = ROOT.parent / "DOC OCR Module" / "tests"   # shared fictional samples
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(DOC_TESTS))

from clientmodule.api import create_app  # noqa: E402
from clientmodule.config import Settings  # noqa: E402
from clientmodule.master import NP, NA, VR_SUFFIX  # noqa: E402
import make_samples  # noqa: E402

SAMPLES = DOC_TESTS / "samples"


@pytest.fixture()
def env(tmp_path):
    make_samples.main()
    storage = tmp_path / "DataBase"
    storage.mkdir()
    s = Settings.load(storage_root=storage, data_dir=tmp_path / "data", ai_enabled=False)
    s.data_dir.mkdir(parents=True, exist_ok=True)
    app = create_app(s)
    return TestClient(app), s, storage


def test_pages_carry_branding(env):
    c, _, _ = env
    logo = c.get("/brand/logo.webp")
    assert logo.status_code == 200 and logo.headers["content-type"] == "image/webp"
    for page in ("/", "/tax"):
        html = c.get(page).text
        assert "/brand/logo.webp" in html
        assert "All Rights Reserved, AB Capital Services FZE Dubai, UAE" in html


def upload(c, batch, name):
    with open(SAMPLES / name, "rb") as fh:
        r = c.post(f"/api/batches/{batch}/files", files={"file": (name, fh)})
    assert r.status_code == 200, r.text
    return r.json()


def field(f, key):
    return next((s["value"] for s in f["extraction"]["fields"] if s["key"] == key), None)


def plan(c, batch, record=None):
    return {u["target"]: u for u in c.post(f"/api/batches/{batch}/plan", json={"record": record or {}}).json()["updates"]}


def test_documents_fill_and_file(env):
    c, s, storage = env
    batch = c.post("/api/batches", json={}).json()["batch"]
    lic = upload(c, batch, "Trade License - Falcon.pdf")
    vat = upload(c, batch, "VAT Certificate.pdf")
    ct = upload(c, batch, "CT Registration Certificate.pdf")
    bank = upload(c, batch, "ENBD statement March 2026.pdf")
    sec = upload(c, batch, "portal logins.txt")

    assert lic["doc_type"] == "TradeLicence" and field(lic, "licence_number") == "1234567"
    assert vat["doc_type"] == "VATCertificate" and field(vat, "vat_trn") == "100123456700003"
    assert ct["doc_type"] == "CTCertificate" and bank["doc_type"] == "BankStatement"
    assert sec["sensitive"] and sec["category"] == "Secrets" and not sec["extraction"]["fields"]
    assert not list((s.data_dir / "inbox" / batch).glob(f"{sec['id']}.cache.txt"))  # credential text never kept

    # Stage 7: the plan maps canonical fields onto the 134 columns in Client Master formats.
    p = plan(c, batch)
    assert p["Trade License Number"]["decision"] == "apply" and p["Trade License Number"]["options"][0]["value"] == "1234567"
    assert p["License Expiry Date"]["options"][0]["value"] == "14/01/2027"
    assert p["Secondary Activities"]["options"][0]["value"] == "Import and Export of Foodstuff; Logistics Services"
    assert p["TRN"]["options"][0]["value"] == "100123456700003"
    assert p["CT Registration Date"]["options"][0]["value"] == "01/01/2024"
    assert "VAT Registration Date" not in p  # only the effective date is printed
    assert p["Jurisdiction"]["decision"] == "review"  # worked out from the authority, not printed
    assert p["Bank Accounts"]["item"] == {"Bank": "Emirates NBD", "Currency": "AED", "IBAN last 4": "3456"}
    assert p["Tax Documents Status"]["items"] == {"VAT Certificate": "Received", "CT Certificate": "Received"}
    assert plan(c, batch, {"TRN": "100123456700003"})["TRN"]["decision"] == "already"

    # Duplicate upload of the same content is refused.
    with open(SAMPLES / "VAT Certificate.pdf", "rb") as fh:
        assert c.post(f"/api/batches/{batch}/files", files={"file": ("copy.pdf", fh)}).status_code == 409

    record = {"Client Legal Name": "Falcon General Trading L.L.C", "Trade License Number": "1234567",
              "TRN": "100123456700003", "VAT Registered": "Yes", "Entity Type": "LLC" + VR_SUFFIX,
              "Services Provided": "Bookkeeping; VAT Return Filing"}
    assert c.post("/api/save", json={"record": record, "batch": batch}).status_code == 409  # not confirmed
    r = c.post("/api/save", json={"record": record, "batch": batch, "confirmed": True}).json()
    assert r["ok"] and r["id"] == "CL000001"
    fl = r["filing"]
    assert len(fl["filed"]) == 5 and not fl["held"] and not fl["errors"]
    acc = storage / "1. Accounting Clients" / "Falcon General Trading LLC - CL000001"
    vatdir = storage / "3. VAT Clients" / "Falcon General Trading LLC - CL000001"
    for d in (acc, vatdir):
        assert sorted(p.name for p in d.iterdir()) == sorted(["Bank Statements", "Company Documents", "KYC", "Proposals",
                                                              "Financials", "Secrets", "Others"])
        assert (d / "Company Documents" / "CL000001_TradeLicence.pdf").exists()
        assert (d / "Company Documents" / "CL000001_VATCertificate.pdf").exists()
        assert (d / "Bank Statements" / "CL000001_BankStatement_March2026.pdf").exists()
        assert (d / "Secrets" / "CL000001_Credentials.txt").exists()
    assert not (s.data_dir / "inbox" / batch).exists()  # staging removed after every copy exists

    docs = c.get("/api/clients/CL000001").json()["documents"]
    assert len(docs["filed"]) == 5 and not docs["waiting"]
    rec = c.get("/api/clients/CL000001").json()["record"]
    assert rec["Entity Type"].endswith(VR_SUFFIX) and "Verify: Entity Type" in rec["Items Requiring Review"]


def test_master_rules(env):
    c, s, _ = env
    base = {"Client Legal Name": "Oasis Consulting FZE", "Trade License Number": "FZ-998", "Payroll Applicable": "No"}
    r = c.post("/api/save", json={"record": base, "confirmed": True}).json()
    assert r["id"] == "CL000001"
    rec = r["result"]["record"]
    assert rec["Employee Count"] == NA and rec["General Email"] == NP and rec["TRN"] == NA and len(rec) == 134
    # Duplicate by licence number (different spelling of the name) stops a new save.
    dup = c.post("/api/save", json={"record": {"Client Legal Name": "OASIS CONSULTING F.Z.E", "Trade License Number": "fz998"},
                                    "confirmed": True})
    assert dup.status_code == 409 and dup.json()["duplicates"][0]["id"] == "CL000001"
    # Update: blank values keep stored data; only the changed field is logged.
    up = c.post("/api/save", json={"record": {"Trade License Number": "", "Payment Terms": "30 days"},
                                   "clientId": "CL000001", "confirmed": True}).json()
    assert up["ok"] and [x["field"] for x in up["result"]["changes"] if x["field"] not in ("Onboarding Completion %", "Missing Information")] == ["Payment Terms"]
    assert c.get("/api/clients/CL000001").json()["record"]["Trade License Number"] == "FZ-998"
    # High risk needs a reason.
    bad = c.post("/api/preview", json={"record": {"Client Legal Name": "X", "Risk Level": "High"}}).json()
    assert bad["errors"]
    # IDs are never reused, even after the master is emptied.
    with open(s.data_dir / "client-master.csv", encoding="utf-8-sig") as fh:
        header = next(csv.reader(fh))
    (s.data_dir / "client-master.csv").write_text(",".join(f'"{h}"' for h in header) + "\n", encoding="utf-8-sig")
    assert c.post("/api/save", json={"record": {"Client Legal Name": "New Co LLC"}, "confirmed": True}).json()["id"] == "CL000002"
    assert c.post("/api/export", json={}).json()["ok"]


def test_no_service_keeps_documents_in_inbox(env):
    c, s, storage = env
    batch = c.post("/api/batches", json={}).json()["batch"]
    upload(c, batch, "Trade License - Falcon.pdf")
    r = c.post("/api/save", json={"record": {"Client Legal Name": "Falcon General Trading LLC"}, "batch": batch,
                                  "confirmed": True}).json()
    assert r["ok"] and r["filing"]["held"] and not r["filing"]["filed"]
    assert c.get(f"/api/clients/{r['id']}").json()["documents"]["waiting"]
    # Selecting a service on a later save files the waiting documents.
    r2 = c.post("/api/save", json={"record": {"Services Provided": "Audit"}, "clientId": r["id"], "confirmed": True}).json()
    assert r2["filing"]["filed"] and (storage / "4. Audit Clients" / f"Falcon General Trading LLC - {r['id']}").is_dir()


def test_ocr_scan_and_type_override(env):
    c, s, _ = env
    scan = SAMPLES / "vat_scan.png"
    if not scan.exists():
        pytest.skip("scan sample not generated")
    batch = c.post("/api/batches", json={}).json()["batch"]
    f = upload(c, batch, "vat_scan.png")
    assert f["method"] == "ocr" and f["doc_type"] == "VATCertificate"
    assert field(f, "vat_trn") == "100123456700003"
    assert plan(c, batch)["TRN"]["decision"] == "review"  # read by OCR: never auto-applied
    g = c.post(f"/api/batches/{batch}/files/{f['id']}/type", json={"docType": "Other"}).json()
    assert g["doc_type"] == "Other" and not g["extraction"]["fields"]


def test_rejects_foreign_host_and_bad_ids(env):
    c, _, _ = env
    assert c.get("/api/clients", headers={"host": "evil.example"}).status_code == 403
    assert c.get("/api/batches/..%2F..").status_code in (400, 404)


def test_frame_and_health_only_for_crm_origins(tmp_path):
    crm = "http://localhost:5173"
    c = TestClient(create_app(Settings.load(storage_root=tmp_path, data_dir=tmp_path / "d", embed_origins=[crm])))
    r = c.get("/api/health", headers={"origin": crm})
    assert r.json() == {"app": "client-module"} and r.headers["access-control-allow-origin"] == crm
    assert r.headers["content-security-policy"] == f"frame-ancestors 'self' {crm}" and "x-frame-options" not in r.headers
    assert "access-control-allow-origin" not in c.get("/api/health", headers={"origin": "https://evil.example"}).headers
    closed = TestClient(create_app(Settings.load(storage_root=tmp_path, data_dir=tmp_path / "e", embed_origins=[])))
    assert closed.get("/").headers["x-frame-options"] == "DENY"


def test_crm_can_read_documents_from_listed_origin_only(tmp_path):
    crm = "https://crm.example"
    c = TestClient(create_app(Settings.load(storage_root=tmp_path, data_dir=tmp_path / "d", embed_origins=[crm], virus_scan=False, ai_enabled=False)))
    pre = c.options("/api/batches", headers={"Origin": crm, "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 204 and pre.headers["access-control-allow-origin"] == crm
    assert "access-control-allow-origin" not in c.get("/api/clients", headers={"Origin": "https://evil.example"}).headers
    batch = c.post("/api/batches", json={}, headers={"Origin": crm}).json()["batch"]
    text = "COMMERCIAL LICENSE\nLicense No: 123456\nCompany Name: TEST TRADING LLC\nExpiry Date: 31/12/2027\n"
    up = c.post(f"/api/batches/{batch}/files", files={"file": ("trade licence.txt", text.encode(), "text/plain")}, headers={"Origin": crm})
    assert up.status_code == 200 and up.headers["access-control-allow-origin"] == crm
    body = up.json()
    print("DOC", body["doc_type"], [(f["key"], f["value"], f["confidence"]) for f in body["extraction"]["fields"]])
    assert body["id"] and body["extraction"]["fields"]


def test_remote_mode_requires_crm_permission_and_exposes_only_document_routes(tmp_path, monkeypatch):
    import clientmodule.api as api

    crm = "https://crm.example"
    settings = Settings.load(
        storage_root=tmp_path,
        data_dir=tmp_path / "d",
        embed_origins=[crm],
        allowed_hosts=["ocr.example.com"],
        remote_mode=True,
        supabase_url="https://supabase.example",
        supabase_anon_key="public-anon-key",
        virus_scan=False,
        ai_enabled=False,
    )
    c = TestClient(create_app(settings))
    headers = {"host": "ocr.example.com", "origin": crm}

    async def allowed(_settings, token):
        return "allowed" if token == "valid" else "forbidden"

    monkeypatch.setattr(api, "verify_remote_document_access", allowed)
    assert c.post("/api/batches", json={}, headers=headers).status_code == 401
    assert c.post("/api/batches", json={}, headers={**headers, "authorization": "Bearer denied"}).status_code == 403
    assert c.get("/api/clients", headers={**headers, "authorization": "Bearer valid"}).status_code == 404
    assert c.get("/api/health", headers=headers).json() == {"app": "client-module"}

    preflight = c.options("/api/batches", headers={**headers, "access-control-request-method": "POST"})
    assert preflight.status_code == 204
    assert "authorization" in preflight.headers["access-control-allow-headers"].lower()

    batch = c.post("/api/batches", json={}, headers={**headers, "authorization": "Bearer valid"})
    assert batch.status_code == 200 and batch.json()["batch"]
    batch_id = batch.json()["batch"]
    credential = {"host": "ocr.example.com", "origin": crm, "authorization": "Bearer valid"}
    uploaded = c.post(
        f"/api/batches/{batch_id}/files",
        files={"file": ("trade licence.txt", b"COMMERCIAL LICENSE\nLicense No: 123456\nCompany Name: TEST TRADING LLC\n")},
        headers=credential,
    )
    assert uploaded.status_code == 200 and uploaded.json()["id"]
    assert c.get(f"/api/batches/{batch_id}", headers=credential).status_code == 404
    assert c.post(f"/api/batches/{batch_id}/ai-extract", headers=credential).status_code == 404
    assert c.delete(f"/api/batches/{batch_id}/files/{uploaded.json()['id']}", headers=credential).status_code == 200

    bad_origin = c.post("/api/batches", json={}, headers={"host": "ocr.example.com", "origin": "https://evil.example"})
    assert bad_origin.status_code == 403
    bad_host = c.post("/api/batches", json={}, headers={"host": "evil.example", "origin": crm})
    assert bad_host.status_code == 403


def test_remote_access_check_validates_session_and_banking_permissions(monkeypatch, tmp_path):
    import asyncio
    import clientmodule.api as api

    calls = []

    class Response:
        status_code = 200
        is_success = True

        def __init__(self, body):
            self.body = body

        def json(self):
            return self.body

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, headers):
            calls.append((url, headers))
            return Response({"id": "signed-in-user"})

        async def post(self, url, headers, json):
            calls.append((url, headers, json))
            return Response({"permissions": ["docs.manage"]})

    monkeypatch.setattr(api.httpx, "AsyncClient", lambda **_kwargs: Client())
    settings = Settings.load(
        storage_root=tmp_path,
        data_dir=tmp_path / "d",
        remote_mode=True,
        allowed_hosts=["ocr.example.com"],
        embed_origins=["https://crm.example"],
        supabase_url="https://supabase.example",
        supabase_anon_key="public-anon-key",
    )
    assert asyncio.run(api.verify_remote_document_access(settings, "session-token")) == "allowed"
    assert len(calls) == 2
    assert all(call[1]["Authorization"] == "Bearer session-token" for call in calls)
    assert calls[1][0].endswith("/rest/v1/rpc/banking_my_access")


def test_generated_documents_go_only_to_their_folder(tmp_path):
    crm = "https://crm.example"
    quotes = tmp_path / "Quotes Generated"
    c = TestClient(create_app(Settings.load(storage_root=tmp_path, data_dir=tmp_path / "d", embed_origins=[crm], generated_folders={"quote": quotes})))
    post = lambda kind, name: c.post(f"/api/generated/{kind}", files={"file": (name, b"x")}, headers={"Origin": crm})
    first = post("quote", "ABC-2026-10-BBQ001 Client.docx")
    assert first.status_code == 200 and first.headers["access-control-allow-origin"] == crm
    assert Path(first.json()["path"]).parent == quotes
    assert post("quote", "ABC-2026-10-BBQ001 Client.docx").json()["path"].endswith("(2).docx")
    assert Path(post("quote", "../../escape.docx").json()["path"]).parent == quotes
    assert post("quote", "bad.exe").status_code == 400
    assert post("other", "a.docx").status_code == 404


def test_open_generated_only_inside_its_folders(tmp_path, monkeypatch):
    import clientmodule.api as api
    calls = []
    monkeypatch.setattr(api.subprocess, "Popen", lambda args: calls.append(args))
    folder = tmp_path / "gen"
    folder.mkdir()
    (folder / "a.docx").write_bytes(b"x")
    (tmp_path / "secret.docx").write_bytes(b"x")
    c = TestClient(create_app(Settings.load(storage_root=tmp_path, data_dir=tmp_path / "d", generated_folders={"quote": folder}, ai_enabled=False)))
    assert c.post("/api/generated-open", json={"path": str(folder / "a.docx")}).status_code == 200
    assert len(calls) == 1
    assert c.post("/api/generated-open", json={"path": str(tmp_path / "secret.docx")}).status_code == 403
    assert c.post("/api/generated-open", json={"path": str(folder / "gone.docx")}).status_code == 404
    assert c.post("/api/generated-open", json={"path": str(folder / ".." / "secret.docx")}).status_code == 403
    assert len(calls) == 1


def test_validated_client_document_goes_to_the_clients_folder(tmp_path):
    existing = tmp_path / "1. Accounting Clients" / "ABC Trading LLC - CL000001"
    existing.mkdir(parents=True)
    c = TestClient(create_app(Settings.load(storage_root=tmp_path, data_dir=tmp_path / "d")))
    post = lambda client, cid, typ, name: c.post("/api/clients-folder", data={"client": client, "client_id": cid, "doc_type": typ}, files={"file": (name, b"x")})
    assert post("ABC", "CL000001", "Passport / ID", "p.pdf").json()["path"] == str(existing / "KYC" / "p.pdf")
    assert post("ABC", "CL000001", "Passport / ID", "p.pdf").json()["path"] == str(existing / "KYC" / "p (2).pdf")
    assert post("New Co", "", "Other", "a.pdf").json()["path"] == str(tmp_path / "5. Others" / "Client Portal" / "New Co" / "Others" / "a.pdf")
    assert post("../../evil", "", "Other", "../../a.pdf").json()["path"] == str(tmp_path / "5. Others" / "Client Portal" / "-..-evil" / "Others" / "a.pdf")
    assert post("New Co", "", "Other", "a.exe").status_code == 400


# ---- Accounting proposals into the client's synced OneDrive folder ----
def _proposal_app(tmp_path, root=True):
    crm = "https://crm.example"
    s = Settings.load(storage_root=tmp_path, data_dir=tmp_path / "d", embed_origins=[crm], proposal_root=(tmp_path / "od") if root else None)
    if root:
        (tmp_path / "od").mkdir()
    return TestClient(create_app(s)), tmp_path / "od", crm


def _proposal_post(c, client="Acme", cid="CL000001", dept="Accounting", word=("p.docx", b"w"), pdf=("p.pdf", b"p"), headers=None):
    return c.post("/api/proposal-folder", data={"client": client, "client_id": cid, "department": dept},
                  files={"word": word, "pdf": pdf}, headers=headers or {})


def test_proposal_folder_saves_both(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    r = _proposal_post(c)
    folder = root / "Accounting" / "Acme - CL000001" / "Proposals"
    assert r.status_code == 200
    assert r.json() == {"path": str(folder / "p.docx"), "word": str(folder / "p.docx"), "pdf": str(folder / "p.pdf")}
    assert (folder / "p.docx").read_bytes() == b"w" and (folder / "p.pdf").read_bytes() == b"p"


def test_proposal_folder_no_code(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    assert _proposal_post(c, cid="").status_code == 200
    assert (root / "Accounting" / "Acme" / "Proposals" / "p.docx").exists()


def test_proposal_folder_no_overwrite(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    _proposal_post(c)
    r = _proposal_post(c).json()
    assert r["word"].endswith("p (2).docx") and r["pdf"].endswith("p (2).pdf")


def test_proposal_folder_cleans_names(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    r = _proposal_post(c, client=r"A/B: ..\..\x", cid=r"..\..", word=("../../e.docx", b"w"), pdf=(r"..\..\e.pdf", b"p"))
    assert r.status_code == 200
    for key in ("word", "pdf"):
        assert Path(r.json()[key]).resolve().is_relative_to(root.resolve())
    assert not (tmp_path / "e.docx").exists()
    assert _proposal_post(c, client="..").status_code == 400


def test_proposal_folder_types(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    assert _proposal_post(c, word=("p.pdf", b"w")).status_code == 400
    assert _proposal_post(c, pdf=("p.docx", b"p")).status_code == 400
    assert _proposal_post(c, pdf=("p.exe", b"p")).status_code == 400
    assert list(root.iterdir()) == []


def test_proposal_folder_size(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    big = b"x" * (25 * 1024 * 1024 + 1)
    assert _proposal_post(c, pdf=("p.pdf", big)).status_code == 400
    assert _proposal_post(c, word=("p.docx", big)).status_code == 400
    assert list(root.iterdir()) == []


def test_proposal_folder_department(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    assert _proposal_post(c, dept="Tax").status_code == 400
    assert list(root.iterdir()) == []


def test_proposal_folder_no_root_is_503(tmp_path):
    c, _, _ = _proposal_app(tmp_path, root=False)
    assert _proposal_post(c).status_code == 503


def test_proposal_folder_cors(tmp_path):
    c, root, crm = _proposal_app(tmp_path)
    ok = _proposal_post(c, headers={"Origin": crm})
    assert ok.headers["access-control-allow-origin"] == crm
    pre = c.options("/api/proposal-folder", headers={"Origin": crm, "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 204 and pre.headers["access-control-allow-origin"] == crm
    other = _proposal_post(c, headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers


def test_proposal_folder_reserved_names(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    assert _proposal_post(c, client="CON").status_code == 400
    assert _proposal_post(c, client="nul.txt").status_code == 400
    assert _proposal_post(c, word=("NUL.docx", b"w")).status_code == 400
    assert _proposal_post(c, pdf=("com1.pdf", b"p")).status_code == 400
    assert _proposal_post(c, word=("lpt1.docx", b"w")).status_code == 400
    assert list(root.iterdir()) == []


def test_proposal_folder_missing_root_creates_nothing(tmp_path):
    c, root, _ = _proposal_app(tmp_path)
    root.rmdir()
    r = _proposal_post(c)
    assert r.status_code == 503 and "proposalRoot" in r.json()["error"]
    assert not root.exists()


def test_proposal_folder_refuses_foreign_origin(tmp_path):
    c, root, crm = _proposal_app(tmp_path)
    r = _proposal_post(c, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and list(root.iterdir()) == []
    assert _proposal_post(c, headers={"Origin": crm}).status_code == 200
    assert _proposal_post(c).status_code == 200  # no Origin header: local tools
