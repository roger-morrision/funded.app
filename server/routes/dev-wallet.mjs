// Local Devnet development wallet: reveals the configured role's public key and
// signs only when DEV_MODE is on outside production. Never available on Mainnet.
import nacl from 'tweetnacl';
import { Transaction, VersionedTransaction } from '@solana/web3.js';

export function createDevWalletRoutes({ devMode, devWalletKeypair, body, respond }) {
  return async function handleDevWalletRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/dev-wallet') {
      if (!devMode) return respond(res, 403, { error: 'Automatic wallet access is unavailable here.' });
      const wallet = devWalletKeypair();
      if (!wallet) return respond(res, 503, { error: 'Local Solana wallet role is not configured.' });
      return respond(res, 200, { role: wallet.role, publicKey: wallet.keypair.publicKey.toBase58(), cluster: 'devnet' });
    }
    if (req.method === 'POST' && url.pathname === '/api/dev-wallet/sign-transaction') {
      const wallet = devWalletKeypair();
      if (!wallet) return respond(res, 503, { error: 'Local Solana wallet role is not configured.' });
      const input = await body(req);
      try {
        const bytes = Buffer.from(String(input.transaction || ''), 'base64');
        const decoded = VersionedTransaction.deserialize(bytes);
        const transaction = decoded.version === 'legacy' ? Transaction.from(bytes) : decoded;
        if (transaction instanceof VersionedTransaction) transaction.sign([wallet.keypair]);
        else transaction.partialSign(wallet.keypair);
        return respond(res, 200, { transaction: Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64') });
      } catch { return respond(res, 400, { error: 'Invalid development transaction.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/dev-wallet/sign-message') {
      const wallet = devWalletKeypair();
      if (!wallet) return respond(res, 503, { error: 'Local Solana wallet role is not configured.' });
      const input = await body(req);
      try { return respond(res, 200, { signature: Buffer.from(nacl.sign.detached(Buffer.from(String(input.message || ''), 'base64'), wallet.keypair.secretKey)).toString('base64') }); }
      catch { return respond(res, 400, { error: 'Invalid development message.' }); }
    }
    return false;
  };
}
