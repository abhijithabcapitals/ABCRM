"""python -m pytest "Database Module/tools/test_onedrive_folder_scan.py" """
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("scan", Path(__file__).with_name("onedrive_folder_scan.py"))
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


def make(root: Path, *paths: str) -> None:
    for p in paths:
        (root / p).mkdir(parents=True)


def test_scan_finds_codes_and_skips_working_folders(tmp_path):
    make(tmp_path, "Business Setup/Apex LLC - CL000075/KYC", "Business Setup/00 Service Areas", "Accounting/00 Unmatched - to link/2. Accounting Clients/Curveball",
         "EMPLOYEES/ABAIZ - ABC-008", "EMPLOYEES/00 EX EMPLOYEES/RISHU - NEW-RISHU", "EMPLOYEES/00 Employee Folder Template",
         "Business Development/00 Leads (before client code)/HMR - LD-2026-000002")
    before = sorted(str(p) for p in tmp_path.rglob("*"))
    got = {f["name"]: f for f in scan.scan(tmp_path)}
    assert sorted(str(p) for p in tmp_path.rglob("*")) == before  # read only
    assert got["Apex LLC - CL000075"]["code"] == "CL000075" and got["Apex LLC - CL000075"]["subfolders"] == ["KYC"]
    assert "00 Service Areas" not in got and "00 Employee Folder Template" not in got
    assert got["Curveball"]["code"] is None and got["Curveball"]["area"] == "Accounting"
    assert got["ABAIZ - ABC-008"]["code"] == "ABC-008" and got["ABAIZ - ABC-008"]["kind"] == "employee"
    assert got["RISHU - NEW-RISHU"]["ex"] is True and got["RISHU - NEW-RISHU"]["code"] == "NEW-RISHU"
    assert got["HMR - LD-2026-000002"]["kind"] == "lead" and got["HMR - LD-2026-000002"]["code"] == "LD-2026-000002"


def test_sql_quotes_safely(tmp_path):
    sql = scan.to_sql(tmp_path, [{"path": "a$scan$b", "name": "x"}])
    body = sql.split("::jsonb")[0]
    assert "$scanx$" in body and json.loads(body.split("$scanx$")[1]) == [{"path": "a$scan$b", "name": "x"}]
