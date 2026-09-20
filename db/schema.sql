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
