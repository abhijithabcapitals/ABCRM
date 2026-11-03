"""Tests for scripts/legacy_load.py, with invented rows only."""
import csv
import datetime
import json
import sys
from pathlib import Path

import openpyxl
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import legacy_load as ll  # noqa: E402


def test_zone_mapping():
    assert ll.map_zone("DET") == ll.map_zone("DED") == ll.map_zone(" Dubai Mainland ") == "Dubai Mainland"
    assert ll.map_zone("HAMRIYAH FREEZONE") == ll.map_zone("Hamriyah") == "Hamriyah Free Zone"
    assert ll.map_zone("JAFZA -redomicile") == "JAFZA"


def test_zone_unknown_held():
    assert ll.map_zone("ZZZ") is None
    assert ll.map_zone("Liquidated") is None
    assert ll.map_zone(None) is None


def test_name_normal():
    assert ll.norm("ABC Trading L.L.C") == ll.norm("abc trading llc")
    assert ll.norm("ABC Trading LLC") != ll.norm("ABC Trading FZE")


def test_bad_date_held():
    assert ll.parse_date("NEEDS TO ENTER") is None
    assert ll.parse_date(datetime.datetime(2026, 3, 1)) == "2026-03-01"
    assert ll.parse_date("01/03/2026") == "2026-03-01"
    assert ll.parse_date("31/02/2026") is None
    assert ll.parse_date(None) is None
    assert ll.parse_date("") is None


def test_date_problem_is_flagged():
    assert ll.bad_dates({"licence_date": "soon", "expiry": None}) == ["licence_date"]
    assert ll.bad_dates({"licence_date": datetime.datetime(2026, 1, 1)}) == []


def test_file_open_refused(tmp_path):
    (tmp_path / "Book.xlsx").write_bytes(b"x")
    (tmp_path / "~$Book.xlsx").write_bytes(b"x")
    with pytest.raises(ll.FileLocked):
        ll.check_not_open(tmp_path / "Book.xlsx")
    (tmp_path / "~$Book.xlsx").unlink()
    ll.check_not_open(tmp_path / "Book.xlsx")


def test_csv_empty_columns_ignored():
    row = {"Task Name": "Acme LLC", "Status": "Active", "License Number": ""}
    assert ll.master_csv_row(row) == {"name": "Acme LLC", "status": "Active"}


def _resources(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Master List"
    ws.append([None] * 13)
    ws.append([None, "S. No.", "Company Name", "Free Zone", "License Number ", "License Date", "Expiry Date", "Shareholder ", "Manager", "Leasd Source", "VISA", "Remarks", "KYC Form "])
    ws.append([None, 1, "Acme LLC", "DET", "L1", datetime.datetime(2025, 1, 1), datetime.datetime(2026, 1, 1), "A Person", "B Person", None, "1", None, "Done"])
    ws.append([None, 2, "Odd Date LLC", "ZZZ", "L2", "unknown", None, None, None, None, None, None, None])
    wb.save(tmp_path / ll.WORK_SHEET)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([None] * 7)   # the real sheet has a blank row above its header
    ws.append([None, "Name", "Company Name", "Visa Title (Occupation)", "Visa Issue Date", "Visa Expiry Date", "2026 Updates"])
    ws.append([None, "A Person", "Acme LLC", "PARTNER", datetime.datetime(2025, 1, 1), datetime.datetime(2027, 1, 1), "Sent"])
    wb.save(tmp_path / ll.VISA_SHEET)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["S. No.", "Company Name", "Free Zone", "License Number ", "License Date", "Expiry Date", "Ejari "])
    ws.append([1, "Acme LLC", "DET", "L1", datetime.datetime(2025, 1, 1), datetime.datetime(2026, 1, 1), "Start Up Group"])
    wb.save(tmp_path / ll.EJARI_SHEET)
    def write(name, head, rows):
        with open(tmp_path / name, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(head)
            w.writerows(rows)
    write("Master_List_export_all_x.csv", ["Task Name", "Status"], [["ACME L.L.C", "Expiring Soon"]])
    write("VISA_Master_List_export_all_x.csv", ["Task Name", "Status"], [["A Person", "VISA CANCELLED"]])
    write("Business_Set_up_Team_export_all_x.csv", ["Task Name", "Status", "Assignee", "Date Created", "Date Done", "FREEZONE/DED", "Domain", "Payment Status", "Remarks"],
          [["Acme LLC", "Done", "Someone", "2026-02-12", "2026-03-01", "DED", "Business Set Up", "Fully Paid", ""]])
    write("Quotations_by_CRM_export_all_x.csv", ["Task Name", "Free Zone", "Quotation Date"], [["Prospect", "IFZA", "2026-10-19"]])
    return tmp_path


def test_collect_uses_each_sources_authority(tmp_path):
    rows = ll.collect(_resources(tmp_path))
    by = {(r["source"], r["name"]): r for r in rows}
    acme = by[("company", "Acme LLC")]["payload"]
    assert acme["licence_number"] == "L1" and acme["licence_expiry"] == "2026-01-01" and acme["jurisdiction"] == "Dubai Mainland"
    assert acme["client_status"] == "Expiring Soon"      # the CSV is the authority for status only
    assert acme["kyc_form"] == "Done" and acme["shareholder"] == "A Person"
    assert by[("company", "Odd Date LLC")]["payload"]["bad_dates"] == ["licence_date"]
    assert by[("company", "Odd Date LLC")]["payload"]["zone_raw"] == "ZZZ" and by[("company", "Odd Date LLC")]["payload"]["jurisdiction"] is None
    visa = by[("visa", "A Person")]
    assert visa["company"] == "Acme LLC" and visa["payload"]["status"] == "VISA CANCELLED" and visa["payload"]["expiry_date"] == "2027-01-01"
    assert by[("ejari", "Acme LLC")]["payload"]["provider"] == "Start Up Group"
    svc = by[("service", "Acme LLC")]["payload"]
    assert svc["old_status"] == "Done" and svc["payment_status"] == "Fully Paid"
    assert by[("quotation", "Prospect")]["payload"]["zone"] == "IFZA"


def test_keys_are_stable_and_unique(tmp_path):
    res = _resources(tmp_path)
    a = ll.collect(res)
    b = ll.collect(res)
    assert [r["source_key"] for r in a] == [r["source_key"] for r in b]
    assert len({r["source_key"] for r in a}) == len(a)


def test_main_writes_json_and_sql_and_a_report(tmp_path, capsys):
    res = _resources(tmp_path)
    out = tmp_path / "rows.json"
    sql = tmp_path / "stage.sql"
    ll.main(["--resources", str(res), "--out", str(out), "--sql-out", str(sql), "--import-id", "00000000-0000-0000-0000-000000000001"])
    assert len(json.loads(out.read_text(encoding="utf8"))) == 6
    assert "business_setup_import_stage('00000000-0000-0000-0000-000000000001'" in sql.read_text(encoding="utf8")
    report = capsys.readouterr().out
    assert "company: 2" in report and "ZZZ" in report
    assert "Acme" not in report   # no client names in the printed report
