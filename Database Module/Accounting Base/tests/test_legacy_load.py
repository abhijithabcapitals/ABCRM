"""Tests for scripts/legacy_load.py. Fixtures use invented names only.

    python -m unittest discover -s "Database Module/Accounting Base/tests" -p "test_*.py"
"""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from legacy_load import legacy_key, map_row, mark_repeats, parse_args, main  # noqa: E402

REAL_CSV = r"D:\Abhijith Projects\CRM\Accounting Module\Resources\Accounting_Team_export_all_2026-11-03.csv"


def row(name="Acme LLC", type="CT Filing", status="To Do", created="2026-03-07", done="", due="",
        assignee="", comment="", remarks="", description=""):
    """One export row with every column the importer reads."""
    return {"Task Name": name, "Type of work": type, "Status": status, "Date Created": created, "Date Done": done,
            "Due Date": due, "Assignee": assignee, "Comment (short text)": comment, "Remarks": remarks,
            "Description": description}


class LegacyLoadTest(unittest.TestCase):
    def test_key_ignores_case_and_spaces(self):
        self.assertEqual(legacy_key(" Acme ", "CT Filing", "2026-03-07"), legacy_key("ACME", "CT Filing", "2026-03-07"))

    def test_key_differs_by_type_and_date(self):
        base = legacy_key("Acme", "CT Filing", "2026-03-07")
        self.assertNotEqual(base, legacy_key("Acme", "VAT Refund", "2026-03-07"))
        self.assertNotEqual(base, legacy_key("Acme", "CT Filing", "2026-03-08"))

    def test_type_map(self):
        self.assertEqual(map_row(row(type="CT Filing"))["service_name"], "Corporate Tax Return Filing")
        self.assertEqual(map_row(row(type="TRC"))["service_department"], "Tax Compliance")
        self.assertEqual(map_row(row(type="Audit"))["service_name"], "Audit")
        self.assertEqual(map_row(row(type="Audit"))["service_department"], "Accounting")
        self.assertEqual(map_row(row(type="VAT Refund"))["service_name"], "VAT Refund Assistance")
        self.assertEqual(map_row(row(type="Accounting"))["service_name"], "Accounting Services")

    def test_status_map(self):
        for old in ("To Do", "In Progress", "Client Cancelled"):
            self.assertEqual(map_row(row(status=old))["work_status"], old)

    def test_done_is_completed_untracked(self):
        m = map_row(row(status="Done", done="2026-04-03"))
        self.assertEqual((m["work_status"], m["payment_tracked"], m["completed_at"]), ("Completed", False, "2026-04-03"))

    def test_done_without_date_stays_empty(self):
        self.assertIsNone(map_row(row(status="Done"))["completed_at"])

    def test_open_is_tracked(self):
        self.assertTrue(map_row(row(status="In Progress"))["payment_tracked"])

    def test_dates_are_iso(self):
        m = map_row(row(created="2026-03-07", due="2026-05-01"))
        self.assertEqual((m["created_at"], m["due_date"]), ("2026-03-07", "2026-05-01"))

    def test_remarks_join_and_empty_html(self):
        self.assertEqual(map_row(row(comment="Applied", remarks="", description="<p></p>"))["remarks"], "Applied")
        self.assertIsNone(map_row(row(description="<p></p>"))["remarks"])
        self.assertEqual(map_row(row(comment="A", remarks="B", description="<p>C &amp; D</p>"))["remarks"], "A\nB\nC & D")

    def test_assignees_split_and_alias(self):
        self.assertEqual(map_row(row(assignee="Geo AB Capital, Zed Zee"))["assignees"], ["GEO", "Zed Zee"])
        self.assertEqual(map_row(row(assignee=""))["assignees"], [])

    def test_money_comment_flag(self):
        self.assertTrue(map_row(row(comment="Return filed. Payment pending"))["money_comment"])
        self.assertFalse(map_row(row(comment="Applied"))["money_comment"])

    def test_repeats_hold_both(self):
        self.assertEqual([r["state"] for r in mark_repeats([row(), row()])], ["held", "held"])

    def test_distinct_rows_are_staged(self):
        rows = mark_repeats([row(), row(created="2026-03-08"), row(name="Other Co")])
        self.assertEqual([r["state"] for r in rows], ["staged"] * 3)
        self.assertEqual([r["row_no"] for r in rows], [1, 2, 3])
        self.assertEqual(rows[0]["raw"]["Task Name"], "Acme LLC")
        self.assertEqual(rows[0]["mapped"]["legacy_key"], rows[0]["legacy_key"])

    def test_parse_args(self):
        a = parse_args(["in.csv", "--out", "out.sql"])
        self.assertEqual((a.csv_path, a.out), ("in.csv", "out.sql"))

    def test_main_writes_inserts_and_report(self):
        with tempfile.TemporaryDirectory() as d:
            src, out = os.path.join(d, "in.csv"), os.path.join(d, "out.sql")
            import csv
            with open(src, "w", encoding="utf-8-sig", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(row().keys()))
                w.writeheader()
                w.writerows([row(), row(), row(name="Other Co", comment="Payment pending")])
            buf = io.StringIO()
            with redirect_stdout(buf):
                main([src, "--out", out])
            with open(out, encoding="utf-8") as f:
                sql = f.read()
            self.assertEqual(sql.count("insert into public.accounting_legacy_rows"), 3)
            self.assertIn("'held'", sql)
            self.assertIn("3 rows, 1 staged, 2 held", buf.getvalue())

    @unittest.skipUnless(os.path.exists(REAL_CSV), "git-ignored export not on this machine")
    def test_real_csv_counts(self):
        import csv
        with open(REAL_CSV, encoding="utf-8-sig", newline="") as f:
            rows = mark_repeats(list(csv.DictReader(f)))
        states = [r["state"] for r in rows]
        flagged = [r for r in rows if r["mapped"]["money_comment"]]
        print(f"real csv: {len(rows)} rows, {states.count('staged')} staged, {states.count('held')} held, {len(flagged)} money comments")
        self.assertEqual((len(rows), states.count("staged"), states.count("held")), (118, 116, 2))
        self.assertEqual(len(flagged), 3)


if __name__ == "__main__":
    unittest.main()
