"""Turn data/knowledge_base_export.json into data/knowledge_base_import.sql.

The SQL inserts the categories, articles, history and attachment records into
the CRM database. Rows that already exist (same id) are left untouched, so it
is safe to run more than once. Articles that point at a space or folder that
does not exist in the target database are kept, with that link cleared.

    python build_import_sql.py [export.json] [output.sql]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TABLES = ["wiki_categories", "wiki_articles", "wiki_history", "wiki_attachments"]


def dollar_quote(text):
    tag = "kb"
    while f"${tag}$" in text:
        tag += "x"
    return f"${tag}${text}${tag}$"


def build(export):
    missing = [t for t in TABLES if t not in export]
    if missing:
        raise SystemExit(f"Export is missing: {', '.join(missing)}. Re-run export_from_source.sql.")
    out = [
        f"-- Knowledge Base import, generated from an export taken {export.get('exported_at', 'unknown')}",
        f"-- {', '.join(f'{len(export[t])} {t}' for t in TABLES)}",
        "begin;",
    ]
    for table in TABLES:
        data = dollar_quote(json.dumps(export[table], ensure_ascii=False))
        rows = f"jsonb_populate_recordset(null::public.{table}, {data}::jsonb)"
        if table == "wiki_articles":
            select = (
                "select r.id, case when exists (select 1 from public.spaces s where s.id = r.space_id) then r.space_id end, "
                "r.title, r.content, r.updated_at, r.category_id, r.updated_by, r.deleted_at, r.deleted_by, "
                "case when exists (select 1 from public.folders f where f.id = r.folder_id) then r.folder_id end "
                f"from {rows} r"
            )
            cols = "(id, space_id, title, content, updated_at, category_id, updated_by, deleted_at, deleted_by, folder_id)"
        else:
            select, cols = f"select * from {rows}", ""
        out.append(f"insert into public.{table} {cols}\n{select}\non conflict (id) do nothing;")
    out.append("commit;")
    return "\n\n".join(out) + "\n"


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "data" / "knowledge_base_export.json"
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "data" / "knowledge_base_import.sql"
    text = src.read_text(encoding="utf-8-sig").strip()
    export = json.loads(text)
    if isinstance(export, list):  # a copied result row: [{"knowledge_base": {...}}]
        export = export[0]
    if "knowledge_base" in export:
        export = export["knowledge_base"]
    if isinstance(export, str):
        export = json.loads(export)
    dst.write_text(build(export), encoding="utf-8")
    print(f"Wrote {dst} ({', '.join(f'{len(export[t])} {t}' for t in TABLES)})")


if __name__ == "__main__":
    main()
