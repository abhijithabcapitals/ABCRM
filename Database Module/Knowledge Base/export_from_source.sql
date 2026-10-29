-- Knowledge Base export (READ-ONLY).
-- Run in the Supabase SQL Editor of the project that holds the articles
-- (Rahul's live CRM). It only SELECTs; nothing in that project changes.
-- Copy the single "knowledge_base" cell and save it as
-- Database Module/Knowledge Base/data/knowledge_base_export.json
select json_build_object(
  'exported_at',      now(),
  'wiki_categories',  (select coalesce(json_agg(c order by c.category_order nulls last), '[]'::json) from public.wiki_categories c),
  'wiki_articles',    (select coalesce(json_agg(a order by a.title), '[]'::json) from public.wiki_articles a),
  'wiki_history',     (select coalesce(json_agg(h order by h.changed_at), '[]'::json) from public.wiki_history h),
  'wiki_attachments', (select coalesce(json_agg(t order by t.uploaded_at), '[]'::json) from public.wiki_attachments t)
) as knowledge_base;
