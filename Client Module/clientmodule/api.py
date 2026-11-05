"""Client Module API (FastAPI) for local staff, with an authenticated remote OCR mode.

    GET  /api/health                     {"app": "client-module"} (CORS for config embedOrigins, used by the CRM)
    GET  /api/schema                     field definitions (stages, options, conditions) + document types
    GET  /api/clients                    all rows + headline stats
    GET  /api/clients/{id}               one row + manual review items + change history + documents
    POST /api/preview                    {record, clientId} -> completed row, score, flags, duplicates (nothing saved)
    POST /api/save                       {record, clientId, confirmed, allowDuplicate, batch} -> saves ONE row, files documents
    POST /api/export                     regenerate data/Client_Master.xlsx
  Tax compliance (Tax Agent, read-only):
    GET  /tax                            Tax Compliance page (embedded in the CRM's Tax Compliance tab)
    GET  /api/tax-compliance             every VAT / CT / renewal obligation with due date and status
  Documents (Document Module pipeline):
    POST /api/batches                    {clientId} -> new upload batch
    GET  /api/batches/{b}                documents with stage log, review reasons, extraction
    POST /api/batches/{b}/files          multipart upload -> validation + virus scan, OCR, classification, extraction
    POST /api/batches/{b}/files/{d}/type {docType} correct the detected type (re-extracts)
    POST /api/batches/{b}/files/{d}/period {year, month}
    DELETE /api/batches/{b}/files/{d}
    POST /api/batches/{b}/plan           {record} -> proposed CRM updates (apply / review / already)
    POST /api/batches/{b}/ai-extract     optional paid AI pass over the batch's text (Claude CLI, capped)
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
import re
import subprocess
from pathlib import Path
from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from docai import PipelineError, document_types

from .config import PACKAGE_DIR, Settings
from .documents import DocumentService
from .master import ClientMaster
from .tax import compliance

log = logging.getLogger("clientmodule")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}


async def verify_remote_document_access(settings: Settings, token: str) -> str:
    headers = {"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"}
    timeout = httpx.Timeout(8.0, connect=3.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        user = await client.get(f"{settings.supabase_url}/auth/v1/user", headers=headers)
        if user.status_code in (401, 403):
            return "unauthorized"
        try:
            user_data = user.json() if user.is_success else {}
        except ValueError:
            return "unavailable"
        if not isinstance(user_data, dict) or not user_data.get("id"):
            return "unavailable"

        access = await client.post(f"{settings.supabase_url}/rest/v1/rpc/banking_my_access", headers=headers, json={})
        if not access.is_success:
            return "unavailable"
        try:
            access_data = access.json()
        except ValueError:
            return "unavailable"
        if not isinstance(access_data, dict) or not isinstance(access_data.get("permissions", []), list):
            return "unavailable"
        permissions = access_data.get("permissions", [])
        return "allowed" if {"docs.manage", "kyc.manage", "leads.manage"}.intersection(permissions) else "forbidden"


CLIENT_FILE_TYPES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".eml", ".msg"}
MAX_CLIENT_FILE = 25 * 1024 * 1024
CLIENT_SUBFOLDERS = {"Trade Licence": "Company Documents", "MOA / AOA": "Company Documents", "VAT Document": "Company Documents",
                     "Corporate Tax Document": "Company Documents", "Passport / ID": "KYC", "Bank Statement": "Bank Statements"}


def create_app(settings: Settings) -> FastAPI:
    master = ClientMaster(settings.data_dir)
    docs = DocumentService(settings, master.fields)
    pipe = docs.pipe
    app = FastAPI(title="Client Module", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.master, app.state.docs = master, docs

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        origin = (request.headers.get("origin") or "").rstrip("/")
        path = request.url.path

        if settings.remote_mode:
            host = (request.url.hostname or "").lower()
            if host not in settings.allowed_hosts:
                return JSONResponse({"error": "This host is not allowed."}, status_code=403)
            if path == "/api/health":
                return await call_next(request)
            batch_path = path == "/api/batches"
            upload_path = bool(re.fullmatch(r"/api/batches/[a-f0-9]{16}/files", path))
            delete_path = bool(re.fullmatch(r"/api/batches/[a-f0-9]{16}/files/[a-f0-9]{12}", path))
            allowed_preflight = request.method == "OPTIONS" and (batch_path or upload_path or delete_path)
            allowed_request = (
                batch_path and request.method == "POST"
                or upload_path and request.method == "POST"
                or delete_path and request.method == "DELETE"
            )
            if not (allowed_request or allowed_preflight):
                return JSONResponse({"error": "Not found."}, status_code=404)
            if origin not in settings.embed_origins:
                return JSONResponse({"error": "This CRM origin is not allowed."}, status_code=403)
            if request.method == "OPTIONS":
                response = Response(status_code=204)
                response.headers["Access-Control-Allow-Methods"] = "POST, DELETE"
                response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
                response.headers["Access-Control-Allow-Private-Network"] = "true"
            else:
                token = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
                if not token:
                    return JSONResponse({"error": "Sign in to the CRM before using document processing."}, status_code=401)
                try:
                    access = await verify_remote_document_access(settings, token)
                except httpx.RequestError:
                    log.exception("Could not verify CRM access for remote document request")
                    return JSONResponse({"error": "Could not verify access with the CRM. Try again shortly."}, status_code=503)
                if access == "unauthorized":
                    return JSONResponse({"error": "Your CRM session has expired. Sign in again."}, status_code=401)
                if access == "forbidden":
                    return JSONResponse({"error": "Your Business Banking role does not allow document processing."}, status_code=403)
                if access != "allowed":
                    return JSONResponse({"error": "Could not verify access with the CRM. Try again shortly."}, status_code=503)
                response = await call_next(request)
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Content-Security-Policy"] = "frame-ancestors 'self' " + " ".join(settings.embed_origins)
            return response

        host = (request.headers.get("host") or "").split(":")[0]
        if host not in LOCAL_HOSTS:  # blocks DNS-rebinding pages from reaching the API
            return JSONResponse({"error": "Local access only."}, status_code=403)
        # The CRM's Business Banking page reads documents and looks up clients here; only listed origins may.
        shared = origin in settings.embed_origins and path.startswith(("/api/batches", "/api/clients", "/api/generated", "/api/proposal-folder"))
        if request.method == "OPTIONS" and shared:
            response = Response(status_code=204)
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        else:
            response = await call_next(request)
        if shared:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if settings.embed_origins:  # only the listed CRM origins may frame the module
            response.headers["Content-Security-Policy"] = "frame-ancestors 'self' " + " ".join(settings.embed_origins)
        else:
            response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(PipelineError)
    async def doc_error(_r: Request, exc: PipelineError):
        return JSONResponse({"ok": False, "error": exc.message}, status_code=exc.status)

    @app.exception_handler(RuntimeError)
    async def runtime_error(_r: Request, exc: RuntimeError):
        return JSONResponse({"ok": False, "error": str(exc), "errors": [str(exc)]}, status_code=500)

    def clean(record: Any) -> dict[str, str]:
        return {str(k): "" if v is None else str(v) for k, v in (record or {}).items()}

    # ---- page + schema ----
    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(PACKAGE_DIR / "static" / "index.html", media_type="text/html")

    @app.get("/tax", include_in_schema=False)
    def tax_page():
        return FileResponse(PACKAGE_DIR / "static" / "tax.html", media_type="text/html")

    @app.get("/brand/logo.webp", include_in_schema=False)
    def brand_logo():
        return FileResponse(PACKAGE_DIR / "static" / "ab-capital-logo.webp", media_type="image/webp")

    @app.get("/api/tax-compliance")
    def tax_compliance():
        return compliance(master.read())

    @app.get("/api/schema")
    def schema():
        return {**master.schema.raw, "docTypes": document_types()}

    @app.get("/api/health")
    def health(request: Request):  # lets the CRM confirm this module (not another app) is on the port
        res = JSONResponse({"app": "client-module"})
        origin = (request.headers.get("origin") or "").rstrip("/")
        if origin in settings.embed_origins:
            res.headers["Access-Control-Allow-Origin"] = origin
        return res

    @app.get("/api/ai-status")
    def ai_status():
        return pipe.ai_status()

    # ---- clients ----
    @app.get("/api/clients")
    def clients():
        rows = master.read()
        return {"clients": rows, "stats": master.stats(rows), "masterFile": str(master.csv_path),
                "storageRoot": str(settings.storage_root)}

    @app.get("/api/clients/{client_id}")
    def client(client_id: str):
        rec = master.get(client_id)
        if not rec:
            return JSONResponse({"error": f"Client {client_id} not found."}, status_code=404)
        return {"record": rec, "manualReview": master.manual_review(rec), "history": master.history(client_id),
                "documents": docs.client_documents(client_id)}

    @app.post("/api/preview")
    def preview(body: dict[str, Any] = Body(...)):
        cid = str(body.get("clientId") or "")
        existing = master.get(cid) if cid else None
        res = master.complete(clean(body.get("record")), existing)
        res["duplicates"] = master.find_duplicates(res["record"], cid)
        return res

    @app.post("/api/save")
    def save(body: dict[str, Any] = Body(...)):
        cid = str(body.get("clientId") or "")
        res = master.save(clean(body.get("record")), cid, confirmed=bool(body.get("confirmed")),
                          allow_duplicate=bool(body.get("allowDuplicate")))
        if not res.get("ok"):
            return JSONResponse(res, status_code=409)
        record = master.get(res["id"]) or res["result"]["record"]
        batches = [b for b in [str(body.get("batch") or "")] if b] + docs.pending_batches(res["id"])
        filing: dict[str, Any] = {"filed": [], "held": [], "folders": [], "errors": []}
        for b in dict.fromkeys(batches):  # stage 9: file organization
            try:
                r = docs.file_batch(b, res["id"], record)
                filing["filed"] += r["filed"]
                filing["held"] += r["held"]
                filing["folders"] = sorted(set(filing["folders"]) | set(r["folders"]))
            except PipelineError as exc:
                if exc.status != 404:
                    filing["errors"].append(exc.message)
            except OSError as exc:
                log.exception("filing failed")
                filing["errors"].append(f"Documents not filed: {exc}. They are kept in the inbox; save again to retry.")
        res["filing"] = filing
        return res

    @app.post("/api/export")
    def export():
        return {"ok": True, "path": str(master.export_xlsx())}

    @app.get("/download/csv")
    def download_csv():
        return FileResponse(master.csv_path, media_type="text/csv", filename="client-master.csv")

    @app.get("/download/xlsx")
    def download_xlsx():
        if not master.xlsx_path.exists():
            master.export_xlsx()
        return FileResponse(master.xlsx_path, filename="Client_Master.xlsx",
                            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    # ---- documents generated by the CRM: fixed folders only, and never overwrites ----
    @app.post("/api/generated/{kind}")
    def save_generated(kind: str, file: UploadFile = File(...)):
        folder = settings.generated_folders.get(kind)
        if folder is None:
            return JSONResponse({"error": "Unknown document kind."}, status_code=404)
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", Path(file.filename or "document").name).strip(" .")
        target = folder / name
        if target.suffix.lower() not in (".docx", ".pdf"):
            return JSONResponse({"error": "Only Word and PDF documents are saved here."}, status_code=400)
        folder.mkdir(parents=True, exist_ok=True)
        n = 2
        while target.exists():
            target = folder / f"{Path(name).stem} ({n}){Path(name).suffix}"
            n += 1
        target.write_bytes(file.file.read())
        return {"path": str(target)}

    # ---- a client document validated in the CRM: into that client's folder, never overwrites ----
    @app.post("/api/clients-folder")
    def save_client_document(file: UploadFile = File(...), client: str = Form(...), client_id: str = Form(""), doc_type: str = Form("Other")):
        def clean(s: str) -> str:
            return re.sub(r'[<>:"/\\|?*\[\]\x00-\x1f]+', "-", s).strip(" .")
        name, client_name, cid = clean(Path(file.filename or "document").name), clean(client), clean(client_id)
        if not client_name or Path(name).suffix.lower() not in CLIENT_FILE_TYPES:
            return JSONResponse({"error": "That client or file type cannot be saved."}, status_code=400)
        data = file.file.read(MAX_CLIENT_FILE + 1)
        if len(data) > MAX_CLIENT_FILE:
            return JSONResponse({"error": "Files must be under 25 MB."}, status_code=400)
        # An existing folder is "<Legal Name> - <Client ID>" under a service folder (see DataBase/STORAGE-MAP.md).
        found = [*settings.storage_root.glob(f"*/* - {cid}"), *settings.storage_root.glob(f"*/*/* - {cid}")] if cid else []
        home = next((p for p in sorted(found) if p.is_dir()), settings.storage_root / "5. Others" / "Client Portal" / client_name)
        folder = home / CLIENT_SUBFOLDERS.get(doc_type, "Others")
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / name
        n = 2
        while target.exists():
            target = folder / f"{Path(name).stem} ({n}){Path(name).suffix}"
            n += 1
        target.write_bytes(data)
        return {"path": str(target)}

    # ---- an Accounting proposal (Word + PDF) into the client's synced OneDrive folder, never overwrites ----
    @app.post("/api/proposal-folder")
    def save_proposal(word: UploadFile = File(...), pdf: UploadFile = File(...), client: str = Form(...), client_id: str = Form(""), department: str = Form("Accounting")):
        root = settings.proposal_root
        if root is None:
            return JSONResponse({"error": "The OneDrive folder is not set up on this PC."}, status_code=503)

        def clean(s: str) -> str:
            return re.sub(r'[<>:"/\\|?*\[\]\x00-\x1f]+', "-", s).strip(" .")
        if department != "Accounting":
            return JSONResponse({"error": "Only Accounting proposals are saved here."}, status_code=400)
        wname, pname = clean(Path(word.filename or "").name), clean(Path(pdf.filename or "").name)
        client_name, cid = clean(client), clean(client_id)
        if not client_name or Path(wname).suffix.lower() != ".docx" or Path(pname).suffix.lower() != ".pdf":
            return JSONResponse({"error": "That client or file type cannot be saved."}, status_code=400)
        wdata, pdata = word.file.read(MAX_CLIENT_FILE + 1), pdf.file.read(MAX_CLIENT_FILE + 1)
        if len(wdata) > MAX_CLIENT_FILE or len(pdata) > MAX_CLIENT_FILE:
            return JSONResponse({"error": "Files must be under 25 MB."}, status_code=400)
        base = root.resolve()
        folder = (base / "Accounting" / (f"{client_name} - {cid}" if cid else client_name) / "Proposals").resolve()
        if not folder.is_relative_to(base):
            return JSONResponse({"error": "That client or file type cannot be saved."}, status_code=400)
        folder.mkdir(parents=True, exist_ok=True)

        def pick(n: int) -> tuple[Path, Path]:
            w, p = Path(wname), Path(pname)
            return (folder / (wname if n == 1 else f"{w.stem} ({n}){w.suffix}"), folder / (pname if n == 1 else f"{p.stem} ({n}){p.suffix}"))
        n = 1
        while any(t.exists() for t in pick(n)):
            n += 1
        wt, pt = pick(n)
        try:
            wt.write_bytes(wdata)
            pt.write_bytes(pdata)
        except OSError:
            wt.unlink(missing_ok=True)
            pt.unlink(missing_ok=True)
            return JSONResponse({"error": "The files could not be saved to OneDrive."}, status_code=500)
        return {"path": str(wt), "word": str(wt), "pdf": str(pt)}

    # Opens Explorer on a generated document. Only existing files inside the configured folders.
    @app.post("/api/generated-open")
    def open_generated(body: dict[str, Any] = Body(default={})):
        try:
            target = Path(str(body.get("path") or "")).resolve(strict=True)
        except (OSError, RuntimeError):
            return JSONResponse({"error": "The file is not at this location on this PC."}, status_code=404)
        folders = [Path(f).resolve() for f in settings.generated_folders.values()]
        if not target.is_file() or not any(target.is_relative_to(f) for f in folders):
            return JSONResponse({"error": "That file is not in Generated Documents."}, status_code=403)
        subprocess.Popen(["explorer", f"/select,{target}"])
        return {"ok": True}

    # ---- documents ----
    @app.post("/api/batches")
    def new_batch(body: dict[str, Any] = Body(default={})):
        return pipe.view(pipe.new_batch(str(body.get("clientId") or "")))

    @app.get("/api/batches/{batch}")
    def get_batch(batch: str):
        return pipe.view(batch)

    @app.post("/api/batches/{batch}/files")
    def upload(batch: str, file: UploadFile = File(...)):
        return pipe.receive(batch, file.filename or "document", file.file)

    @app.delete("/api/batches/{batch}/files/{doc_id}")
    def delete_file(batch: str, doc_id: str):
        pipe.remove(batch, doc_id)
        return {"ok": True}

    @app.post("/api/batches/{batch}/files/{doc_id}/type")
    def set_type(batch: str, doc_id: str, body: dict[str, Any] = Body(...)):
        return pipe.set_type(batch, doc_id, str(body.get("docType") or ""))

    @app.post("/api/batches/{batch}/files/{doc_id}/period")
    def set_period(batch: str, doc_id: str, body: dict[str, Any] = Body(...)):
        return pipe.set_period(batch, doc_id, int(body.get("year") or 0), int(body.get("month") or 0))

    @app.post("/api/batches/{batch}/plan")
    def plan(batch: str, body: dict[str, Any] = Body(default={})):  # stage 7 (+ review decisions)
        pipe.view(batch)  # 404 for an unknown batch
        return docs.plan([batch], clean(body.get("record")))

    @app.post("/api/batches/{batch}/ai-extract")
    def ai_extract(batch: str):
        return pipe.ai_extract(batch)

    return app
