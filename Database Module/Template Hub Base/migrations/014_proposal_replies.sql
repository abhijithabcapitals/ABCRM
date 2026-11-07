-- =====================================================================
-- Template Hub Base - Proposal replies                                014
-- =====================================================================
-- The client's reply to a shared Business Formation Proposal: the option they chose, that they accept or decline it, or a comment.
-- The client records it in the Client Portal, or a CRM user records it from the Proposals list (for a lead too: a proposal without a
-- client). Both write to the same proposal: a chosen option is set on the quote itself (field_values.proposal.accepted_option, lines,
-- services and total, as hub_proposal_choose does), and every reply is one row of hub_proposal_replies on that quote. The formal
-- decisions stay where they were (business_setup_acceptances, through the portal's Accept and Reject or a confirmed signed copy);
-- the screens read them beside the replies as the same line of activity. Nothing is copied.
-- Run after 009 and Business Setup 010-024. Re-runnable. Undo with rollback/014_rollback.sql.
-- =====================================================================
do $$
begin
  if to_regprocedure('public.hub_proposal_choose(jsonb)') is null then raise exception 'Run Template Hub 009 (009_proposals.sql) first'; end if;
  if to_regprocedure('public.business_setup_portal_client(uuid)') is null then raise exception 'Run the Business Setup portal migrations (010, 018) first'; end if;
end $$;

create table if not exists public.hub_proposal_replies (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.hub_documents(id) on delete cascade,
  kind text not null check (kind in ('option', 'accepted', 'declined', 'comment')),
  option_index int check (option_index is null or option_index >= 0),
  comment text check (comment is null or length(comment) <= 1000),
  source text not null check (source in ('Portal', 'Staff')),
  account_id uuid,
  username text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (kind not in ('option', 'accepted') or option_index is not null),
  check (kind <> 'comment' or comment is not null)
);
create index if not exists hub_proposal_replies_quote on public.hub_proposal_replies (quote_id, created_at);
alter table public.hub_proposal_replies enable row level security;
revoke all on public.hub_proposal_replies from public, anon, authenticated;
grant select on public.hub_proposal_replies to authenticated;
-- Who may read Business Setup decisions may read the replies (as business_setup_acceptances_read).
drop policy if exists hub_proposal_replies_read on public.hub_proposal_replies;
create policy hub_proposal_replies_read on public.hub_proposal_replies for select to authenticated using (business_setup_can('setup.access'));

-- Records one reply on a locked proposal. A chosen or accepted option is set on the quote while it is issued, as hub_proposal_choose does.
-- p: { kind, option?, comment? }. Callers check who may reply; this checks the reply.
create or replace function public.hub_proposal_reply_body(p_quote uuid, p jsonb, p_source text, p_account uuid, p_username text, p_user uuid)
returns public.hub_proposal_replies
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; r hub_proposal_replies; v_kind text := btrim(coalesce(p ->> 'kind', '')); v_comment text := nullif(btrim(coalesce(p ->> 'comment', '')), '');
  v_opt int; v_o jsonb; v_n int;
begin
  select * into q from hub_documents where id = p_quote and doc_type = 'quote' and library_template = 'AB Capital/Proposal' for update;
  if q.id is null then raise exception 'The proposal was not found'; end if;
  if v_kind not in ('option', 'accepted', 'declined', 'comment') then raise exception 'Choose the reply: an option, accepted, declined or a comment'; end if;
  if v_comment is not null and length(v_comment) > 1000 then raise exception 'Keep the comment to 1000 characters'; end if;
  if v_kind = 'comment' and v_comment is null then raise exception 'Write the comment'; end if;
  if q.status = 'superseded' then raise exception 'Proposal % was replaced by a newer one', q.document_number; end if;
  v_n := coalesce(jsonb_array_length(case when jsonb_typeof(q.field_values #> '{proposal,options}') = 'array' then q.field_values #> '{proposal,options}' end), 0);
  if v_kind in ('option', 'accepted') then
    if nullif(btrim(coalesce(p ->> 'option', '')), '') is null and v_n = 1 then v_opt := 0;
    elsif coalesce(btrim(p ->> 'option'), '') ~ '^[0-9]{1,3}$' then v_opt := btrim(p ->> 'option')::int;
    else raise exception 'Choose the option'; end if;
    v_o := q.field_values #> array['proposal', 'options', v_opt::text];
    if v_o is null or jsonb_typeof(v_o) <> 'object' then raise exception 'Choose the option'; end if;
    if (q.field_values #>> '{proposal,accepted_option}') is distinct from v_opt::text then
      if q.status <> 'issued' then raise exception 'Proposal % is % and its option cannot change', q.document_number, q.status; end if;
      update hub_documents set field_values = jsonb_set(field_values, '{proposal,accepted_option}', to_jsonb(v_opt)), lines = hub_proposal_lines(v_o),
             services = array(select s ->> 'name' from jsonb_array_elements(v_o -> 'services') s), total_amount = hub_proposal_total(v_o)
       where id = q.id;
      perform business_setup_audit('hub_documents', q.id::text, 'proposal_choose',
              jsonb_build_object('accepted_option', q.field_values #> '{proposal,accepted_option}', 'total_amount', q.total_amount),
              jsonb_build_object('accepted_option', v_opt, 'total_amount', hub_proposal_total(v_o), 'source', p_source));
    end if;
  elsif v_kind = 'declined' and q.status <> 'issued' then
    raise exception 'Proposal % is % and cannot be declined', q.document_number, q.status;
  end if;
  insert into hub_proposal_replies (quote_id, kind, option_index, comment, source, account_id, username, created_by)
  values (q.id, v_kind, v_opt, v_comment, p_source, p_account, p_username, p_user) returning * into r;
  return r;
end $$;
revoke all on function public.hub_proposal_reply_body(uuid, jsonb, text, uuid, text, uuid) from public, anon, authenticated;

-- A CRM user records the client's or lead's reply. p: { quote_id, kind, option?, comment? }. A proposal without a client takes replies too.
create or replace function public.hub_proposal_reply(p jsonb) returns public.hub_proposal_replies
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform business_setup_require('setup.quotes.manage');
  return hub_proposal_reply_body(hub_proposal_ref(p ->> 'quote_id'), p, 'Staff', null, null, auth.uid());
end $$;
revoke all on function public.hub_proposal_reply(jsonb) from public, anon;
grant execute on function public.hub_proposal_reply(jsonb) to authenticated;

-- Whether the client can still reply in the portal: issued, not expired, no decision yet, case not closed.
create or replace function public.hub_proposal_portal_open(q public.hub_documents) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select q.status = 'issued' and not (q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date)
     and not exists (select 1 from business_setup_acceptances a where a.document_id = q.id)
     and not exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled'))
$$;
revoke all on function public.hub_proposal_portal_open(public.hub_documents) from public, anon, authenticated;

-- The client's own proposals with every option and the replies on them. Called by the client-portal Edge Function (service role) with the session's account.
-- A staff-recorded reply shows its kind and option, never its comment: staff words do not reach the client.
create or replace function public.business_setup_portal_proposals(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account);
begin
  if v_client is null or not exists (select 1 from client_portal_accounts where id = p_account and status = 'active') then raise exception 'Please sign in again.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.document_number, 'date', q.created_at::date, 'status', q.status, 'has_file', q.storage_path is not null,
            'valid_until', q.valid_until, 'chosen', (q.field_values #>> '{proposal,accepted_option}')::int, 'can_reply', hub_proposal_portal_open(q),
            'options', (select coalesce(jsonb_agg(jsonb_build_object('index', o.i - 1, 'authority', coalesce(o.v ->> 'authority_name', o.v ->> 'authority_key'), 'activity', o.v ->> 'activity',
                          'title', o.v ->> 'title', 'total', hub_proposal_total(o.v)) order by o.i), '[]'::jsonb)
                          from jsonb_array_elements(case when jsonb_typeof(q.field_values #> '{proposal,options}') = 'array' then q.field_values #> '{proposal,options}' else '[]'::jsonb end) with ordinality o(v, i)),
            'replies', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'option', r.option_index, 'comment', case when r.source = 'Portal' then r.comment end,
                          'source', r.source, 'date', r.created_at) order by r.created_at), '[]'::jsonb) from hub_proposal_replies r where r.quote_id = q.id),
            'decision', (select jsonb_build_object('decision', a.decision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                           from business_setup_acceptances a where a.document_id = q.id order by a.created_at desc limit 1)) order by q.created_at desc), '[]'::jsonb)
            from hub_documents q
           where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.library_template = 'AB Capital/Proposal'
             and q.status in ('issued', 'accepted', 'rejected'));
end $$;
revoke all on function public.business_setup_portal_proposals(uuid) from public, anon, authenticated;

-- The client replies in the portal: chooses an option or comments. Accept and Reject stay with business_setup_portal_decide (setup_decide),
-- so a formal decision is recorded once. p: { kind: option | comment, option?, comment? }.
create or replace function public.business_setup_portal_proposal_reply(p_account uuid, p_document uuid, p jsonb) returns public.hub_proposal_replies
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account); a client_portal_accounts; q hub_documents;
begin
  select * into a from client_portal_accounts where id = p_account;
  if a.id is null or a.status <> 'active' or v_client is null then raise exception 'Please sign in again.'; end if;
  select * into q from hub_documents where id = p_document for update;
  if q.id is null or q.department <> 'Business Setup' or q.doc_type <> 'quote' or coalesce(q.library_template, '') <> 'AB Capital/Proposal' or q.client_id is distinct from v_client then
    raise exception 'Proposal not found.';
  end if;
  if coalesce(p ->> 'kind', '') not in ('option', 'comment') then raise exception 'Choose an option or write a comment.'; end if;
  if not hub_proposal_portal_open(q) then raise exception 'This proposal is no longer open for a reply. Please contact AB Capital Services FZE.'; end if;
  return hub_proposal_reply_body(q.id, p, 'Portal', a.id, a.username, null);
end $$;
revoke all on function public.business_setup_portal_proposal_reply(uuid, uuid, jsonb) from public, anon, authenticated;
