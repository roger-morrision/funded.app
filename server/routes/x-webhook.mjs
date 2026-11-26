import { createHmac, timingSafeEqual } from 'node:crypto';
import { readRawBody } from '../request-body.mjs';

// X Account Activity API webhook: answers the CRC handshake on GET and
// verifies the HMAC signature X attaches to each delivered POST event.
export function createXWebhookRoutes({ consumerSecret, respond }) {
  return async function handleXWebhookRoutes(req, res, url) {
    if (url.pathname !== '/api/x/webhook') return false;
    const secret = String(consumerSecret() || '').trim();
    if (!secret) { respond(res, 503, { error: 'X webhook is not configured on the server.' }); return true; }

    if (req.method === 'GET') {
      const crcToken = url.searchParams.get('crc_token');
      if (!crcToken) { respond(res, 400, { error: 'Missing crc_token.' }); return true; }
      const signature = createHmac('sha256', secret).update(crcToken).digest('base64');
      respond(res, 200, { response_token: `sha256=${signature}` });
      return true;
    }

    if (req.method === 'POST') {
      let raw;
      try { raw = await readRawBody(req, { maxBytes: 1_000_000, timeoutMs: 10_000 }); }
      catch (error) { respond(res, error.statusCode || 400, { error: error.message }); return true; }
      const header = String(req.headers['x-twitter-webhooks-signature'] || '');
      const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('base64')}`;
      const headerBuffer = Buffer.from(header);
      const expectedBuffer = Buffer.from(expected);
      const valid = headerBuffer.length === expectedBuffer.length && timingSafeEqual(headerBuffer, expectedBuffer);
      if (!valid) { respond(res, 401, { error: 'Invalid webhook signature.' }); return true; }
      res.writeHead(204); res.end();
      return true;
    }

    respond(res, 405, { error: 'Method not allowed.' });
    return true;
  };
}
