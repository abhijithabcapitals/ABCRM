-- Undoes 001_knowledge.sql. Remove the 'knowledge' tab grants first. Nothing else depends on these objects.
drop view if exists public.v_knowledge_search;
drop function if exists public.knowledge_banking_prices();
drop function if exists public.knowledge_price_line_review();
drop table if exists public.knowledge_price_lines;
drop table if exists public.knowledge_entries;
drop table if exists public.knowledge_categories;
drop function if exists public.knowledge_touch();
