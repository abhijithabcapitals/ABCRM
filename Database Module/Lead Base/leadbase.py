"""Lead Base: two-way Excel copy of every lead in the CRM's Business Development tab.

    python leadbase.py login          sign in once with your CRM email and password
    python leadbase.py pull           download all leads into data/Lead_Base.xlsx
    python leadbase.py push           send your Excel edits back to the CRM, then refresh
    python leadbase.py watch [MIN]    keep the workbook up to date every MIN minutes (default 5)
    python leadbase.py logout

What it holds: pipeline leads (bd_leads) and every lead-platform prospect
(bd_platform_prospects: Explee, and Google Sheets, Meta, Google Ads ... as they are added).

Edits go through the same database functions as the CRM screen, signed in as you, so
row-level security, duplicate checks, validation and the audit log all apply. Nothing
is written straight into tables. Rows the CRM refuses are listed in data/push_report.csv
and left in the workbook for you to fix.
"""
from __future__ import annotations

import csv
import getpass
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
WORKBOOK = DATA / "Lead_Base.xlsx"
SNAPSHOT = DATA / ".snapshot.json"
SESSION = DATA / ".session.json"
REPORT = DATA / "push_report.csv"
ENV_FILE = HERE.parent.parent / "Main Module" / ".env"
DUBAI = timezone(timedelta(hours=4))

STAGES = ["New Lead", "Contact Pending", "First Contact Attempted", "Contact Established", "Requirement Identified",
          "Qualified", "Proposal / Quotation Preparation", "Proposal Sent", "Follow-up / Negotiation", "Verbal Confirmation"]
PRIORITIES = ["Low", "Medium", "High", "Urgent"]

# Pipeline Leads sheet: (header, key in bd_ui_leads JSON, editable key for bd_update_lead or None)
LEAD_COLUMNS = [
    ("Record ID", "id", None),
    ("Lead No", "lead_id", None),
    ("Name", "name", "name"),
    ("Contact name", "contact_name", "contact_name"),
    ("Designation", "designation", "designation"),
    ("Mobile", "mobile", "mobile"),
    ("WhatsApp", "whatsapp", "whatsapp"),
    ("Email", "email", "email"),
    ("Website", "website", "website"),
    ("Country", "country", "country"),
    ("Emirate", "emirate", "emirate"),
    ("Priority", "priority", "priority"),
    ("Est. budget", "estimated_budget", "estimated_budget"),
    ("Currency", "budget_currency", "budget_currency"),
    ("Notes", "notes", "notes"),
    ("Source detail", "source_detail", "source_detail"),
    ("Stage", "stage", "stage"),          # changed through bd_change_stage
    ("Status", "status", None),
    ("Source", "source", None),
    ("Campaign", "campaign_name", None),
    ("Service interest", "initial_service_interest", None),
    ("Next follow-up", "next_followup_at", None),
    ("Owner", "current_owner", None),
    ("Created", "created_at", None),
]

NEW_LEAD_COLUMNS = ["Name", "Type (Company/Individual)", "Contact name", "Mobile", "Email", "Source", "Campaign",
                    "Service interest", "Initial summary (20+ characters)", "Next follow-up (DD/MM/YYYY HH:MM)",
                    "Priority", "Notes", "Result"]

PROSPECT_COLUMNS = [
    ("Record ID", "id", False), ("Platform", "provider", False), ("Kind", "kind", False), ("Name", "name", False),
    ("Email", "email", False), ("Phone", "phone", False), ("Job title", "job_title", False),
    ("Company", "company_name", False), ("Website", "company_domain", False), ("Country", "country", False),
    ("Campaign", "campaign_name", False), ("Why hot / reply", "why_hot", False), ("Became hot", "became_hot_at", False),
    ("Status", "status", True), ("Pipeline lead", "lead_id", False), ("LinkedIn", "linkedin_url", False),
]

EDIT_FILL = PatternFill("solid", fgColor="FFF7D6")
HEAD_FILL = PatternFill("solid", fgColor="1F3A4D")
HEAD_FONT = Font(color="FFFFFF", bold=True)


# ---------------------------------------------------------------- connection
def read_env() -> tuple[str, str]:
    url = os.environ.get("LEADBASE_SUPABASE_URL")
    key = os.environ.get("LEADBASE_SUPABASE_ANON_KEY")
    if not (url and key) and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            v = v.strip().strip('"').strip("'")
            if k.strip() == "VITE_SUPABASE_URL" and not url:
                url = v
            if k.strip() == "VITE_SUPABASE_ANON_KEY" and not key:
                key = v
    if not (url and key):
        sys.exit(f"Supabase URL and public (anon) key not found. Expected them in {ENV_FILE}.")
    return url.rstrip("/"), key


class Api:
    def __init__(self):
        self.url, self.anon = read_env()
        self.http = httpx.Client(timeout=90)
        self.session = json.loads(SESSION.read_text(encoding="utf-8")) if SESSION.exists() else None

    def _save(self, data: dict):
        DATA.mkdir(exist_ok=True)
        self.session = {"access_token": data["access_token"], "refresh_token": data["refresh_token"],
                        "expires_at": time.time() + int(data.get("expires_in", 3600)) - 60,
                        "email": data.get("user", {}).get("email") or (self.session or {}).get("email"),
                        "user_id": data.get("user", {}).get("id") or (self.session or {}).get("user_id")}
        SESSION.write_text(json.dumps(self.session), encoding="utf-8")

    def login(self):
        email = input("CRM email: ").strip()
        password = getpass.getpass("CRM password (not shown): ")
        r = self.http.post(f"{self.url}/auth/v1/token?grant_type=password", headers={"apikey": self.anon},
                           json={"email": email, "password": password})
        if r.status_code != 200:
            sys.exit(f"Sign-in failed: {r.json().get('error_description') or r.text}")
        self._save(r.json())
        print(f"Signed in as {self.session['email']}. The session is kept in {SESSION.name} on this PC only.")

    def token(self) -> str:
        if not self.session:
            sys.exit("Not signed in. Run: python leadbase.py login")
        if time.time() > self.session["expires_at"]:
            r = self.http.post(f"{self.url}/auth/v1/token?grant_type=refresh_token", headers={"apikey": self.anon},
                               json={"refresh_token": self.session["refresh_token"]})
            if r.status_code != 200:
                SESSION.unlink(missing_ok=True)
                sys.exit("Your sign-in expired. Run: python leadbase.py login")
            self._save(r.json())
        return self.session["access_token"]

    def _headers(self, extra: dict | None = None) -> dict:
        h = {"apikey": self.anon, "Authorization": f"Bearer {self.token()}", "Content-Type": "application/json"}
        h.update(extra or {})
        return h

    def rpc(self, name: str, args: dict):
        r = self.http.post(f"{self.url}/rest/v1/rpc/{name}", headers=self._headers(), json=args)
        if r.status_code >= 300:
            raise RuntimeError(_err(r))
        return r.json() if r.content else None

    def select(self, table: str, query: str):
        r = self.http.get(f"{self.url}/rest/v1/{table}?{query}", headers=self._headers())
        if r.status_code >= 300:
            raise RuntimeError(_err(r))
        return r.json()

    def patch(self, table: str, query: str, body: dict) -> int:
        r = self.http.patch(f"{self.url}/rest/v1/{table}?{query}", headers=self._headers({"Prefer": "return=representation"}), json=body)
        if r.status_code >= 300:
            raise RuntimeError(_err(r))
        return len(r.json())


def _err(r: httpx.Response) -> str:
    try:
        j = r.json()
        return j.get("message") or j.get("error_description") or j.get("hint") or r.text
    except ValueError:
        return r.text


# ---------------------------------------------------------------- helpers
def to_dubai(value) -> str:
    if not value:
        return ""
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(DUBAI).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return str(value)


def parse_dubai(value) -> str | None:
    """Excel cell (datetime or 'DD/MM/YYYY HH:MM' in Dubai time) to ISO."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=DUBAI)
        return dt.isoformat()
    text = str(value).strip()
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=DUBAI).isoformat()
        except ValueError:
            pass
    raise ValueError(f"Date '{text}' is not DD/MM/YYYY HH:MM")


def norm(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def file_hash() -> str:
    return hashlib.sha256(WORKBOOK.read_bytes()).hexdigest() if WORKBOOK.exists() else ""


def style_sheet(ws, headers, editable):
    ws.append(headers)
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i)
        c.fill = HEAD_FILL if not editable[i - 1] else PatternFill("solid", fgColor="0D7D82")
        c.font = HEAD_FONT
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = max(12, min(40, len(h) + 6))
    ws.freeze_panes = "C2"
    ws.row_dimensions[1].height = 32


# ---------------------------------------------------------------- pull
def pull(api: Api, force: bool = False, quiet: bool = False) -> bool:
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8")) if SNAPSHOT.exists() else {}
    if WORKBOOK.exists() and not force and snap.get("file_hash") and snap["file_hash"] != file_hash():
        print("The workbook has edits that are not pushed yet. Run 'push' first, or 'pull --force' to discard them.")
        return False

    leads = api.rpc("bd_ui_leads", {"p_limit": 2000}) or []
    prospects = api.select("bd_platform_prospects", "select=*&order=became_hot_at.desc.nullslast,fetched_at.desc&limit=20000")
    owners = {p["id"]: p.get("full_name") or p.get("email") for p in api.select("profiles", "select=id,full_name,email")}
    lead_numbers = {l["id"]: l.get("lead_id") for l in leads}

    wb = Workbook()
    ws = wb.active
    ws.title = "Pipeline Leads"
    style_sheet(ws, [c[0] for c in LEAD_COLUMNS], [bool(c[2]) for c in LEAD_COLUMNS])
    for lead in leads:
        row = []
        for _, key, _ in LEAD_COLUMNS:
            v = lead.get(key)
            if key in ("next_followup_at", "created_at"):
                v = to_dubai(v)
            elif key == "current_owner":
                v = owners.get(v, v or "")
            row.append(v if v is not None else "")
        ws.append(row)
    for r in range(2, ws.max_row + 1):
        for i, (_, _, edit) in enumerate(LEAD_COLUMNS, start=1):
            if edit:
                ws.cell(row=r, column=i).fill = EDIT_FILL
    dv_stage = DataValidation(type="list", formula1='"' + ",".join(STAGES) + '"', allow_blank=False)
    dv_prio = DataValidation(type="list", formula1='"' + ",".join(PRIORITIES) + '"', allow_blank=True)
    ws.add_data_validation(dv_stage)
    ws.add_data_validation(dv_prio)
    stage_col = get_column_letter([c[1] for c in LEAD_COLUMNS].index("stage") + 1)
    prio_col = get_column_letter([c[1] for c in LEAD_COLUMNS].index("priority") + 1)
    dv_stage.add(f"{stage_col}2:{stage_col}5000")
    dv_prio.add(f"{prio_col}2:{prio_col}5000")
    ws.column_dimensions["A"].hidden = True

    wn = wb.create_sheet("New Leads")
    style_sheet(wn, NEW_LEAD_COLUMNS, [h != "Result" for h in NEW_LEAD_COLUMNS])
    wn.freeze_panes = "B2"
    sources = sorted({s["source_name"] for s in api.select("bd_lead_sources", "select=source_name&is_active=eq.true")})
    dv_src = DataValidation(type="list", formula1='"' + ",".join(sources)[:250] + '"', allow_blank=False)
    dv_type = DataValidation(type="list", formula1='"Company,Individual"', allow_blank=True)
    dv_p2 = DataValidation(type="list", formula1='"' + ",".join(PRIORITIES) + '"', allow_blank=True)
    for dv, col in ((dv_src, "F"), (dv_type, "B"), (dv_p2, "K")):
        wn.add_data_validation(dv)
        dv.add(f"{col}2:{col}500")

    wp = wb.create_sheet("Prospects")
    style_sheet(wp, [c[0] for c in PROSPECT_COLUMNS], [c[2] for c in PROSPECT_COLUMNS])
    for p in prospects:
        row = []
        for _, key, _ in PROSPECT_COLUMNS:
            v = p.get(key)
            if key == "became_hot_at":
                v = to_dubai(v)
            elif key == "lead_id":
                v = lead_numbers.get(v, "") if v else ""
            row.append(v if v is not None else "")
        wp.append(row)
    status_col = get_column_letter([c[1] for c in PROSPECT_COLUMNS].index("status") + 1)
    dv_ps = DataValidation(type="list", formula1='"new,dismissed"', allow_blank=False)
    wp.add_data_validation(dv_ps)
    dv_ps.add(f"{status_col}2:{status_col}50000")
    for r in range(2, wp.max_row + 1):
        wp[f"{status_col}{r}"].fill = EDIT_FILL
    wp.column_dimensions["A"].hidden = True

    wsum = wb.create_sheet("Summary", 0)
    wsum.append(["Lead Base", ""])
    wsum["A1"].font = Font(bold=True, size=14)
    wsum.append(["Pulled at (Dubai)", datetime.now(DUBAI).strftime("%d/%m/%Y %H:%M")])
    wsum.append(["Signed in as", api.session.get("email")])
    wsum.append(["Pipeline leads", len(leads)])
    wsum.append([])
    wsum.append(["Pipeline leads by source", "Count"])
    by_source: dict[str, int] = {}
    for l in leads:
        by_source[l.get("source") or "Unspecified"] = by_source.get(l.get("source") or "Unspecified", 0) + 1
    for k, v in sorted(by_source.items(), key=lambda kv: -kv[1]):
        wsum.append([k, v])
    wsum.append([])
    wsum.append(["Platform prospects", "To review", "In pipeline", "Dismissed", "Total"])
    by_prov: dict[str, dict[str, int]] = {}
    for p in prospects:
        d = by_prov.setdefault(p["provider"], {"new": 0, "added": 0, "dismissed": 0})
        d[p["status"]] = d.get(p["status"], 0) + 1
    for prov, d in sorted(by_prov.items()):
        wsum.append([prov.title(), d["new"], d["added"], d["dismissed"], sum(d.values())])
    wsum.append([])
    wsum.append(["How to edit", "Yellow cells are editable. Change them, save and close Excel, then run 'push'."])
    wsum.append(["", "New leads: fill a row in 'New Leads'. Prospects: set Status to new or dismissed."])
    wsum.append(["", "Use the CRM's Lead Generation tab to add a prospect to the pipeline."])
    wsum.column_dimensions["A"].width = 30
    wsum.column_dimensions["B"].width = 22

    DATA.mkdir(exist_ok=True)
    try:
        wb.save(WORKBOOK)
    except PermissionError:
        print("Close Lead_Base.xlsx in Excel, then run the command again.")
        return False

    snapshot = {
        "pulled_at": datetime.now(timezone.utc).isoformat(),
        "leads": {l["id"]: {c[1]: norm(l.get(c[1])) for c in LEAD_COLUMNS if c[2]} for l in leads},
        "prospects": {p["id"]: p["status"] for p in prospects},
        "file_hash": file_hash(),
    }
    SNAPSHOT.write_text(json.dumps(snapshot), encoding="utf-8")
    if not quiet:
        print(f"Pulled {len(leads)} pipeline leads and {len(prospects)} platform prospects into {WORKBOOK}")
    return True


# ---------------------------------------------------------------- push
def push(api: Api) -> None:
    if not WORKBOOK.exists() or not SNAPSHOT.exists():
        sys.exit("Nothing to push. Run 'pull' first.")
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    try:
        wb = load_workbook(WORKBOOK)
    except PermissionError:
        sys.exit("Close Lead_Base.xlsx in Excel, then run push again.")
    results: list[dict] = []

    # 1. Edited pipeline leads
    ws = wb["Pipeline Leads"]
    keys = [c[1] for c in LEAD_COLUMNS]
    for r in range(2, ws.max_row + 1):
        lead_id = norm(ws.cell(row=r, column=1).value)
        if not lead_id or lead_id not in snap["leads"]:
            continue
        before = snap["leads"][lead_id]
        changes, new_stage = {}, None
        for i, (_, key, edit) in enumerate(LEAD_COLUMNS, start=1):
            if not edit:
                continue
            now = norm(ws.cell(row=r, column=i).value)
            if now != before.get(key, ""):
                if key == "stage":
                    new_stage = now
                else:
                    changes[edit] = now
        label = norm(ws.cell(row=r, column=keys.index("lead_id") + 1).value) or lead_id
        if changes:
            try:
                api.rpc("bd_update_lead", {"p_lead_id": lead_id, "p_changes": changes})
                results.append({"sheet": "Pipeline Leads", "record": label, "action": "update " + ", ".join(changes), "result": "OK"})
            except RuntimeError as e:
                results.append({"sheet": "Pipeline Leads", "record": label, "action": "update " + ", ".join(changes), "result": f"Refused: {e}"})
        if new_stage:
            try:
                api.rpc("bd_change_stage", {"p_lead_id": lead_id, "p_stage": new_stage, "p_reason": "Changed via Lead Base"})
                results.append({"sheet": "Pipeline Leads", "record": label, "action": f"stage -> {new_stage}", "result": "OK"})
            except RuntimeError as e:
                results.append({"sheet": "Pipeline Leads", "record": label, "action": f"stage -> {new_stage}", "result": f"Refused: {e}"})

    # 2. New leads
    wn = wb["New Leads"]
    uid = api.session.get("user_id")
    for r in range(2, wn.max_row + 1):
        vals = [wn.cell(row=r, column=i).value for i in range(1, len(NEW_LEAD_COLUMNS) + 1)]
        name, ltype, contact, mobile, email, source, campaign, service, summary, follow, prio, notes, result = vals
        if not norm(name) or norm(result).startswith("Created"):
            continue
        label = norm(name)
        try:
            planned = parse_dubai(follow)
            if not planned:
                raise ValueError("Next follow-up is required")
            created = api.rpc("bd_create_lead", {
                "p_lead": {
                    "lead_type": (norm(ltype) or "Company").lower(), "name": norm(name), "contact_name": norm(contact),
                    "mobile": norm(mobile), "email": norm(email), "source": norm(source) or "Other",
                    "campaign_name": norm(campaign), "initial_service_interest": norm(service),
                    "initial_summary": norm(summary), "priority": norm(prio) or "Medium", "notes": norm(notes),
                    "acquired_by": uid, "current_owner": uid,
                },
                "p_activity": {"summary": norm(summary), "channel": "Other", "contact_person": norm(contact) or norm(name)},
                "p_followup": {"planned_at": planned},
            })
            wn.cell(row=r, column=len(NEW_LEAD_COLUMNS)).value = f"Created {created.get('lead_id', '')}"
            results.append({"sheet": "New Leads", "record": label, "action": "create", "result": f"OK {created.get('lead_id', '')}"})
        except (RuntimeError, ValueError) as e:
            wn.cell(row=r, column=len(NEW_LEAD_COLUMNS)).value = f"Refused: {e}"
            results.append({"sheet": "New Leads", "record": label, "action": "create", "result": f"Refused: {e}"})

    # 3. Prospect status (new <-> dismissed)
    wp = wb["Prospects"]
    pkeys = [c[1] for c in PROSPECT_COLUMNS]
    s_col = pkeys.index("status") + 1
    for r in range(2, wp.max_row + 1):
        pid = norm(wp.cell(row=r, column=1).value)
        if not pid or pid not in snap["prospects"]:
            continue
        before, now = snap["prospects"][pid], norm(wp.cell(row=r, column=s_col).value).lower()
        if now == before:
            continue
        label = norm(wp.cell(row=r, column=pkeys.index("name") + 1).value) or pid
        if before == "added" or now not in ("new", "dismissed"):
            results.append({"sheet": "Prospects", "record": label, "action": f"status -> {now}",
                            "result": "Refused: only new and dismissed can be set here; add to the pipeline from the CRM"})
            continue
        try:
            body = {"status": now, "handled_at": datetime.now(timezone.utc).isoformat() if now == "dismissed" else None}
            if not api.patch("bd_platform_prospects", f"id=eq.{pid}", body):
                raise RuntimeError("not allowed for your role")
            results.append({"sheet": "Prospects", "record": label, "action": f"status -> {now}", "result": "OK"})
        except RuntimeError as e:
            results.append({"sheet": "Prospects", "record": label, "action": f"status -> {now}", "result": f"Refused: {e}"})

    failed = [x for x in results if not x["result"].startswith("OK")]
    with REPORT.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["sheet", "record", "action", "result"])
        w.writeheader()
        w.writerows(results)

    if not results:
        print("No changes found in the workbook.")
        return
    for x in results:
        print(f"  [{x['sheet']}] {x['record']}: {x['action']} -> {x['result']}")
    print(f"{len(results) - len(failed)} applied, {len(failed)} refused. Report: {REPORT}")
    if failed:
        wb.save(WORKBOOK)  # keep the Result notes on New Leads
        print("Fix the refused rows in the workbook and push again. (Applied rows will not be sent twice.)")
        # Applied edits are now in the CRM: mark them as the new baseline so they are not resent.
        fresh = api.rpc("bd_ui_leads", {"p_limit": 2000}) or []
        snap["leads"] = {l["id"]: {c[1]: norm(l.get(c[1])) for c in LEAD_COLUMNS if c[2]} for l in fresh}
        snap["prospects"] = {p["id"]: p["status"] for p in api.select("bd_platform_prospects", "select=id,status&limit=20000")}
        snap["file_hash"] = ""  # keep the edited workbook protected from automatic pulls
        SNAPSHOT.write_text(json.dumps(snap), encoding="utf-8")
    else:
        pull(api, force=True, quiet=True)
        print("Workbook refreshed from the CRM.")


# ---------------------------------------------------------------- watch
def watch(api: Api, minutes: float) -> None:
    print(f"Keeping {WORKBOOK.name} up to date every {minutes:g} minutes. Press Ctrl+C to stop.")
    while True:
        try:
            ok = pull(api, quiet=True)
            stamp = datetime.now(DUBAI).strftime("%H:%M")
            print(f"[{stamp}] {'refreshed' if ok else 'skipped (unpushed edits or file open)'}")
        except (RuntimeError, httpx.HTTPError) as e:
            print(f"Refresh failed: {e}")
        time.sleep(minutes * 60)


def main(argv: list[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "pull"
    api = Api()
    if cmd == "login":
        api.login()
    elif cmd == "logout":
        SESSION.unlink(missing_ok=True)
        print("Signed out on this PC.")
    elif cmd == "pull":
        pull(api, force="--force" in argv)
    elif cmd == "push":
        push(api)
    elif cmd == "watch":
        watch(api, float(argv[2]) if len(argv) > 2 and argv[2].replace(".", "").isdigit() else 5)
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
