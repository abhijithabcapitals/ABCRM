"""Tests for build_knowledge_import.py. All names and prices here are invented."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_knowledge_import as b  # noqa: E402

HEADER = ("Template", "Group", "Item", "AED", "USD", "Who gets it", "Confidence", "Basis")


def sheet(*lines):
    """A sheet with two title rows and a blank row above the header."""
    return [("Title row",) + (None,) * 7, ("Note",) + (None,) * 7, (None,) * 8, HEADER, *lines]


def line(template="Zone A", group="Licence", item="Fee", aed=100, payee="Zone", conf="High", basis="b"):
    return (template, group, item, aed, 27, payee, conf, basis)


CATS = {"c1": "Business Set Up", "c2": "Banking Team", "c3": "Accounting and Tax Compliances", "c4": "Other"}


def art(id_, title, content="<p>x</p>", cat="c1", deleted=""):
    return {"id": id_, "title": title, "content": content, "category_id": cat, "deleted_at": deleted}


class PriceTests(unittest.TestCase):
    def one(self, row):
        lines, skipped = b.parse_price_rows(sheet(row))
        return lines, skipped

    def test_header_found_by_template_cell(self):
        lines, skipped = self.one(line())
        self.assertEqual(len(lines), 1)
        self.assertEqual(skipped, [])
        self.assertEqual(lines[0]["template"], "Zone A")
        self.assertEqual(lines[0]["line_group"], "Licence")
        self.assertEqual(lines[0]["category"], "Business Setup")

    def test_low_confidence_is_internal(self):
        lines, _ = self.one(line(payee="AB Capital", conf="Low"))
        self.assertEqual(lines[0]["visibility"], "Internal")

    def test_third_party_is_internal(self):
        lines, _ = self.one(line(payee="Third party", conf="High"))
        self.assertEqual(lines[0]["visibility"], "Internal")

    def test_other_lines_are_shareable_draft(self):
        for payee in ("AB Capital", "Zone", "Government", "Government or zone", "Government, approx."):
            lines, _ = self.one(line(payee=payee, conf="Medium"))
            self.assertEqual(lines[0]["visibility"], "Shareable")
            self.assertEqual(lines[0]["status"], "Draft")

    def test_blank_or_text_amount_is_skipped_not_zero(self):
        lines, skipped = b.parse_price_rows(sheet(line(aed=None), line(item="B", aed="on request"), line(item="C", aed=5)))
        self.assertEqual([l["item"] for l in lines], ["C"])
        self.assertEqual(len(skipped), 2)
        self.assertTrue(all(s["reason"] for s in skipped))

    def test_usd_not_imported(self):
        lines, _ = self.one(line())
        self.assertFalse(any("usd" in k.lower() for k in lines[0]))

    def test_source_ref_stable_across_runs(self):
        first, _ = self.one(line())
        second, _ = self.one(line())
        self.assertEqual(first[0]["source_ref"], "study:2026-11-03:Zone A|Licence|Fee")
        self.assertEqual(first[0]["source_ref"], second[0]["source_ref"])

    def test_repeated_price_key_gets_row_number(self):
        lines, _ = b.parse_price_rows(sheet(line(aed=1), line(aed=2)))
        refs = [l["source_ref"] for l in lines]
        self.assertEqual(refs[0], "study:2026-11-03:Zone A|Licence|Fee")
        self.assertEqual(refs[1], "study:2026-11-03:Zone A|Licence|Fee|row 6")
        self.assertEqual(len(set(refs)), 2)

    def test_amount_kept_exact(self):
        lines, _ = self.one(line(aed=1234.5))
        self.assertEqual(str(lines[0]["amount_aed"]), "1234.50")


class ArticleTests(unittest.TestCase):
    def test_deleted_articles_skipped(self):
        entries, skipped, _ = b.parse_articles([art("1", "A"), art("2", "B", deleted="2026-01-01")], CATS)
        self.assertEqual([e["title"] for e in entries], ["A"])
        self.assertEqual(len(skipped), 1)

    def test_articles_all_draft_internal(self):
        entries, _, _ = b.parse_articles([art("abc", "A")], CATS)
        self.assertEqual((entries[0]["status"], entries[0]["visibility"]), ("Draft", "Internal"))
        self.assertEqual(entries[0]["source_ref"], "wiki:abc")

    def test_type_from_title(self):
        entries, _, _ = b.parse_articles(
            [art("1", "Visa DOCUMENTS list"), art("2", "documents"), art("3", "How to apply")], CATS)
        self.assertEqual([e["entry_type"] for e in entries], ["checklist", "checklist", "procedure"])

    def test_category_map(self):
        rows = [art("1", "a", cat="c1"), art("2", "b", cat="c2"), art("3", "c", cat="c3"),
                art("4", "d", cat="c4"), art("5", "e", cat=""), art("6", "f", cat="missing")]
        entries, _, _ = b.parse_articles(rows, CATS)
        self.assertEqual([e["category"] for e in entries],
                         ["Business Setup", "Banking", "Accounting", "General", "General", "General"])

    def test_duplicate_title_keeps_longer_and_reports_both(self):
        rows = [art("1", "Same title", "short"), art("2", "Same title", "a much longer body")]
        entries, skipped, _ = b.parse_articles(rows, CATS)
        self.assertEqual([e["source_ref"] for e in entries], ["wiki:2"])
        self.assertEqual(len(skipped), 1)
        self.assertIn("wiki:1", skipped[0]["reason"])
        self.assertIn("wiki:2", skipped[0]["reason"])

    def test_sponsor_and_price_list_titles_flagged(self):
        rows = [art("1", "Sponsor Visa Cost in X"), art("2", "Services Price List for Y"), art("3", "Other")]
        entries, _, flagged = b.parse_articles(rows, CATS)
        self.assertEqual([f["title"] for f in flagged], ["Sponsor Visa Cost in X", "Services Price List for Y"])
        self.assertTrue(all(e["visibility"] == "Internal" for e in entries))


class SqlTests(unittest.TestCase):
    def build(self):
        lines, _ = b.parse_price_rows(sheet(line(item="Owner's fee")))
        entries, _, _ = b.parse_articles([art("1", "It's a title", "<p>don't</p>")], CATS)
        return b.build_sql(lines, entries)

    def test_sql_sets_client_encoding_before_begin(self):
        sql = self.build()
        self.assertIn("set client_encoding to 'UTF8';", sql)
        self.assertLess(sql.index("set client_encoding to 'UTF8';"), sql.index("begin;"))

    def test_sql_escapes_quotes(self):
        sql = self.build()
        self.assertIn("'Owner''s fee'", sql)
        self.assertIn("'It''s a title'", sql)
        self.assertIn("<p>don''t</p>", sql)

    def test_sql_never_overwrites(self):
        sql = self.build()
        inserts = sql.count("insert into")
        self.assertEqual(inserts, 2)
        self.assertEqual(sql.count("on conflict (source_ref) do nothing"), inserts)
        self.assertNotIn("do update", sql)
        self.assertNotIn("delete from", sql)

    def test_categories_looked_up_by_name(self):
        self.assertIn("select id from public.knowledge_categories where name = 'Business Setup'", self.build())


if __name__ == "__main__":
    unittest.main()
