"""Tests for scripts/visa_load.py, with invented rows only."""
import datetime
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import visa_load as vl  # noqa: E402

HEAD = ["Name", "Company Name", "Visa Title (Occupation)", "Visa Issue Date", "Visa Expiry Date", "2026 Updates"]
D = datetime.datetime


def sheet(tmp_path, *rows, links=None):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEAD)
    for r in rows:
        ws.append(r)
    p = tmp_path / "v.xlsx"
    wb.save(p)
    return vl.collect(p, links)


def test_rows_are_captured_as_written(tmp_path):
    [r] = sheet(tmp_path, ["A Person ", "One LLC", "PARTNER", D(2025, 1, 2), D(2027, 1, 1), "re-applying "])
    assert (r["person"], r["company"], r["occupation"], r["issue_date"], r["expiry_date"], r["update"]) == ("A Person", "One LLC", "PARTNER", "2025-01-02", "2027-01-01", "re-applying")


def test_no_dates_stay_blank_and_blank_rows_are_dropped(tmp_path):
    rows = sheet(tmp_path, ["A", "One LLC", "NEEDS TO ENTER THE UAE", None, None, None], [None, None, None, None, None, None], ["B", None, "PARTNER", None, None, None])
    assert len(rows) == 1 and rows[0]["issue_date"] is None and rows[0]["expiry_date"] is None


def test_same_person_under_two_companies_is_two_visas(tmp_path):
    rows = sheet(tmp_path, ["A", "One LLC", "PARTNER", None, None, None], ["A", "Two LLC", "PARTNER", None, None, None], ["A", "One L.L.C", "CARPENTER", None, None, None])
    assert len({r["source_key"] for r in rows}) == 3


def test_a_hand_link_matches_the_name_however_it_is_spelled(tmp_path):
    rows = sheet(tmp_path, ["A", "ONE TRADING L.L.C", "PARTNER", None, None, None], ["B", "Other LLC", "PARTNER", None, None, None], links={"One Trading LLC": "CL000001"})
    assert rows[0]["client_id"] == "CL000001" and rows[1]["client_id"] is None
