-- The "new update" alert asks managers to review. Once a manager verifies, the job is done, so it closes.
-- 010's verify, plus closing that alert. Updates that are never verified keep the alert until a person resolves it.
create or replace function public.regulatory_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status <> 'List proposed' then raise exception 'Propose the client list first.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  if nullif(btrim(v_u.official_url), '') is null then raise exception 'Add the official source first.'; end if;
  if v_u.evidence_level = 'E4' then raise exception 'A third-party source stays information only. Find the official document first.'; end if;
  if v_u.legal_status in ('PROPOSED', 'UNDER CONSULTATION', 'UNVERIFIED') then raise exception 'This status is not yet law, so it stays information only.'; end if;
  if exists (select 1 from regulatory_update_clients where update_id = p_id and decision = 'Check') then raise exception 'Decide every client marked Check first.'; end if;
  update regulatory_updates set workflow_status = 'Verified', verified_by = auth.uid(), verified_at = now(), updated_at = now() where id = p_id;

  with closed as (
    update alerts set status = 'Resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'Update verified by a manager.', updated_at = now()
    where dedupe_key = 'regulatory:new:' || p_id and status in ('Open', 'In progress')
    returning id
  )
  insert into alert_events (alert_id, event, detail, created_by)
  select id, 'resolved', jsonb_build_object('note', 'Update verified by a manager.'), auth.uid() from closed;
end $$;
