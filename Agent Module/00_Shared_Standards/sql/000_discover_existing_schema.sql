/*
  CRM AI Agent System - read-only discovery of the existing CRM database.

  Purpose: inventory the current schema so agent tables and views can be mapped
  onto it instead of duplicating it. Changes nothing. Reads metadata only; the
  row counts come from partition stats, not table scans, and no business data
  is selected.

  Run in SSMS against the CRM database (results to grid), then save each result
  set as CSV in E:\Agents\00_Shared_Standards\sql\discovery\ (create the folder).
*/
SET NOCOUNT ON;

-- 1. Server and database
SELECT @@VERSION AS sql_version,
       DB_NAME() AS database_name,
       SERVERPROPERTY('Edition') AS edition,
       SERVERPROPERTY('ProductVersion') AS product_version,
       (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compatibility_level;

-- 2. Tables with approximate row counts
SELECT s.name AS schema_name, t.name AS table_name,
       SUM(p.rows) AS approx_rows, t.create_date, t.modify_date
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
GROUP BY s.name, t.name, t.create_date, t.modify_date
ORDER BY s.name, t.name;

-- 3. Columns
SELECT s.name AS schema_name, t.name AS table_name, c.column_id, c.name AS column_name,
       ty.name AS data_type, c.max_length, c.precision, c.scale, c.is_nullable,
       c.is_identity, dc.definition AS default_value
FROM sys.columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
ORDER BY s.name, t.name, c.column_id;

-- 4. Primary and unique keys
SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name,
       i.is_primary_key, i.is_unique,
       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS key_columns
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.is_primary_key = 1 OR i.is_unique = 1
GROUP BY s.name, t.name, i.name, i.is_primary_key, i.is_unique
ORDER BY s.name, t.name;

-- 5. Foreign keys
SELECT fk.name AS fk_name,
       SCHEMA_NAME(tp.schema_id) + '.' + tp.name AS from_table, cp.name AS from_column,
       SCHEMA_NAME(tr.schema_id) + '.' + tr.name AS to_table, cr.name AS to_column
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id
JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id
JOIN sys.columns cr ON cr.object_id = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
ORDER BY from_table, fk.name;

-- 6. Views, procedures, functions, triggers (names only)
SELECT SCHEMA_NAME(o.schema_id) AS schema_name, o.name, o.type_desc, o.modify_date
FROM sys.objects o
WHERE o.type IN ('V', 'P', 'FN', 'IF', 'TF', 'TR') AND o.is_ms_shipped = 0
ORDER BY o.type_desc, schema_name, o.name;

-- 7. Database principals and role membership (no passwords or SIDs)
SELECT dp.name AS principal_name, dp.type_desc, dp.authentication_type_desc,
       r.name AS member_of_role
FROM sys.database_principals dp
LEFT JOIN sys.database_role_members rm ON rm.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id
WHERE dp.is_fixed_role = 0 AND dp.name NOT IN ('guest', 'INFORMATION_SCHEMA', 'sys', 'public')
ORDER BY dp.type_desc, dp.name;

-- 8. Name collisions with the agent baseline (anything listed here must be resolved before 001)
SELECT s.name AS existing_schema
FROM sys.schemas s
WHERE s.name IN ('core','client','accounting','tax','audit','bizdev','social',
                 'document','support','security','hr','personal','it');
SELECT name AS existing_role
FROM sys.database_principals
WHERE type = 'R' AND (name LIKE 'agent[_]%' OR name = 'crm_approver');
