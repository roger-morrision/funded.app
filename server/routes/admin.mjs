import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH, parseReserve, rewardReserveAddress } from '../automatic-reward-chain.mjs';
import { SOL_ASSET_MINT } from '../../reward-merkle.js';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import { validateProtocolFeeSplit } from '../../distribution-policy.js';
import { protocolGrossUnits, deriveMintVaultsV3, deriveCommunityRewardVaultV3, verifyMintPolicyV3Account } from '../../mint-router-v3.js';

const COOKIE = 'funded_admin';
const CHALLENGE_MS = 5 * 60_000;
const SESSION_MS = 30 * 60_000;
const CATEGORIES = ['Creator', 'Operations', 'Referral L1', 'Referral L2', 'Referral L3', 'Community', 'Buyback'];
const validWallet = value => {
  try { return new PublicKey(value).toBase58(); } catch { return null; }
};
const cookieValue = (req, name) => String(req.headers.cookie || '').split(';').map(part => part.trim())
  .find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const ipLimit = (map, key, limit, windowMs) => {
  const now = Date.now();
  const entry = map.get(key);
  const count = entry && now - entry.start < windowMs ? entry.count + 1 : 1;
  map.set(key, { start:entry && now - entry.start < windowMs ? entry.start : now, count });
  if (map.size > 2_000) for (const [id, row] of map) if (now - row.start >= windowMs) map.delete(id);
  return count <= limit;
};

export function createAdminRoutes({ store, body, respond, solanaCluster, solanaRpcUrl,
  keeperKeypair, referralPayoutKeypair, v3AuthorityKeypair, dailyBonusRuntime, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized') }) {
  const challenges = new Map(), sessions = new Map(), attempts = new Map(), withdrawals = new Map();
  const json = (res, status, value) => { respond(res, status, value); return true; };
  const allowed = () => new Set(String(env.FUNDED_ADMIN_WALLETS || '').split(',').map(value => validWallet(value.trim())).filter(Boolean));
  const origin = () => {
    try { return new URL(env.PUBLIC_APP_URL || env.CORS_ORIGIN || 'http://127.0.0.1:8787').origin; }
    catch { return null; }
  };
  const sameOrigin = req => String(req.headers.origin || '') === origin();
  const currentSession = req => {
    const token = cookieValue(req, COOKIE);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now() || !allowed().has(session.wallet)) {
      sessions.delete(token); return null;
    }
    return session;
  };
  const setCookie = (res, value, maxAge) => {
    res.setHeader('set-cookie', `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin()?.startsWith('https:') ? '; Secure' : ''}`);
  };
  const connection = () => connectionFactory(solanaRpcUrl);
  const withdrawalDestinations = () => new Set(String(env.FUNDED_ADMIN_WITHDRAW_DESTINATIONS || env.FUNDED_ADMIN_WALLETS || '')
    .split(',').map(value => validWallet(value.trim())).filter(Boolean));
  const roleAddresses = () => {
    const signer = read => { try { return read()?.publicKey?.toBase58() || null; } catch { return null; } };
    return [
      { role:'Pump fee keeper', address:signer(keeperKeypair), custody:'server signer', withdrawable:false },
      { role:'V3 router authority', address:signer(v3AuthorityKeypair), custody:'server signer', withdrawable:false },
      { role:'Referral payout funder', address:signer(referralPayoutKeypair), custody:'server signer', withdrawable:false },
      { role:'Protocol operations treasury', address:validWallet(env.FUNDED_PUMP_REVENUE_WALLET), custody:'external wallet', withdrawable:true },
      { role:'Trading fee treasury', address:validWallet(env.FUNDED_TRADE_FEE_OWNER || env.VITE_FUNDED_TRADE_FEE_OWNER), custody:'external wallet', withdrawable:true },
      { role:'Boost payment wallet', address:validWallet(env.FUNDED_BOOST_PAYMENT_WALLET), custody:'external wallet', withdrawable:true },
    ].filter(row => row.address);
  };
  const finalizedTransfer = async (rpc, signature) => {
    const tx = await rpc.getParsedTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
    const instructions = tx?.transaction?.message?.instructions || [];
    const transfer = instructions[0]?.parsed;
    const accounts = tx?.transaction?.message?.accountKeys?.map(key => key.pubkey.toBase58()) || [];
    const source = transfer?.info?.source, destination = transfer?.info?.destination;
    const amount = transfer?.info?.lamports;
    const sourceIndex = accounts.indexOf(source), destinationIndex = accounts.indexOf(destination);
    if (!tx?.meta || tx.meta.err || instructions.length !== 1 || instructions[0]?.program !== 'system'
      || transfer?.type !== 'transfer' || sourceIndex < 0 || destinationIndex < 0
      || !Number.isSafeInteger(amount) || amount < 1_000_000 || amount > 5_000_000_000
      || tx.meta.postBalances[destinationIndex] - tx.meta.preBalances[destinationIndex] !== amount
      || tx.meta.preBalances[sourceIndex] - tx.meta.postBalances[sourceIndex] !== amount + tx.meta.fee)
      return null;
    return { tx, source, destination, amount };
  };
  return async function handleAdminRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/admin/')) return false;
    if (solanaCluster !== 'devnet') return json(res, 403, { error:'This admin workspace is Devnet-only.' });
    res.setHeader('cache-control', 'no-store');
    const path = url.pathname;
    if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error:'Admin requests require the configured app origin.' });
    const key = req.socket.remoteAddress || 'unknown';
    if (!ipLimit(attempts, key, 60, 60_000)) return json(res, 429, { error:'Admin request limit reached.' });
    if (req.method === 'POST' && path === '/api/admin/challenge') {
      const input = await body(req) || {};
      const wallet = validWallet(input.wallet);
      if (!wallet || !allowed().has(wallet)) return json(res, 403, { error:'This wallet is not configured as an administrator.' });
      const nonce = randomBytes(24).toString('hex');
      const expiresAt = Date.now() + CHALLENGE_MS;
      const message = `funded.vip Devnet admin sign-in\nOrigin: ${origin()}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}`;
      challenges.set(nonce, { wallet, message, expiresAt });
      if (challenges.size > 500) for (const [id, row] of challenges) if (row.expiresAt <= Date.now()) challenges.delete(id);
      return json(res, 200, { nonce, message, expiresAt:new Date(expiresAt).toISOString() });
    }
    if (req.method === 'POST' && path === '/api/admin/session') {
      const input = await body(req) || {};
      const challenge = challenges.get(String(input.nonce || ''));
      challenges.delete(String(input.nonce || ''));
      const wallet = validWallet(input.wallet);
      let signature;
      try { signature = bs58.decode(String(input.signature || '')); } catch {}
      if (!challenge || challenge.expiresAt <= Date.now() || challenge.wallet !== wallet
        || !allowed().has(wallet) || signature?.length !== nacl.sign.signatureLength
        || !nacl.sign.detached.verify(new TextEncoder().encode(challenge.message), signature, new PublicKey(wallet).toBytes()))
        return json(res, 401, { error:'The admin wallet signature is invalid or expired.' });
      const token = randomBytes(32).toString('hex');
      const expiresAt = Date.now() + SESSION_MS;
      sessions.set(token, { wallet, expiresAt });
      setCookie(res, token, Math.floor(SESSION_MS / 1_000));
      return json(res, 200, { wallet, expiresAt:new Date(expiresAt).toISOString() });
    }
    const session = currentSession(req);
    if (!session) return json(res, 401, { error:'Sign in with the configured admin wallet.' });
    if (req.method === 'GET' && path === '/api/admin/session')
      return json(res, 200, { wallet:session.wallet, expiresAt:new Date(session.expiresAt).toISOString() });
    const dailyAction = req.method === 'POST' && path.match(/^\/api\/admin\/daily-bonus\/(snapshot|review|reconcile)$/);
    if (dailyAction) {
      if (!dailyBonusRuntime) return json(res,503,{error:'Daily bonus recovery is unavailable.'});
      const input = await body(req);
      try {
        const result = await dailyBonusRuntime.operate(dailyAction[1],input,session.wallet);
        if (dailyAction[1] === 'reconcile') await store.update(state => {
          state.adminAudit ||= {};
          state.adminAudit[`daily-bonus:${input.day}:${input.expectedNewHash}`] = {
            action:'daily-bonus-reconciled', day:input.day, previousHash:input.expectedHash,
            replacementHash:input.expectedNewHash, wallet:session.wallet, reason:String(input.reason).slice(0,500),
            at:new Date().toISOString() };
        });
        return json(res,200,result);
      } catch(error) {return json(res,409,{error:String(error.message || error)});}
    }
    if (req.method === 'POST' && path === '/api/admin/logout') {
      sessions.delete(cookieValue(req, COOKIE)); setCookie(res, '', 0);
      return json(res, 200, { signedOut:true });
    }
    if (req.method === 'GET' && path === '/api/admin/overview') {
      const state = await store.read();
      const rows = roleAddresses();
      const rpc = connection();
      const genesis = await rpc.getGenesisHash();
      if (genesis !== DEVNET_GENESIS_HASH)
        return json(res, 503, { error:'The configured RPC is not Solana Devnet.' });
      const unique = [...new Set(rows.map(row => row.address))];
      const balances = new Map(await Promise.all(unique.map(async address => [address, await rpc.getBalance(new PublicKey(address), 'finalized')])));
      const wallets = rows.map(row => ({ ...row, lamports:String(balances.get(row.address)), balanceStatus:'finalized' }));
      const collections = Object.values(state.collections || {}).filter(row => row.scope === 'per-mint-v3' && row.onchainVerified === true);
      const settlements = Object.values(state.v3Settlements || {}).filter(row => row.status === 'finalized');
      return json(res, 200, { cluster:'devnet', walletCount:wallets.length, wallets,
        revenue:{ verifiedCollectionsLamports:String(collections.reduce((sum, row) => sum + BigInt(row.collectedLamports || 0), 0n)),
          finalizedSettlementCount:settlements.length,
          operationsAllocationLamports:String(settlements.reduce((sum, row) => sum + BigInt(row.categoryLamports?.[1] || 0), 0n)),
          note:'Recorded V3 collection and allocation totals; wallet balances are live finalized RPC reads, not cumulative revenue.' },
        withdrawalDestinations:[...withdrawalDestinations()],
        gates:{ launch:env.FUNDED_V3_LAUNCH_ENABLED === 'true', collection:env.FUNDED_V3_COLLECTION_ENABLED === 'true',
          settlement:env.FUNDED_V3_SETTLEMENT_ENABLED === 'true', holder:env.FUNDED_V3_HOLDER_WORKER_ENABLED === 'true',
          referral:env.FUNDED_V3_REFERRAL_PAYOUT_ENABLED === 'true', xClaims:env.FUNDED_V3_X_CLAIMS_ENABLED === 'true',
          buyback:env.FUNDED_V3_BUYBACK_ENABLED === 'true' } });
    }
    if (req.method === 'GET' && path === '/api/admin/vaults') {
      const state = await store.read();
      const launches = Object.values(state.launches || {}).filter(row => row.pumpFeeRoute?.scope === 'per-mint-v3' && row.pumpFeeRoute.programId);
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error:'Invalid vault page.' });
      const page = launches.slice(offset, offset + 10);
      const rewardVaults = page.map(row => deriveCommunityRewardVaultV3(row.pumpFeeRoute.programId, row.mint, row.pumpFeeRoute.initialAuthority));
      const addresses = page.flatMap((row, index) => [
        ...deriveMintVaultsV3(row.pumpFeeRoute.programId, row.mint),
        rewardReserveAddress({ programId:row.pumpFeeRoute.programId, vault:rewardVaults[index], asset:'SOL' }),
      ]);
      const rpc = connection();
      const genesis = await rpc.getGenesisHash();
      if (genesis !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'The configured RPC is not Solana Devnet.' });
      const accounts = addresses.length ? await rpc.getMultipleAccountsInfo(addresses, 'finalized') : [];
      const rentReserve = page.length ? BigInt(await rpc.getMinimumBalanceForRentExemption(0, 'finalized')) : 0n;
      const rewardRentReserve = page.length ? BigInt(await rpc.getMinimumBalanceForRentExemption(81, 'finalized')) : 0n;
      const policies = await Promise.all(page.map(async launch => {
        try {
          return await verifyMintPolicyV3Account({ connection:rpc,
            programId:launch.pumpFeeRoute.programId, mint:launch.mint,
            creator:launch.creatorWallet, initialAuthority:launch.pumpFeeRoute.initialAuthority,
            split:launch.pumpFeeRoute.protocolSplit });
        } catch { return { verified:false, reason:'v3-policy-read-unavailable' }; }
      }));
      const vaults = page.map((launch, index) => ({ mint:launch.mint, symbol:launch.symbol || null,
        policyStatus:policies[index].verified ? 'verified' : policies[index].reason,
        categories:[...CATEGORIES, 'Holder and X SOL reserve'].map((category, categoryIndex) => {
          const account = accounts[index * 8 + categoryIndex];
          const balance = BigInt(account?.lamports || 0);
          const standardVault = categoryIndex < 7;
          const accountValid = !account || account.owner?.equals(SystemProgram.programId)
            && Buffer.from(account.data || []).length === 0;
          const reward = !standardVault && account?.owner?.equals(new PublicKey(launch.pumpFeeRoute.programId))
            ? parseReserve(account) : null;
          const rewardValid = reward?.vault === rewardVaults[index].toBase58() && reward.asset === SOL_ASSET_MINT;
          const payable = standardVault ? policies[index].verified && accountValid
            ? policies[index].paidLamports[categoryIndex] - policies[index].withdrawnLamports[categoryIndex] : null
            : rewardValid ? BigInt(reward.outstanding) : null;
          const reserve = account ? standardVault ? rentReserve : rewardRentReserve : 0n;
          const excess = payable == null ? null : balance > reserve + payable ? balance - reserve - payable : 0n;
          const shortfall = payable == null ? null : balance < reserve + payable ? reserve + payable - balance : 0n;
          return { category, address:addresses[index * 8 + categoryIndex].toBase58(),
            lamports:String(balance), payableLamports:payable == null ? null : String(payable),
            rentReserveLamports:account ? String(reserve) : null,
            unassignedLamports:excess == null ? null : String(excess),
            shortfallLamports:shortfall == null ? null : String(shortfall),
            accountingStatus:!standardVault ? rewardValid ? 'verified' : 'reward-reserve-unverified' : !accountValid ? 'vault-account-unverified'
              : policies[index].verified ? 'verified' : 'policy-unverified',
            custody:'V3 program vault', withdrawable:false };
        }) }));
      return json(res, 200, { totalLaunches:launches.length, offset, nextOffset:offset + page.length < launches.length ? offset + page.length : null, vaults,
        note:'Category payable amounts are finalized policy paid minus withdrawn counters; the SOL reward reserve uses its outstanding counter. Unassigned excess is not authorized for withdrawal.' });
    }
    if (req.method === 'POST' && path === '/api/admin/withdrawals/prepare') {
      const input = await body(req) || {};
      const source = validWallet(input.source), destination = validWallet(input.destination);
      const amount = Number(input.amountLamports);
      if (!source || !roleAddresses().some(row => row.address === source && row.custody === 'external wallet' && row.withdrawable)
        || !destination || !withdrawalDestinations().has(destination)
        || !Number.isSafeInteger(amount) || amount < 1_000_000 || amount > 5_000_000_000
        || source === destination) return json(res, 400, { error:'Select a listed external source wallet, an allowed destination, and 0.001–5 Devnet SOL. Server signers and program vaults are not treasury withdrawal sources.' });
      const rpc = connection();
      if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'The configured RPC is not Solana Devnet.' });
      const balance = await rpc.getBalance(new PublicKey(source), 'finalized');
      if (balance - amount < 20_000_000) return json(res, 409, { error:'The source must retain at least 0.02 SOL for rent and operations.' });
      const blockhash = await rpc.getLatestBlockhash('finalized');
      const id = randomBytes(16).toString('hex');
      withdrawals.set(id, { source, destination, amount, blockhash:blockhash.blockhash,
        expiresAt:Date.now() + 120_000, requestedBy:session.wallet });
      if (withdrawals.size > 300) for (const [key, row] of withdrawals) if (row.expiresAt <= Date.now()) withdrawals.delete(key);
      return json(res, 200, { id, source, destination, amountLamports:amount,
        blockhash:blockhash.blockhash, lastValidBlockHeight:blockhash.lastValidBlockHeight,
        expiresAt:new Date(Date.now() + 120_000).toISOString(),
        note:'Only the source wallet can sign. This does not use a server-held key.' });
    }
    if (req.method === 'POST' && path === '/api/admin/withdrawals/verify') {
      const input = await body(req) || {};
      const plan = withdrawals.get(String(input.id || ''));
      const signature = String(input.signature || '');
      if (!plan || plan.expiresAt <= Date.now() || plan.requestedBy !== session.wallet
        || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
        return json(res, 409, { error:'The withdrawal review expired or the signature is invalid.' });
      const rpc = connection();
      if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'The configured RPC is not Solana Devnet.' });
      const transfer = await finalizedTransfer(rpc, signature);
      if (!transfer || transfer.source !== plan.source || transfer.destination !== plan.destination
        || transfer.amount !== plan.amount || transfer.tx.transaction.message.recentBlockhash !== plan.blockhash)
        return json(res, 409, { error:'No matching finalized one-transfer withdrawal and exact balance delta were found.' });
      const receipt = { action:'wallet-withdrawal', source:plan.source, destination:plan.destination,
        amountLamports:String(plan.amount), signature, wallet:session.wallet,
        slot:transfer.tx.slot, at:new Date().toISOString(), finalized:true, balanceDeltaVerified:true };
      await store.update(state => { state.adminAudit ||= {}; state.adminAudit[`withdraw:${signature}`] = receipt; return receipt; });
      withdrawals.delete(String(input.id));
      return json(res, 200, receipt);
    }
    if (req.method === 'POST' && path === '/api/admin/withdrawals/reconcile') {
      const input = await body(req) || {};
      const signature = String(input.signature || '');
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return json(res, 400, { error:'Enter a Solana transaction signature.' });
      const rpc = connection();
      if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'The configured RPC is not Solana Devnet.' });
      const transfer = await finalizedTransfer(rpc, signature);
      if (!transfer || !roleAddresses().some(row => row.address === transfer.source && row.custody === 'external wallet' && row.withdrawable)
        || !withdrawalDestinations().has(transfer.destination))
        return json(res, 409, { error:'No eligible finalized Devnet transfer with exact balance deltas was found.' });
      const receipt = await store.update(state => {
        state.adminAudit ||= {};
        const key = `withdraw:${signature}`;
        state.adminAudit[key] ||= { action:'wallet-withdrawal-reconciled', source:transfer.source,
          destination:transfer.destination, amountLamports:String(transfer.amount), signature,
          wallet:session.wallet, initiatedByAdmin:'unverified', slot:transfer.tx.slot,
          at:new Date().toISOString(), finalized:true, balanceDeltaVerified:true };
        return state.adminAudit[key];
      });
      return json(res, 200, receipt);
    }
    if (req.method === 'POST' && path === '/api/admin/fee-policy') {
      const input = await body(req) || {};
      let split;
      try { split = validateProtocolFeeSplit(input.split); protocolGrossUnits(split); }
      catch { return json(res, 400, { error:'The six rates must be nonnegative, representable on-chain, and total 100% of the protocol share.' }); }
      const expectedRevision = Number(input.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        return json(res, 400, { error:'The current policy revision is required.' });
      const saved = await store.update(state => {
        const revision = state.adminSettings?.protocolFeePolicy?.revision || 0;
        if (revision !== expectedRevision) return null;
        state.adminSettings ||= {};
        state.adminSettings.protocolFeePolicy = { split, revision:revision + 1, updatedAt:new Date().toISOString(), updatedBy:session.wallet };
        state.adminAudit ||= {};
        state.adminAudit[`fee-policy:${revision + 1}`] = { action:'fee-policy-updated', revision:revision + 1, wallet:session.wallet, at:state.adminSettings.protocolFeePolicy.updatedAt };
        return state.adminSettings.protocolFeePolicy;
      });
      if (!saved) return json(res, 409, { error:'The fee policy changed. Refresh and review it again.' });
      return json(res, 200, { ...saved, creatorPercent:80, protocolPercent:20, effectiveFor:'future launches only' });
    }
    if (req.method === 'GET' && path === '/api/admin/audit') {
      const state = await store.read();
      return json(res, 200, { entries:Object.values(state.adminAudit || {}).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100) });
    }
    return json(res, 404, { error:'Unknown admin action.' });
  };
}

export async function publicFeePolicy(store) {
  const state = await store.read();
  const policy = state.adminSettings?.protocolFeePolicy || { split:PROTOCOL_FEE_SPLIT, revision:0, updatedAt:null };
  const split = validateProtocolFeeSplit(policy.split);
  protocolGrossUnits(split);
  return { split, revision:policy.revision, updatedAt:policy.updatedAt || null,
    creatorPercent:80, protocolPercent:20, effectiveFor:'future launches only' };
}
