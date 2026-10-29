"""Tax compliance rules (clientmodule/tax.py) with a fixed date and fictional clients."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from clientmodule.master import VR_SUFFIX  # noqa: E402
from clientmodule.tax import compliance, vat_period_end_months  # noqa: E402

TODAY = date(2026, 10, 29)


def items(rec, today=TODAY):
    base = {"Client ID": "CL000001", "Client Legal Name": "Sample Trading LLC"}
    return compliance([{**base, **rec}], today)["items"]


def find(its, title):
    return next(i for i in its if i["title"] == title)


def test_unrecorded_registrations_are_missing_not_guessed():
    its = items({})
    titles = {i["title"]: i["status"] for i in its}
    assert titles["VAT registration status not recorded"] == "missing"
    assert titles["Corporate Tax registration status not recorded"] == "missing"
    assert all(i["dueDate"] == "" for i in its)


def test_quarterly_vat_due_28_days_after_period_end():
    its = items({"VAT Registered": "Yes", "TRN": "100000000000003", "VAT Filing Frequency": "Quarterly",
                 "VAT Tax Period": "Feb-Apr / May-Jul / Aug-Oct / Nov-Jan"})
    vat = find(its, "VAT return & payment")
    assert vat["period"] == "Period ending 31/10/2026"
    assert vat["dueDate"] == "28/11/2026"
    assert vat["status"] == "due_30" and vat["computed"] is True
    # July period was due 28/08 - more than a month ago, so no "confirm filed" noise for it
    assert not any(i["title"] == "VAT return – confirm filed" for i in its)


def test_monthly_vat_recent_due_date_asks_to_confirm_filing():
    its = items({"VAT Registered": "Yes", "TRN": "100000000000003", "VAT Filing Frequency": "Monthly",
                 "VAT Tax Period": "Monthly"})
    confirm = find(its, "VAT return – confirm filed")
    assert confirm["dueDate"] == "28/10/2026" and confirm["status"] == "review"
    nxt = find(its, "VAT return & payment")
    assert nxt["dueDate"] == "28/11/2026"


def test_vat_without_trn_or_clear_period_is_flagged():
    its = items({"VAT Registered": "Yes", "VAT Filing Frequency": "Quarterly", "VAT Tax Period": "Not Provided"})
    titles = {i["title"] for i in its}
    assert {"VAT TRN missing", "VAT tax period unclear"} <= titles
    assert "VAT return & payment" not in titles


def test_inconsistent_quarters_are_not_guessed():
    assert vat_period_end_months("Quarterly", "Jan-Mar / May-Jul") is None
    assert vat_period_end_months("Quarterly", "Jan-Mar") == [3, 6, 9, 12]
    assert vat_period_end_months("Other", "Jan-Mar") is None


def test_confirmed_vat_due_date_wins():
    its = items({"VAT Registered": "Yes", "TRN": "100000000000003", "VAT Return Due Date": "15/11/2026",
                 "VAT Filing Frequency": "Quarterly", "VAT Tax Period": "Feb-Apr / May-Jul / Aug-Oct / Nov-Jan"})
    vat = find(its, "VAT return & payment")
    assert vat["dueDate"] == "15/11/2026" and vat["computed"] is False


def test_ct_return_nine_months_after_financial_year():
    its = items({"Corporate Tax Registered": "Yes", "CT Registration Number": "100000000000003",
                 "Financial Year": "01/01 - 31/12"})
    ct = find(its, "Corporate Tax return & payment")
    assert ct["period"] == "Tax period ending 31/12/2025"
    assert ct["dueDate"] == "30/09/2026" and ct["status"] == "overdue"


def test_ct_filed_is_done_and_first_period_rule():
    filed = items({"Corporate Tax Registered": "Yes", "CT Registration Number": "1", "Financial Year": "01/01 - 31/12",
                   "CT Return Status": "Filed"})
    assert find(filed, "Corporate Tax return & payment")["status"] == "done"
    # financial year ending 31/03/2024 is before the first CT period - no return item
    early = items({"Corporate Tax Registered": "Yes", "CT Registration Number": "1",
                   "CT Tax Period": "01/04/2023 - 31/03/2024"})
    assert not any(i["title"] == "Corporate Tax return & payment" for i in early)


def test_ct_not_registered_and_missing_number():
    assert find(items({"Corporate Tax Registered": "No"}), "Corporate Tax registration needed?")["status"] == "review"
    its = items({"Corporate Tax Registered": "Yes", "Financial Year": "01/01 - 31/12"})
    assert find(its, "CT registration number missing")["status"] == "missing"


def test_licence_and_engagement_renewals():
    its = items({"License Expiry Date": "10/11/2026", "Renewal Date": "01/10/2026",
                 "Trade License Number": "12345"})
    lic = find(its, "Trade licence renewal")
    assert lic["status"] == "due_14" and lic["daysLeft"] == 12
    assert find(its, "Engagement renewal")["status"] == "overdue"
    missing = items({"Trade License Number": "12345"})
    assert find(missing, "Trade licence expiry date missing")["status"] == "missing"


def test_verification_required_values_are_marked():
    its = items({"License Expiry Date": "10/12/2026" + VR_SUFFIX})
    assert find(its, "Trade licence renewal")["verify"] is True


def test_sorted_by_urgency_and_api(tmp_path):
    from fastapi.testclient import TestClient
    from clientmodule.api import create_app
    from clientmodule.config import Settings

    s = Settings.load(storage_root=tmp_path, data_dir=tmp_path / "data", ai_enabled=False)
    s.data_dir.mkdir(parents=True, exist_ok=True)
    c = TestClient(create_app(s))
    r = c.get("/api/tax-compliance")
    assert r.status_code == 200 and r.json()["clientsChecked"] == 0
    assert c.get("/tax").status_code == 200

    its = compliance([
        {"Client ID": "CL1", "Client Legal Name": "B", "License Expiry Date": "01/01/2027"},
        {"Client ID": "CL2", "Client Legal Name": "A", "License Expiry Date": "01/10/2026"},
    ], TODAY)["items"]
    order = [i["status"] for i in its]
    assert order.index("overdue") < order.index("upcoming") < order.index("missing")
