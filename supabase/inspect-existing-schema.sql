-- READ-ONLY inspection. Safe to run in Supabase SQL Editor.
-- This script does not create, alter, or delete database objects.

SELECT
  tc.table_name,
  kcu.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.columns AS c
  ON c.table_schema = kcu.table_schema
 AND c.table_name = kcu.table_name
 AND c.column_name = kcu.column_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('profiles', 'teams', 'auction_items', 'purchases', 'transactions')
ORDER BY tc.table_name, kcu.ordinal_position;

SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'teams', 'auction_items', 'purchases', 'transactions')
ORDER BY table_name, ordinal_position;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'teams', 'auction_items', 'purchases', 'transactions')
ORDER BY tablename, policyname;
