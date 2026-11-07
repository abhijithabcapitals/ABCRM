-- Undoes migrations/014_proposal_replies.sql. Run first, before 013_rollback.sql.
-- The replies are removed. A chosen option already set on a proposal stays on it (it is 009's field, also set by hub_proposal_choose).
drop function if exists public.business_setup_portal_proposal_reply(uuid, uuid, jsonb);
drop function if exists public.business_setup_portal_proposals(uuid);
drop function if exists public.hub_proposal_portal_open(public.hub_documents);
drop function if exists public.hub_proposal_reply(jsonb);
drop function if exists public.hub_proposal_reply_body(uuid, jsonb, text, uuid, text, uuid);
drop table if exists public.hub_proposal_replies;
