-- =====================================================================
-- Business Setup Base - Services & Fees grouped by category          025
-- =====================================================================
-- Re-runnable. Runs after 024 (023 is kept for bd_transfer).
-- Services & Fees shows fee items in two levels: Category, then Group. The ten categories are the service list's sections
-- (A to J, 2026-11-05-business-setup-service-checklists.md). Each fee item gets a category:
--   * an item linked to a service checklist takes the checklist's category (for these, grp is already that category);
--   * the five older groups, which hold the agreed fee parts, go under the category the user chose on 2026-11-06;
--   * anything else keeps its group as its category.
-- Only empty categories are filled, so a category staff set later is never overwritten when this file runs again.
-- No item is renamed or repriced. category stays nullable: the screen falls back to the checklist's category, then the group.

alter table public.business_setup_fee_items add column if not exists category text;

update public.business_setup_fee_items f set category = cs.category
  from public.business_setup_checkpoint_sets cs
 where cs.id = f.checkpoint_set_id and f.category is null;

update public.business_setup_fee_items set category = case grp
    when 'Visa processing' then 'Visa & Immigration'
    when 'Visa renewal' then 'Visa & Immigration'
    when 'Visit visa' then 'Visa & Immigration'
    when 'Applications' then 'Trade License & Approvals'
    when 'Mainland' then 'Company Formation'
    else grp end
 where category is null;

-- 015's save, plus category: kept as it is when the key is absent; on a new item it defaults to the group.
create or replace function public.business_setup_fee_item_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_amount numeric; v_rate numeric; v_svc boolean; v_cat text;
begin
  perform business_setup_require('setup.fees.manage');
  p := coalesce(p, '{}'::jsonb);
  -- is_service: true for a service, false for a cost billed to the client. Left as it is when the key is absent.
  if p ? 'is_service' then
    begin v_svc := (p ->> 'is_service')::boolean; exception when others then v_svc := null; end;
    if v_svc is null then raise exception 'Say whether the fee item is a service: yes or no'; end if;
  end if;
  v_amount := nullif(btrim(coalesce(p ->> 'default_amount', '')), '')::numeric;
  if v_amount < 0 then raise exception 'The fee amount cannot be negative'; end if;
  v_rate := nullif(btrim(coalesce(p ->> 'vat_rate', '')), '')::numeric;
  if p ? 'vat_rate' and (v_rate is null or v_rate not in (0, 5)) then raise exception 'The VAT rate must be 0 or 5'; end if;
  if nullif(btrim(coalesce(p ->> 'grp', '')), '') is null then raise exception 'The fee group is required'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'The fee name is required'; end if;
  v_cat := nullif(btrim(coalesce(p ->> 'category', '')), '');
  if p ? 'category' and v_cat is null then raise exception 'The fee category is required'; end if;
  if nullif(p ->> 'id', '') is not null then
    v_id := (p ->> 'id')::uuid;
    update business_setup_fee_items set
        grp = btrim(p ->> 'grp'), name = btrim(p ->> 'name'),
        category = case when p ? 'category' then v_cat else category end,
        default_amount = case when p ? 'default_amount' then v_amount else default_amount end,
        vat_rate = case when p ? 'vat_rate' then v_rate else vat_rate end,
        service_item_id = case when p ? 'service_item_id' then nullif(p ->> 'service_item_id', '')::uuid else service_item_id end,
        active = case when p ? 'active' then coalesce((p ->> 'active')::boolean, active) else active end,
        sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::int, sort_order) else sort_order end,
        is_service = coalesce(v_svc, is_service)
      where id = v_id;
    if not found then raise exception 'Fee item not found'; end if;
  else
    insert into business_setup_fee_items (grp, name, category, default_amount, vat_rate, service_item_id, active, sort_order, is_service)
    values (btrim(p ->> 'grp'), btrim(p ->> 'name'), coalesce(v_cat, btrim(p ->> 'grp')), v_amount, coalesce(v_rate, 5), nullif(p ->> 'service_item_id', '')::uuid,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::int, 0), coalesce(v_svc, true))
    on conflict (grp, name) do update set default_amount = case when p ? 'default_amount' then excluded.default_amount else business_setup_fee_items.default_amount end,
        vat_rate = case when p ? 'vat_rate' then excluded.vat_rate else business_setup_fee_items.vat_rate end,
        service_item_id = coalesce(excluded.service_item_id, business_setup_fee_items.service_item_id),
        category = case when p ? 'category' then excluded.category else coalesce(business_setup_fee_items.category, excluded.category) end,
        active = excluded.active, sort_order = excluded.sort_order, is_service = case when p ? 'is_service' then excluded.is_service else business_setup_fee_items.is_service end
    returning id into v_id;
  end if;
  perform business_setup_audit('business_setup_fee_items', v_id::text, 'fee_item_save', null, jsonb_build_object('grp', p ->> 'grp', 'name', p ->> 'name', 'category', p ->> 'category'));
  return v_id;
end $$;
revoke all on function public.business_setup_fee_item_save(jsonb) from public, anon;
grant execute on function public.business_setup_fee_item_save(jsonb) to authenticated;
