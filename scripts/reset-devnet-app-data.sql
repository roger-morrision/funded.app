-- One-time funded.vip Devnet application reset. Writers and public ingress must
-- be stopped first. Keep the PostgreSQL volume/schema, ignored backups, and
-- configuration; on-chain accounts are outside this database.
-- psql -X -v ON_ERROR_STOP=1 -v apply=false|true \
--   -U funded -d funded_app_retest_20260929 -f scripts/reset-devnet-app-data.sql
BEGIN;
SELECT pg_advisory_xact_lock(81730421);

DO $guard$
DECLARE
  actual text[];
  expected text[] := ARRAY[
    'account_watchlists', 'app_state', 'auth_records', 'collections',
    'creator_directory', 'devnet_metadata', 'launches', 'market_activity',
    'product_journey_events', 'product_trade_cursors', 'product_trade_events',
    'product_trade_gaps', 'product_trade_nontrades', 'read_model_versions',
    'receipt_backfill', 'receipt_counts', 'receipt_proofs', 'referral_claims',
    'rpc_rate_limits', 'settlements', 'state_entities', 'state_meta'
  ];
BEGIN
  IF current_database() <> 'funded_app_retest_20260929' THEN
    RAISE EXCEPTION 'Refusing to reset a different database';
  END IF;
  SELECT array_agg(tablename ORDER BY tablename) INTO actual
    FROM pg_tables WHERE schemaname = 'public';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Application table inventory changed; review the reset';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f'
    AND connamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Foreign-key inventory changed; review the reset';
  END IF;
END
$guard$;

SELECT 'state_entities' AS table_name, count(*) FROM state_entities
UNION ALL SELECT 'auth_records', count(*) FROM auth_records
UNION ALL SELECT 'devnet_metadata', count(*) FROM devnet_metadata
UNION ALL SELECT 'receipt_proofs', count(*) FROM receipt_proofs
UNION ALL SELECT 'rpc_rate_limits', count(*) FROM rpc_rate_limits;

TRUNCATE TABLE
  account_watchlists, app_state, auth_records, collections,
  creator_directory, devnet_metadata, launches, market_activity,
  product_journey_events, product_trade_cursors, product_trade_events,
  product_trade_gaps, product_trade_nontrades, read_model_versions,
  receipt_backfill, receipt_counts, receipt_proofs, referral_claims,
  rpc_rate_limits, settlements, state_entities, state_meta;

SELECT 'remaining_application_rows' AS result,
  (SELECT count(*) FROM state_entities)
  + (SELECT count(*) FROM auth_records)
  + (SELECT count(*) FROM devnet_metadata)
  + (SELECT count(*) FROM receipt_proofs)
  + (SELECT count(*) FROM rpc_rate_limits) AS count;

\if :apply
COMMIT;
\else
ROLLBACK;
\endif
