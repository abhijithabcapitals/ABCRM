"""Tests for scripts/dataset_load.py, with invented rows only."""
import datetime
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import dataset_load as dl  # noqa: E402

HEAD = ["Company Name", "Proper Format", "Service Offered", "Zone Applied", "License Number ", "License Date", "Expiry Date", "Shareholder ", "Manager", "Leasd Source", "VISA", "Remarks", "KYC Form ", "Comment ", "Commssion status", "CT Reg ", "Visa Utilised"]
D = datetime.datetime


def sheet(tmp_path, *rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([None] * 18)
    ws.append([None] + HEAD)
    for r in rows:
        ws.append([None] + r)
    p = tmp_path / "s.xlsx"
    wb.save(p)
    return dl.collect(p)


def row(name, **k):
    v = dict(zip(HEAD, [name, name, "Company Registration", "IFZA", 2218174.01, D(2025, 1, 2), D(2026, 1, 1), "A Person", "A Person", None, "1 Visa", None, None, None, None, None, None]))
    v.update(k)
    return [v[h] for h in HEAD]


def test_every_named_row_is_kept_and_blank_rows_are_not(tmp_path):
    rows = sheet(tmp_path, row("One LLC"), [None] * 17, row("Two LLC", **{"License Number ": None, "Shareholder ": " "}))
    assert [r["name"] for r in rows] == ["One LLC", "Two LLC"]
    assert "licence_number" not in rows[1]["payload"] and "shareholder" not in rows[1]["payload"]


def test_kyc_is_done_on_every_row(tmp_path):
    rows = sheet(tmp_path, row("One LLC", **{"KYC Form ": "N/A"}), row("Two LLC"))
    assert {r["payload"]["kyc_form"] for r in rows} == {"Done"}
    assert rows[0]["payload"]["kyc_form_sheet"] == "N/A"


def test_licence_numbers_stay_as_written(tmp_path):
    rows = sheet(tmp_path, row("A LLC"), row("B LLC", **{"License Number ": 1747}), row("C LLC", **{"License Number ": "DMCC- 956940"}), row("D LLC", **{"License Number ": "Under Liquidation"}))
    assert rows[0]["payload"]["licence_number"] == "2218174.01"
    assert rows[1]["payload"]["licence_number"] == "1747"
    assert rows[2]["payload"]["licence_number"] == "DMCC- 956940"
    assert "licence_number" not in rows[3]["payload"] and rows[3]["payload"]["client_status"] == "Liquidated"


def test_text_dates_and_words_in_date_cells(tmp_path):
    rows = sheet(tmp_path, row("A LLC", **{"License Date": "18/08/2026", "Expiry Date": "17/08/2027"}), row("B LLC", **{"License Date": "Liquidated", "Expiry Date": "Liquidated"}))
    assert rows[0]["payload"]["licence_issue"] == "2026-08-18" and rows[0]["payload"]["licence_expiry"] == "2027-08-17"
    assert "dates_to_check" not in rows[0]["payload"]
    assert "licence_expiry" not in rows[1]["payload"] and rows[1]["payload"]["client_status"] == "Liquidated"


def test_odd_dates_are_captured_as_written_and_flagged(tmp_path):
    rows = sheet(tmp_path, row("A LLC", **{"License Date": D(2026, 2, 27), "Expiry Date": D(2026, 2, 26)}), row("B LLC", **{"License Date": D(2026, 9, 1), "Expiry Date": D(2027, 8, 1)}), row("C LLC", **{"License Date": D(2024, 2, 29), "Expiry Date": D(2027, 2, 28)}))
    assert rows[0]["payload"]["licence_expiry"] == "2026-02-26" and rows[0]["payload"]["dates_to_check"] is True
    assert rows[1]["payload"]["licence_issue"] == "2026-09-01" and rows[1]["payload"]["dates_to_check"] is True
    assert "dates_to_check" not in rows[2]["payload"]


def test_status_from_remarks_and_same_name_twice(tmp_path):
    rows = sheet(tmp_path, row("A LLC", Remarks="Cancelled"), row("B LLC", Remarks="Idenfo"), row("B L.L.C", Remarks="Rejected"))
    assert [r["payload"]["client_status"] for r in rows] == ["Cancelled", "Active", "Rejected"]
    assert rows[1]["source_key"] != rows[2]["source_key"]


def test_a_zone_no_map_knows_is_kept(tmp_path):
    rows = sheet(tmp_path, row("A LLC", **{"Zone Applied": "Somewhere New"}), row("B LLC", **{"Zone Applied": "DET"}))
    assert rows[0]["payload"]["jurisdiction"] == "Somewhere New"
    assert rows[1]["payload"]["jurisdiction"] == "Dubai Mainland" and rows[1]["payload"]["zone_as_written"] == "DET"
