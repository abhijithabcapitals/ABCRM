-- LOCAL TEST ONLY. Proposal replies (014): the client in the portal and a CRM user write to the same proposal.
\set ON_ERROR_STOP on
\set quoter '00000000-0000-0000-0000-0000000000b2'
\set outsider '00000000-0000-0000-0000-0000000000b4'

select at_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL950140', 'Reply Client LLC', '{}') on conflict do nothing;
insert into public.client_master (client_id, legal_name, data) values ('CL950141', 'Other Client LLC', '{}') on conflict do nothing;
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL950140', 'R', 'portal.r140', 'x'), ('CL950141', 'O', 'portal.o140', 'x');
select id as acc from client_portal_accounts where username = 'portal.r140' \gset
select id as other from client_portal_accounts where username = 'portal.o140' \gset

select at_as(:'quoter');
select id as pr from hub_proposal_create(at_prop('{"client_id": "CL950140"}')) \gset
select id as lead from hub_proposal_create(at_prop()) \gset
select id as one from hub_proposal_create(at_prop('{"client_id": "CL950140"}', '{"usd_rate": 3.6725, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": 7}]}]}')) \gset

-- ── CRM side ──────────────────────────────────────────────────────────
select (kind = 'option' and option_index = 1 and source = 'Staff' and created_by = :'quoter'::uuid) as r1 from hub_proposal_reply(jsonb_build_object('quote_id', :'lead', 'kind', 'option', 'option', 1)) \gset
select at_check('staff records a lead''s chosen option on a proposal with no client', :'r1'::boolean
  and (select client_id is null and field_values #>> '{proposal,accepted_option}' = '1' and total_amount = 900 and services = array['Package'] from hub_documents where id = :'lead'));
select at_check('staff records a lead''s comment', (select kind = 'comment' and comment = 'Wants a second visa' from hub_proposal_reply(jsonb_build_object('quote_id', :'lead', 'kind', 'comment', 'comment', ' Wants a second visa '))));
select (option_index = 0) as r2 from hub_proposal_reply(jsonb_build_object('quote_id', :'lead', 'kind', 'accepted', 'option', 0)) \gset
select at_check('staff records that the lead accepted option 1, which sets the option back', :'r2'::boolean
  and (select field_values #>> '{proposal,accepted_option}' = '0' and total_amount = 100 and status = 'issued' from hub_documents where id = :'lead'));
select at_check('staff records a decline without a comment', (select kind = 'declined' and comment is null from hub_proposal_reply(jsonb_build_object('quote_id', :'lead', 'kind', 'declined'))));
select at_check('a single-option proposal needs no option index', (select option_index = 0 from hub_proposal_reply(jsonb_build_object('quote_id', :'one', 'kind', 'accepted'))));
select at_check('an empty comment is refused', at_refused(format($f$select hub_proposal_reply('{"quote_id": "%s", "kind": "comment", "comment": " "}')$f$, :'lead'), 'Write the comment'));
select at_check('an unknown option is refused', at_refused(format($f$select hub_proposal_reply('{"quote_id": "%s", "kind": "option", "option": 5}')$f$, :'lead'), 'Choose the option'));
select at_check('an unknown kind is refused', at_refused(format($f$select hub_proposal_reply('{"quote_id": "%s", "kind": "maybe"}')$f$, :'lead'), 'Choose the reply'));
select at_check('an ordinary quote is refused', at_refused($f$select hub_proposal_reply('{"quote_id": "00000000-0000-0000-0000-000000000000", "kind": "declined"}')$f$, 'not found'));
select at_check('staff cannot write the table directly', at_refused(format($f$insert into hub_proposal_replies (quote_id, kind, source) values ('%s', 'declined', 'Staff')$f$, :'lead'), 'permission'));
select at_as(:'outsider');
select at_check('an outsider cannot record a reply', at_refused(format($f$select hub_proposal_reply('{"quote_id": "%s", "kind": "declined"}')$f$, :'lead'), 'permission'));
select at_check('an outsider cannot call the portal functions', at_refused(format($f$select business_setup_portal_proposals(%L::uuid)$f$, :'acc'), 'permission'));

-- ── Portal side ───────────────────────────────────────────────────────
select at_as(null);
create or replace function pg_temp.pp(p_acc uuid, p_quote uuid) returns jsonb language sql security definer as $$
  select e from jsonb_array_elements(public.business_setup_portal_proposals(p_acc)) e where e ->> 'id' = p_quote::text $$;
select at_check('the portal lists an undecided proposal with every option',
  (select jsonb_array_length(e -> 'options') = 2 and (e ->> 'can_reply')::boolean and e ->> 'chosen' is null
     and (e #>> '{options,1,total}')::numeric = 900 and e #>> '{options,0,authority}' = 'Zone A' from pg_temp.pp(:'acc'::uuid, :'pr'::uuid) e));
select at_check('the portal does not list a lead''s or another client''s proposal',
  pg_temp.pp(:'acc'::uuid, :'lead'::uuid) is null and pg_temp.pp(:'other'::uuid, :'pr'::uuid) is null);
select (kind = 'option' and option_index = 1 and source = 'Portal' and account_id = :'acc'::uuid and username = 'portal.r140') as r3
  from business_setup_portal_proposal_reply(:'acc'::uuid, :'pr'::uuid, '{"kind": "option", "option": 1, "comment": "Prefer the trading licence"}') \gset
select at_check('the client chooses option 2 in the portal', :'r3'::boolean
  and (select field_values #>> '{proposal,accepted_option}' = '1' and total_amount = 900 from hub_documents where id = :'pr'));
select at_check('the client comments in the portal', (select kind = 'comment' from business_setup_portal_proposal_reply(:'acc'::uuid, :'pr'::uuid, '{"kind": "comment", "comment": "Call me Sunday"}')));
select at_check('the portal cannot record accepted or declined through the reply',
  at_refused(format($f$select business_setup_portal_proposal_reply(%L::uuid, %L::uuid, '{"kind": "accepted", "option": 1}')$f$, :'acc', :'pr'), 'Choose an option or write a comment'));
select at_check('another client cannot reply', at_refused(format($f$select business_setup_portal_proposal_reply(%L::uuid, %L::uuid, '{"kind": "comment", "comment": "x"}')$f$, :'other', :'pr'), 'Proposal not found'));
select at_as(:'quoter');
select hub_proposal_reply(jsonb_build_object('quote_id', :'pr', 'kind', 'comment', 'comment', 'Staff only note')) is not null as staff_note \gset
select at_as(null);
select at_check('one line of activity: portal and staff replies on the same proposal, in order',
  (select array_agg(source || ':' || kind order by created_at) = array['Portal:option', 'Portal:comment', 'Staff:comment'] from hub_proposal_replies where quote_id = :'pr'));
select at_check('the client sees its own comments and never a staff comment',
  (select bool_and(case when r ->> 'source' = 'Staff' then r ->> 'comment' is null else r ->> 'comment' is not null end) and jsonb_array_length(e -> 'replies') = 3 and (e ->> 'chosen')::int = 1
     from pg_temp.pp(:'acc'::uuid, :'pr'::uuid) e, jsonb_array_elements(e -> 'replies') r group by e));
select at_check('the chosen proposal now shows in the portal quotes, ready for Accept',
  exists (select 1 from jsonb_array_elements(business_setup_portal_view(:'acc'::uuid) -> 'quotes') e where e ->> 'id' = :'pr' and (e ->> 'can_decide')::boolean));
select business_setup_portal_decide(:'acc'::uuid, :'pr'::uuid, 'Rejected', 'Too expensive');
select at_check('after a decision the portal closes replies and shows the decision',
  (select not (e ->> 'can_reply')::boolean and e #>> '{decision,decision}' = 'Rejected' and e #>> '{decision,note}' = 'Too expensive' from pg_temp.pp(:'acc'::uuid, :'pr'::uuid) e)
  and at_refused(format($f$select business_setup_portal_proposal_reply(%L::uuid, %L::uuid, '{"kind": "comment", "comment": "x"}')$f$, :'acc', :'pr'), 'no longer open'));
