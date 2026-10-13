-- Run with psql -X -v ON_ERROR_STOP=1 -v apply=false|true
--   -v target_db=funded_app_retest_20260929 -v expected_mints=13
--   -v expected_collections=12 -f this-file.
-- The funded.vip writers must be stopped before apply=true. Back up both the
-- PostgreSQL database and the mounted reward ledger first. This transaction
-- removes only records linked to the inventoried per-mint-v2 Devnet mints.
BEGIN;
SELECT pg_advisory_xact_lock(81730421);
SELECT set_config('funded.cleanup.target_db', :'target_db', true);
SELECT set_config('funded.cleanup.expected_mints', :'expected_mints', true);
SELECT set_config('funded.cleanup.expected_collections', :'expected_collections', true);

CREATE TEMP TABLE retired_mints ON COMMIT DROP AS
  SELECT mint, payload->>'xUserId' AS x_user_id FROM launches
  WHERE payload->>'cluster' = 'devnet'
    AND payload #>> '{pumpFeeRoute,scope}' = 'per-mint-v2';
CREATE TEMP TABLE retired_collections ON COMMIT DROP AS
  SELECT id, signature FROM collections WHERE mint IN (SELECT mint FROM retired_mints);
CREATE TEMP TABLE retired_obligations ON COMMIT DROP AS
  SELECT entity_key AS id FROM state_entities WHERE bucket = 'obligations'
    AND payload->>'mint' IN (SELECT mint FROM retired_mints);
CREATE TEMP TABLE retired_claims ON COMMIT DROP AS
  SELECT entity_key AS id FROM state_entities WHERE bucket = 'claims'
    AND payload->>'obligationId' IN (SELECT id FROM retired_obligations);
CREATE TEMP TABLE retired_referral_claims ON COMMIT DROP AS
  SELECT entity_key AS id FROM state_entities WHERE bucket = 'referralClaims'
    AND payload->>'settlementSignature' IN (SELECT signature FROM retired_collections);

DO $guard$
BEGIN
  IF current_database() <> current_setting('funded.cleanup.target_db') THEN RAISE EXCEPTION 'Wrong database'; END IF;
  IF (SELECT count(*) FROM retired_mints) <> current_setting('funded.cleanup.expected_mints')::integer THEN
    RAISE EXCEPTION 'V2 mint inventory changed; inspect before deletion';
  END IF;
  IF (SELECT count(*) FROM retired_collections) <> current_setting('funded.cleanup.expected_collections')::integer THEN
    RAISE EXCEPTION 'V2 collection inventory changed; inspect before deletion';
  END IF;
  IF EXISTS (SELECT 1 FROM state_entities WHERE bucket = 'creatorProfiles'
    AND entity_key IN (SELECT x_user_id FROM retired_mints WHERE x_user_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'A creator profile needs separate directory reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM app_state, LATERAL jsonb_each(COALESCE(payload->'launches','{}'::jsonb)) AS row
    WHERE row.value #>> '{pumpFeeRoute,scope}' = 'per-mint-v2') THEN
    RAISE EXCEPTION 'Legacy app_state still contains V2 launches';
  END IF;
END
$guard$;

SELECT 'retired_mints' AS kind, count(*) FROM retired_mints
UNION ALL SELECT 'retired_collections', count(*) FROM retired_collections
UNION ALL SELECT 'retired_obligations', count(*) FROM retired_obligations
UNION ALL SELECT 'retired_claims', count(*) FROM retired_claims
UNION ALL SELECT 'retired_referral_claims', count(*) FROM retired_referral_claims;

DELETE FROM state_entities AS row WHERE
  (row.bucket IN ('launches','coinChats','communityReserveReceipts')
    AND row.entity_key IN (SELECT mint FROM retired_mints))
  OR (row.bucket IN ('alerts','boostQuotes','boostReceipts','buybackOrders','collections',
      'listings','obligations') AND row.payload->>'mint' IN (SELECT mint FROM retired_mints))
  OR (row.bucket = 'burnReceipts' AND row.payload->>'projectMint' IN (SELECT mint FROM retired_mints))
  OR (row.bucket = 'settlements' AND row.payload->>'claimSignature' IN (SELECT signature FROM retired_collections))
  OR (row.bucket = 'claims' AND row.entity_key IN (SELECT id FROM retired_claims))
  OR (row.bucket = 'referralClaims' AND row.entity_key IN (SELECT id FROM retired_referral_claims))
  OR (row.bucket = 'payouts' AND (
    row.payload->>'mint' IN (SELECT mint FROM retired_mints)
    OR row.payload->>'obligationId' IN (SELECT id FROM retired_obligations)
    OR row.payload->>'claimId' IN (SELECT id FROM retired_claims)
    OR row.payload->>'claimId' IN (SELECT id FROM retired_referral_claims)));

DELETE FROM referral_claims WHERE id IN (SELECT id FROM retired_referral_claims);
DELETE FROM settlements WHERE claim_signature IN (SELECT signature FROM retired_collections);
DELETE FROM collections WHERE id IN (SELECT id FROM retired_collections);
DELETE FROM launches WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM creator_directory WHERE creator_id IN
  (SELECT x_user_id FROM retired_mints WHERE x_user_id IS NOT NULL);
DELETE FROM devnet_metadata WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM market_activity WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM product_trade_cursors WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM product_trade_events WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM product_trade_gaps WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM product_trade_nontrades WHERE mint IN (SELECT mint FROM retired_mints);
DELETE FROM receipt_proofs AS row WHERE EXISTS
  (SELECT 1 FROM retired_mints AS mint WHERE row.payload::text LIKE '%' || mint.mint || '%');
DO $outbox$
BEGIN
  IF to_regclass('public.x_post_outbox') IS NOT NULL THEN
    EXECUTE 'DELETE FROM x_post_outbox AS row WHERE EXISTS
      (SELECT 1 FROM retired_mints AS mint WHERE row.payload::text LIKE ''%'' || mint.mint || ''%'')';
  END IF;
END
$outbox$;

UPDATE account_watchlists AS row SET payload =
  jsonb_set(jsonb_set(row.payload, '{mints}', COALESCE((
    SELECT jsonb_agg(to_jsonb(item.value)) FROM
      jsonb_array_elements_text(COALESCE(row.payload->'mints','[]'::jsonb)) AS item(value)
      WHERE item.value NOT IN (SELECT mint FROM retired_mints)
  ), '[]'::jsonb)), '{imports}', COALESCE((
    SELECT jsonb_agg(to_jsonb(item.value)) FROM
      jsonb_array_elements_text(COALESCE(row.payload->'imports','[]'::jsonb)) AS item(value)
      WHERE item.value NOT IN (SELECT mint FROM retired_mints)
  ), '[]'::jsonb))
WHERE EXISTS (SELECT 1 FROM retired_mints AS mint
  WHERE row.payload->'mints' ? mint.mint OR row.payload->'imports' ? mint.mint);

SELECT 'remaining_v2_launches' AS kind, count(*) FROM launches
  WHERE payload #>> '{pumpFeeRoute,scope}' = 'per-mint-v2' AND payload->>'cluster' = 'devnet'
UNION ALL SELECT 'remaining_linked_collections', count(*) FROM collections
  WHERE mint IN (SELECT mint FROM retired_mints)
UNION ALL SELECT 'remaining_linked_state_entities', count(*) FROM state_entities
  WHERE bucket = 'launches' AND entity_key IN (SELECT mint FROM retired_mints);

\if :apply
COMMIT;
\else
ROLLBACK;
\endif
