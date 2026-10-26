-- =====================================================================
-- Export the LIVE database structure (READ-ONLY)
-- =====================================================================
-- Paste into Supabase → SQL Editor → Run. It only reads the system
-- catalogs — no table data, nothing is changed.
--
-- Returns one row per section (tables, constraints, indexes, RLS,
-- policies, views, functions, triggers, buckets, realtime, cron, row
-- counts). Use the results panel's Export → "Download CSV" and save it as
--   db/live_schema_export.csv
-- (git-ignored: cron job commands can contain webhook secrets).
-- =====================================================================

select ord, section, content from (

  select 1 as ord, 'extensions' as section,
         string_agg(extname || ' ' || extversion, E'\n' order by extname) as content
  from pg_extension

  union all
  -- table | column | type | nullability | default
  select 2, 'tables_and_columns',
         string_agg(format('%s | %s | %s | %s | %s',
                           c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
                           case when a.attnotnull then 'not null' else 'null' end,
                           coalesce(pg_get_expr(d.adbin, d.adrelid), '')),
                    E'\n' order by c.relname, a.attnum)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind in ('r', 'p')

  union all
  select 3, 'constraints',
         string_agg(format('%s | %s | %s', cl.relname, con.conname, pg_get_constraintdef(con.oid)),
                    E'\n' order by cl.relname, con.conname)
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where n.nspname = 'public'

  union all
  select 4, 'indexes',
         string_agg(indexdef || ';', E'\n' order by tablename, indexname)
  from pg_indexes
  where schemaname = 'public'

  union all
  select 5, 'rls_enabled',
         string_agg(format('%s | rls=%s | forced=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity),
                    E'\n' order by c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')

  union all
  select 6, 'policies',
         string_agg(format('%s.%s | %s | %s | %s | roles=%s | using=%s | check=%s',
                           schemaname, tablename, policyname, permissive, cmd, roles::text,
                           coalesce(qual, '-'), coalesce(with_check, '-')),
                    E'\n' order by schemaname, tablename, policyname)
  from pg_policies
  where schemaname in ('public', 'storage')

  union all
  select 7, 'views',
         string_agg(format('create or replace view public.%I as%s', viewname, definition),
                    E'\n\n' order by viewname)
  from pg_views
  where schemaname = 'public'

  union all
  -- Functions written for this app (excludes ones installed by extensions)
  select 8, 'functions',
         string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n' order by p.proname)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')

  union all
  select 9, 'triggers',
         string_agg(pg_get_triggerdef(t.oid) || ';', E'\n' order by n.nspname, c.relname, t.tgname)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))

  union all
  select 10, 'enum_types',
         string_agg(format('%s: %s', t.typname,
                           (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
                            from pg_enum e where e.enumtypid = t.oid)),
                    E'\n' order by t.typname)
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'

  union all
  select 11, 'storage_buckets',
         string_agg(format('%s | public=%s | size_limit=%s | mime=%s',
                           id, public, coalesce(file_size_limit::text, '-'),
                           coalesce(allowed_mime_types::text, '-')),
                    E'\n' order by id)
  from storage.buckets

  union all
  select 12, 'realtime_tables',
         string_agg(schemaname || '.' || tablename, E'\n' order by tablename)
  from pg_publication_tables
  where pubname = 'supabase_realtime'

  union all
  -- pg_cron may not be installed; query_to_xml only runs when it is
  select 13, 'cron_jobs',
         case when to_regclass('cron.job') is not null
              then query_to_xml('select jobid, jobname, schedule, command, active from cron.job order by jobid',
                                true, false, '')::text
              else 'pg_cron not installed' end

  union all
  -- Approximate live row counts (from table statistics — no data read)
  select 14, 'row_counts',
         string_agg(format('%s | ~%s rows', relname, n_live_tup), E'\n' order by relname)
  from pg_stat_user_tables
  where schemaname = 'public'

) s
order by ord;
