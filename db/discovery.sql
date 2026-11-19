-- Small read model, maintained transactionally by every ledger writer.
CREATE TABLE IF NOT EXISTS discovery_entries (
  cluster TEXT NOT NULL, mint TEXT NOT NULL, bucket TEXT NOT NULL,
  entity_key TEXT NOT NULL, payload JSONB NOT NULL, created_at DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, entity_key)
);
CREATE INDEX IF NOT EXISTS discovery_entries_cluster_mint ON discovery_entries(cluster, mint);
CREATE INDEX IF NOT EXISTS discovery_entries_created ON discovery_entries(cluster, created_at DESC, mint);
CREATE TABLE IF NOT EXISTS discovered_tokens (
  cluster TEXT NOT NULL, mint TEXT NOT NULL, data JSONB NOT NULL,
  market_cap DOUBLE PRECISION, volume_24h DOUBLE PRECISION,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(cluster,mint)
);
CREATE OR REPLACE FUNCTION discovery_created_at(item JSONB) RETURNS DOUBLE PRECISION AS $$
BEGIN
  RETURN COALESCE(NULLIF(item->>'createdTimestamp','')::double precision,
    NULLIF(item->>'blockTime','')::double precision,
    EXTRACT(EPOCH FROM COALESCE(item->>'createdAt',item->>'launchedAt',item->>'listedAt',item->>'recordedAt')::timestamptz),0);
EXCEPTION WHEN OTHERS THEN RETURN 0;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION project_discovery_entry() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.bucket IN ('launches','listings','pairLaunches') THEN
    DELETE FROM discovery_entries WHERE bucket=OLD.bucket AND entity_key=OLD.entity_key;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.bucket IN ('launches','listings','pairLaunches')
    AND NEW.payload->>'mint' IS NOT NULL AND NEW.payload->>'cluster' IS NOT NULL
    AND (NEW.bucket='pairLaunches' OR NEW.payload->'onchainVerified'='true'::jsonb) THEN
    INSERT INTO discovery_entries(cluster,mint,bucket,entity_key,payload,created_at)
    VALUES(NEW.payload->>'cluster',NEW.payload->>'mint',NEW.bucket,NEW.entity_key,NEW.payload,discovery_created_at(NEW.payload))
    ON CONFLICT(bucket,entity_key) DO UPDATE SET cluster=EXCLUDED.cluster,mint=EXCLUDED.mint,payload=EXCLUDED.payload,created_at=EXCLUDED.created_at;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS state_discovery_projection ON state_entities;
CREATE TRIGGER state_discovery_projection AFTER INSERT OR UPDATE OR DELETE ON state_entities
FOR EACH ROW EXECUTE FUNCTION project_discovery_entry();
-- One-time backfill; subsequent boots and refreshes do not scan the ledger.
INSERT INTO discovery_entries(cluster,mint,bucket,entity_key,payload,created_at)
SELECT payload->>'cluster',payload->>'mint',bucket,entity_key,payload,discovery_created_at(payload)
FROM state_entities WHERE bucket IN ('launches','listings','pairLaunches')
  AND payload->>'mint' IS NOT NULL AND payload->>'cluster' IS NOT NULL
  AND (bucket='pairLaunches' OR payload->'onchainVerified'='true'::jsonb)
  AND NOT EXISTS(SELECT 1 FROM read_model_versions WHERE name='discovery-registry')
ON CONFLICT DO NOTHING;
INSERT INTO read_model_versions(name,version) VALUES('discovery-registry',1) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS boost_receipt_mint_idx ON state_entities((payload->>'mint')) WHERE bucket='boostReceipts';
CREATE INDEX IF NOT EXISTS boost_quote_lookup_idx ON state_entities(bucket,(payload->>'quoteId')) WHERE bucket IN ('boostReceipts','boostPayments');
