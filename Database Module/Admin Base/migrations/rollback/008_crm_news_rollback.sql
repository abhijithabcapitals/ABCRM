-- Undoes 008_crm_news.sql. This deletes every published headline.

begin;

alter publication supabase_realtime drop table public.crm_news;
drop table public.crm_news;

commit;
