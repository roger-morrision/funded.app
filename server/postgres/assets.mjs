import { metadataStatement } from '../../devnet-metadata.js';

// Each operation uses the shared pool and readiness gate; transactions stay local.
export function createAssetsRepository({ pool, ensureReady }) {
  return {
    async readLaunches({ limit = null, offset = 0 } = {}) {
      await ensureReady();
      const result = limit == null
        ? await pool.query('SELECT payload FROM launches ORDER BY updated_at DESC, mint')
        : await pool.query('SELECT payload FROM launches ORDER BY updated_at DESC, mint LIMIT $1 OFFSET $2', [limit, offset]);
      return result.rows.map(row => row.payload);
    },
    async readLaunch(mint) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM launches WHERE mint = $1', [mint]);
      return result.rows[0]?.payload || null;
    },
    async writeMetadata(record, image, imageType, banner = null, bannerType = null) {
      await ensureReady();
      const inserted = await pool.query('INSERT INTO devnet_metadata (mint, creator_wallet, payload, image, image_mime, banner, banner_mime) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) ON CONFLICT (mint) DO NOTHING RETURNING mint', [record.mint, record.creatorWallet, JSON.stringify(record), image, imageType, banner, bannerType]);
      if (inserted.rowCount) return record;
      const existing = await pool.query('SELECT payload FROM devnet_metadata WHERE mint = $1', [record.mint]);
      if (!existing.rows[0]?.payload || metadataStatement(existing.rows[0].payload) !== metadataStatement(record)) throw new Error('Immutable Solana metadata already exists for this mint.');
      return existing.rows[0].payload;
    },
    async readMetadata(mint) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM devnet_metadata WHERE mint = $1', [mint]);
      return result.rows[0]?.payload || null;
    },
    async readMetadataImage(mint) {
      await ensureReady();
      const result = await pool.query('SELECT image, image_mime FROM devnet_metadata WHERE mint = $1', [mint]);
      return result.rows[0]?.image ? { bytes: result.rows[0].image, mime: result.rows[0].image_mime } : null;
    },
    async readMetadataBanner(mint) {
      await ensureReady();
      const result = await pool.query('SELECT banner, banner_mime FROM devnet_metadata WHERE mint = $1', [mint]);
      return result.rows[0]?.banner ? { bytes: result.rows[0].banner, mime: result.rows[0].banner_mime } : null;
    },
  };
}
