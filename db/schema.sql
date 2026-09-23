CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- app_state is retained only as a one-time migration source. Live writes use
-- independently keyed records so a mutation does not rewrite the full ledger.
CREATE TABLE IF NOT EXISTS state_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  last_indexed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS state_entities (
  bucket TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (bucket, entity_key)
);

CREATE TABLE IF NOT EXISTS market_activity (
  mint TEXT NOT NULL,
  cluster TEXT NOT NULL,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (mint, cluster)
);
CREATE INDEX IF NOT EXISTS market_activity_observed_at_idx ON market_activity (observed_at);

CREATE TABLE IF NOT EXISTS devnet_metadata (
  mint TEXT PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  payload JSONB NOT NULL,
  image BYTEA,
  image_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpc_rate_limits (
  client_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  units INTEGER NOT NULL,
  PRIMARY KEY (client_key, window_start)
);

CREATE TABLE IF NOT EXISTS launches (
  mint TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  signature TEXT,
  mint TEXT,
  status TEXT,
  collected_lamports BIGINT,
  payload JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlements (
  claim_signature TEXT PRIMARY KEY,
  status TEXT,
  asset TEXT,
  gross_creator_fees NUMERIC,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_claims (
  id TEXT PRIMARY KEY,
  status TEXT,
  level INTEGER,
  amount NUMERIC,
  asset TEXT,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS launches_updated_at_idx ON launches (updated_at DESC);
CREATE INDEX IF NOT EXISTS collections_recorded_at_idx ON collections (recorded_at DESC);
CREATE INDEX IF NOT EXISTS collections_mint_attributed_idx ON collections (mint, recorded_at DESC) WHERE status = 'collected' AND payload->>'attribution' = 'mint-verified';
CREATE INDEX IF NOT EXISTS collections_router_idx ON collections ((payload->>'router'), recorded_at DESC) WHERE status = 'collected' AND collected_lamports > 0;
CREATE INDEX IF NOT EXISTS settlements_status_idx ON settlements (status);
CREATE INDEX IF NOT EXISTS referral_claims_status_idx ON referral_claims (status);
CREATE INDEX IF NOT EXISTS referral_claims_recipient_idx ON referral_claims ((payload->>'recipientWallet'), updated_at DESC);

-- Separate from public ledger buckets. Only hashes of browser bearer tokens are stored.
CREATE TABLE IF NOT EXISTS auth_records (
  kind TEXT NOT NULL CHECK (kind IN ('session', 'oauth')),
  token_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kind, token_hash)
);
CREATE INDEX IF NOT EXISTS auth_records_expiry_idx ON auth_records (expires_at);

CREATE TABLE IF NOT EXISTS read_model_versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL);
-- Counts describe eligible ledger records, never verified money or chain completeness.
CREATE TABLE IF NOT EXISTS receipt_counts (
  bucket TEXT NOT NULL CHECK(bucket IN ('collections','payouts')),
  cluster TEXT NOT NULL,
  record_count BIGINT NOT NULL CHECK(record_count>=0),
  PRIMARY KEY(bucket,cluster)
);
CREATE OR REPLACE FUNCTION receipt_count_cluster(record_bucket TEXT, record_payload JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN ((record_bucket='collections' AND record_payload->>'status'='collected')
    OR (record_bucket='payouts' AND record_payload->>'status'='paid'))
    AND jsonb_typeof(record_payload->'signature')='string' AND record_payload->>'signature'<>''
    THEN record_payload->>'cluster' ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION maintain_receipt_counts() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE old_cluster TEXT; new_cluster TEXT; old_bucket TEXT; new_bucket TEXT; change RECORD;
BEGIN
  IF TG_OP<>'INSERT' THEN old_cluster:=receipt_count_cluster(OLD.bucket,OLD.payload);old_bucket:=OLD.bucket;END IF;
  IF TG_OP<>'DELETE' THEN new_cluster:=receipt_count_cluster(NEW.bucket,NEW.payload);new_bucket:=NEW.bucket;END IF;
  -- Cancel no-op changes and lock affected counter rows in a deterministic order.
  FOR change IN SELECT b,c,sum(delta)::bigint AS delta
    FROM (VALUES(old_bucket,old_cluster,-1),(new_bucket,new_cluster,1)) AS changes(b,c,delta)
    WHERE c IS NOT NULL GROUP BY b,c HAVING sum(delta)<>0 ORDER BY b,c
  LOOP
    INSERT INTO receipt_counts(bucket,cluster,record_count) VALUES(change.b,change.c,0) ON CONFLICT DO NOTHING;
    UPDATE receipt_counts SET record_count=record_count+change.delta WHERE bucket=change.b AND cluster=change.c;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER receipt_counts_write AFTER INSERT OR UPDATE OR DELETE ON state_entities
  FOR EACH ROW EXECUTE FUNCTION maintain_receipt_counts();
CREATE OR REPLACE FUNCTION clear_receipt_counts() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN DELETE FROM receipt_counts;RETURN NULL;END;
$$;
CREATE OR REPLACE TRIGGER receipt_counts_truncate AFTER TRUNCATE ON state_entities
  FOR EACH STATEMENT EXECUTE FUNCTION clear_receipt_counts();
CREATE TABLE IF NOT EXISTS creator_directory (
  cluster TEXT NOT NULL,
  creator_id TEXT COLLATE "C" NOT NULL,
  payload JSONB NOT NULL,
  search_text TEXT NOT NULL,
  PRIMARY KEY (cluster, creator_id)
);
ALTER TABLE creator_directory ADD COLUMN IF NOT EXISTS search_grams TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS creator_directory_search_idx ON creator_directory USING GIN(search_grams);
CREATE INDEX IF NOT EXISTS launches_x_identity_idx ON launches ((payload->>'xUserId'),(payload->>'cluster'));
CREATE INDEX IF NOT EXISTS obligations_x_identity_idx ON state_entities ((payload->>'xUserId')) WHERE bucket='obligations';
CREATE INDEX IF NOT EXISTS claims_x_identity_idx ON state_entities ((payload->>'xUserId')) WHERE bucket='claims';
CREATE INDEX IF NOT EXISTS payouts_obligation_idx ON state_entities ((payload->>'obligationId')) WHERE bucket='payouts';
CREATE INDEX IF NOT EXISTS payouts_claim_idx ON state_entities ((payload->>'claimId')) WHERE bucket='payouts';
CREATE TABLE IF NOT EXISTS receipt_proofs (
  fingerprint TEXT PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS receipt_proofs_retention_idx ON receipt_proofs(verified_at,fingerprint);
CREATE TABLE IF NOT EXISTS receipt_backfill (
  cluster TEXT PRIMARY KEY CHECK(cluster='devnet'),
  owner TEXT,
  lease_until TIMESTAMPTZ,
  progress JSONB NOT NULL DEFAULT '{}'
);
ALTER TABLE receipt_backfill ADD COLUMN IF NOT EXISTS last_run JSONB;
CREATE INDEX IF NOT EXISTS receipt_backfill_cursor_idx ON state_entities
  (bucket,(payload->>'cluster'),(payload->>'status'),entity_key COLLATE "C")
  WHERE jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>'';
CREATE INDEX IF NOT EXISTS payout_history_idx ON state_entities
  ((payload->>'cluster'), entity_key COLLATE "C")
  WHERE bucket='payouts' AND payload->>'status'='paid'
    AND jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>'';
-- Bounded receipt payload reads; exact coverage counts come from receipt_counts.
CREATE INDEX IF NOT EXISTS receipt_candidates_idx ON state_entities
  (bucket, (payload->>'cluster'), (payload->>'status'),
   (COALESCE(NULLIF(payload->>'recordedAt',''),payload->>'paidAt','') COLLATE "C") DESC, entity_key COLLATE "C")
  WHERE jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>'';
