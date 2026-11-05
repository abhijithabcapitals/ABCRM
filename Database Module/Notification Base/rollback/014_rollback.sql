-- Puts regulatory_verify back as 010 had it. Safe to run twice. Runs before rollback/011_013_rollback.sql.
do $$ begin
  if to_regprocedure('public.regulatory_verify(uuid)') is not null then
    execute $f$
create or replace function public.regulatory_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $b$
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
end $b$;
$f$;
  end if;
end $$;
