-- Undoes 001_communication_links.sql. Nothing else depends on these objects.
drop table if exists public.crm_communication_links;
drop function if exists public.crm_link_parent_visible(text, text);
