-- LOCAL TEST ONLY. AB Capital work types.
\set ON_ERROR_STOP on
\set manager '00000000-0000-0000-0000-0000000000b1'
\set quoter '00000000-0000-0000-0000-0000000000b2'
\set ardent '00000000-0000-0000-0000-0000000000b3'

select at_as(:'manager');
select hub_library_template_save('{"template_key":"AB Capital/Formation/IFZA Work","company":"AB Capital","folder":"Formation","name":"IFZA Work","fee_rows":[{"label":"Fee","amount":10}],"sections":{"quote":{"scope":"Zone scope"}}}');
select at_check('sections are saved',
  (select sections #>> '{quote,scope}' = 'Zone scope' from hub_library_templates where template_key = 'AB Capital/Formation/IFZA Work'));
select hub_library_template_save('{"template_key":"AB Capital/Formation/IFZA Work","company":"AB Capital","folder":"Formation","name":"IFZA Work","active":true}');
select at_check('sections are kept when not sent',
  (select sections #>> '{quote,scope}' = 'Zone scope' from hub_library_templates where template_key = 'AB Capital/Formation/IFZA Work'));

select at_as(:'quoter');
select at_check('non-manager cannot save sections',
  at_refused($f$select hub_library_template_save('{"template_key":"AB Capital/Formation/IFZA Work","company":"AB Capital","folder":"Formation","name":"IFZA Work","sections":{}}')$f$, 'permission'));
select at_check('AB Capital document needs no file, and keeps its number series',
  (select document_number like 'ABC/%/BSQ%' and library_template = 'AB Capital/Formation/IFZA Work' and library_file_id is null and field_values #>> '{sections,scope}' = 'Own'
     from hub_library_create(at_lib('AB Capital/Formation/IFZA Work', null, '{"field_values": {"sections": {"scope": "Own"}}}'))));
select at_check('a file from another template is still refused',
  at_refused($f$select hub_library_create(at_lib('AB Capital/Formation/IFZA Work', 999999))$f$, 'does not belong'));
select at_check('letter stores the chosen work type',
  (select library_template = 'AB Capital/Formation/IFZA Work' from hub_library_letter_create(at_letter('{"work_type": "AB Capital/Formation/IFZA Work"}'))));
select at_check('letter with no work type is as before',
  (select library_template = 'AB Capital/Engagement Letter' from hub_library_letter_create(at_letter())));
select at_check('unknown work type is refused',
  at_refused($f$select hub_library_letter_create(at_letter('{"work_type": "Nope"}'))$f$, 'Unknown work type'));

select at_as(:'ardent');
select at_check('Ardentax still needs a file',
  at_refused($f$select hub_library_create(at_lib('Ardentax/Test/Doc', null))$f$, 'does not belong'));
select at_as(null);
