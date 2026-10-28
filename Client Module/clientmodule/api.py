"""Client Module API (FastAPI) for staff on this PC. Listens on 127.0.0.1 only.

    GET  /api/health                     {"app": "client-module"} (CORS for config embedOrigins, used by the CRM)
    GET  /api/schema                     field definitions (stages, options, conditions) + document types
    GET  /api/clients                    all rows + headline stats
    GET  /api/clients/{id}               one row + manual review items + change history + documents
    POST /api/preview                    {record, clientId} -> completed row, score, flags, duplicates (nothing saved)
    POST /api/save                       {record, clientId, confirmed, allowDuplicate, batch} -> saves ONE row, files documents
    POST /api/export                     regenerate data/Client_Master.xlsx
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

from fastapi import Body, FastAPI, File, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from docai import PipelineError, document_types

from .config import PACKAGE_DIR, Settings
from .documents import DocumentService
from .master import ClientMaster

log = logging.getLogger("clientmodule")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}


def create_app(settings: Settings) -> FastAPI:
    master = ClientMaster(settings.data_dir)
    docs = DocumentService(settings, master.fields)
    pipe = docs.pipe
    app = FastAPI(title="Client Module", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.master, app.state.docs = master, docs

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        host = (request.headers.get("host") or "").split(":")[0]
        if host not in LOCAL_HOSTS:  # blocks DNS-rebinding pages from reaching the API
            return JSONResponse({"error": "Local access only."}, status_code=403)
        response = await call_next(request)
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
