-- Wipe imported data from the database. Run manually (e.g. via the Supabase
-- SQL editor, or `psql "$DATABASE_URL" -f backend/scripts/reset_import_data.sql`)
-- when you want a clean slate — not run automatically by anything.
--
-- Leaves `users` and `branches` untouched either way.

-- ── Option A — wipe everything import-related, including products ─────────
-- Uncomment to use. CASCADE also catches anything with a foreign key pointing
-- at these tables, so listing them explicitly here is just for clarity.

-- TRUNCATE TABLE
--   sale_lines,
--   purchase_lines,
--   stock_levels,
--   sales,
--   purchases,
--   import_batches,
--   products
-- RESTART IDENTITY CASCADE;


-- ── Option B — wipe transactional data only, keep products (master data) ──
-- Uncomment to use.

-- BEGIN;
--
-- DELETE FROM sale_lines;
-- DELETE FROM purchase_lines;
-- DELETE FROM stock_levels;
-- DELETE FROM sales;
-- DELETE FROM purchases;
-- DELETE FROM import_batches;
--
-- COMMIT;
