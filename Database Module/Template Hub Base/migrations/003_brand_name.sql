-- ============================================================================
-- Template Hub Base - brand name in company settings                       003
-- ============================================================================
-- Sets the brand to "AB Capital Services FZE" in the settings that feed new
-- quotations and engagement letters. Only the company and engagement_terms keys
-- change. Documents already issued keep their text, and check-constraint values
-- such as banking_quotation_items.payable_to are left as they are.
-- A second run changes nothing.

begin;

update public.hub_settings
set value = regexp_replace(
      replace(value::text, 'AB CAPITAL SERVICES (FZE)', 'AB CAPITAL SERVICES FZE'),
      'AB Capital(?! Services)', 'AB Capital Services FZE', 'g')::jsonb
where key in ('company', 'engagement_terms');

update public.banking_settings
set value = regexp_replace(
      replace(value::text, 'AB CAPITAL SERVICES (FZE)', 'AB CAPITAL SERVICES FZE'),
      'AB Capital(?! Services)', 'AB Capital Services FZE', 'g')::jsonb
where key in ('company', 'engagement_terms');

commit;
