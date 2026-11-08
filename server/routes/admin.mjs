import { randomBytes } from 'node:crypto';
import { handleAdminServiceFees } from '../service-fees.mjs';
import {handleAdminXPosts} from '../admin-x-posts.mjs';
import { handleIssueAdmin } from './issue-admin.mjs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, PublicKey } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH } from '../automatic-reward-chain.mjs';
import {readAdminVaults} from '../admin-vaults.mjs';
import {readAdminRpcHealth} from '../admin-rpc-health.mjs';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';
import { validateProtocolFeeSplit } from '../../distribution-policy.js';
import { protocolGrossUnits } from '../../mint-router-v3.js';
import {reviewV3AllocationResiduals,recordV3AllocationResidualPlan} from '../v3-allocation-residuals.mjs';
import {verifyV3LaunchRouterReadiness} from '../v3-launch-readiness.mjs';
import {publishAgencyFeePolicy,prepareAgencyRules} from '../admin-agency-policy.mjs';
import {readAgencyDeployment} from '../agency-deployment.mjs';
import {createAdminEmailVerification,adminWriteNeedsEmail,ADMIN_EMAIL_AUTHORIZED} from '../admin-email-verification.mjs';
import {createV3RewardFundingRoutes} from './v3-reward-funding.mjs';
import {handleAdminBoostPricing} from '../admin-boost-pricing.mjs';
import {createAdminWallets} from '../admin-wallets.mjs';
import {createAdminWithdrawals} from '../admin-withdrawals.mjs';

const COOKIE = 'funded_admin';
const CHALLENGE_MS = 5 * 60_000;
const SESSION_MS = 30 * 60_000;
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

export function createAdminRoutes({ store, body:readBody, respond, solanaCluster, solanaRpcUrl, automaticRewardStore,
  keeperKeypair, referralPayoutKeypair, v3AuthorityKeypair, dailyBonusRuntime, env = process.env,
  connectionFactory = url => new Connection(url, 'finalized'),
  verifyResidualReadiness = verifyV3LaunchRouterReadiness,
  reviewResiduals = reviewV3AllocationResiduals,
  recordResidualPlan = recordV3AllocationResidualPlan, emailVerificationOptions = {},
  residualTransferFactory=createV3RewardFundingRoutes }) {
  const bodies=new WeakMap();
  const body=req=>{if(!bodies.has(req))bodies.set(req,Promise.resolve().then(()=>readBody(req)));return bodies.get(req);};
  const transferResidual=residualTransferFactory({body,store,solanaCluster,solanaRpcUrl,v3AuthorityKeypair,
    rewardStore:automaticRewardStore,respond,env});
  const challenges = new Map(), sessions = new Map(), attempts = new Map();
  const json = (res, status, value) => { respond(res, status, value); return true; };
  const allowed = () => new Set(String(env.FUNDED_ADMIN_WALLETS || '').split(',').map(value => validWallet(value.trim())).filter(Boolean));
  const origin = () => {
    try { return new URL(env.PUBLIC_APP_URL || env.CORS_ORIGIN || 'http://127.0.0.1:8787').origin; }
    catch { return null; }
  };
  const sameOrigin = req => String(req.headers.origin || '') === origin();
  const emailVerification=createAdminEmailVerification({...emailVerificationOptions,env,cluster:solanaCluster,origin});
  const currentSession = req => {
    const token = cookieValue(req, COOKIE);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now() || !allowed().has(session.wallet)) {
      emailVerification.revoke(token);
      sessions.delete(token); return null;
    }
    return session;
  };
  const setCookie = (res, value, maxAge) => {
    res.setHeader('set-cookie', `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin()?.startsWith('https:') ? '; Secure' : ''}`);
  };
  const connection = () => connectionFactory(solanaRpcUrl);
  const inventory=createAdminWallets({env,keeperKeypair,v3AuthorityKeypair,referralPayoutKeypair});
  const roleAddresses=inventory.roles;
  const handleWithdrawals=createAdminWithdrawals({store,env,connection,roles:roleAddresses,signerFor:inventory.signerFor});
  return async function handleAdminRoutes(req, res, url) {
    if (!url.pathname.startsWith('/api/admin/')) return false;
    if (solanaCluster !== 'devnet') return json(res, 403, { error:'This admin workspace is Devnet-only.' });
    res.setHeader('cache-control', 'no-store');
    const path = url.pathname;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&url.search)
      return json(res,400,{error:'Admin write requests must not include query parameters.'});
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error:'Admin requests require the configured app origin.' });
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
      for(const [oldId,old]of sessions)if(old.wallet===wallet||old.expiresAt<=Date.now()){
        sessions.delete(oldId);emailVerification.revoke(oldId);
      }
      sessions.set(token, { wallet, expiresAt });
      setCookie(res, token, Math.floor(SESSION_MS / 1_000));
      return json(res, 200, { wallet, expiresAt:new Date(expiresAt).toISOString() });
    }
    const session = currentSession(req);
    if (!session) return json(res, 401, { error:'Sign in with the configured admin wallet.' });
    const sessionId=cookieValue(req,COOKIE);
    if(path==='/api/admin/email-confirmation'){
      if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
      try{
        const input=await body(req)||{};
        const confirmation=await emailVerification.issue({sessionId,wallet:session.wallet,
          method:input.method,path:input.path,payload:input.payload});
        if(currentSession(req)!==session){emailVerification.revoke(sessionId);return json(res,401,{error:'Admin session ended.'});}
        return json(res,200,confirmation);
      }catch(error){return json(res,error.status||503,{error:error.message});}
    }
    if(req.method==='POST'&&path==='/api/admin/logout')emailVerification.revoke(sessionId);
    if(adminWriteNeedsEmail(req.method,path)){
      try{
        const input=await body(req)||{};
        if(currentSession(req)!==session)return json(res,401,{error:'Admin session ended.'});
        const continuation=req.method==='POST'?await handleWithdrawals.authorizeContinuation({session,sessionId,path,input}):null;
        const proof=continuation||emailVerification.consume({sessionId,wallet:session.wallet,method:req.method,path,
          payload:input,id:req.headers['x-admin-confirmation-id'],code:req.headers['x-admin-confirmation-code']});
        if(!continuation)await store.update(state=>{state.adminAudit||={};state.adminAudit[`email-confirmation:${proof.id}`]={
          action:'email-confirmation-consumed',...proof,note:'Authorizes one API attempt; does not prove the action succeeded.'};});
        if(currentSession(req)!==session)return json(res,401,{error:'Admin session ended.'});
        req[ADMIN_EMAIL_AUTHORIZED]=proof;
      }catch(error){return json(res,error.status||503,{error:error.status?error.message:'Admin verification audit is unavailable. No action was executed.',
        ...(error.status===403?{code:'ADMIN_EMAIL_CONFIRMATION_FAILED'}:{})});}
    }
    if(req.method==='POST'&&path==='/api/admin/v3-allocations/transfer'){
      const input=await body(req),mint=validWallet(input.mint),signature=String(input.collectionSignature||'');
      if(!mint||!['creator-wallet','creator-reward'].includes(input.kind)||!/^[a-f0-9]{64}$/.test(input.residualPlanHash||'')
        ||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))return json(res,400,{error:'A valid reviewed residual transfer is required.'});
      const suffix=input.kind==='creator-wallet'?'payout':'funding';
      return transferResidual(req,res,new URL(`/api/tokens/${mint}/v3-${input.kind}-${suffix}/${signature}`,origin()));
    }
    if(req.method==='GET'&&path==='/api/admin/rpc-health'){
      try{return json(res,200,await readAdminRpcHealth({env}));}
      catch{return json(res,503,{error:'RPC gateway health is unavailable. Refresh to retry.'});}
    }
    if(await handleAdminBoostPricing({req,res,url,store,body,json,session}))return true;
    if(await handleIssueAdmin(req,res,url,{store,body,json}))return true;
    if(req.method==='GET'&&path==='/api/admin/financial-health'){
      const health=(await automaticRewardStore?.read?.())?.financialFlowHealth;
      return health?json(res,200,health):json(res,503,{error:'Financial monitoring is warming up.'});
    }
    if(await handleAdminXPosts({req,res,url,body,respond,session,env}))return true;
    if(path==='/api/admin/agency-rules' && ['GET','POST'].includes(req.method)){
      try{
        const args={connection:connection(),programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,
          approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,authority:v3AuthorityKeypair().publicKey};
        return json(res,200,req.method==='GET'?await readAgencyDeployment(args):await prepareAgencyRules({...args,input:await body(req)||{}}));
      }catch(error){return json(res,409,{error:String(error.message||'Agency settings unavailable.')});}
    }
    if(req.method==='POST'&&path==='/api/admin/agency-fee-policy'){
      try{return json(res,200,await publishAgencyFeePolicy({store,connection:connection(),
        programId:env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,approvedHash:env.FUNDED_V3_PROGRAM_DATA_SHA256,
        authority:v3AuthorityKeypair().publicKey,actor:session.wallet,input:await body(req)||{}}));}
      catch{return json(res,409,{error:'Agency configuration proof is unavailable or mismatched. Refresh the revision and verify the finalized authority signature.'});}
    }
    if (await handleAdminServiceFees({ req,res,url,store,body,respond,session })) return true;
    if (req.method === 'GET' && path === '/api/admin/session')
      return json(res, 200, { wallet:session.wallet, expiresAt:new Date(session.expiresAt).toISOString() });
    const residualAction=req.method==='POST'&&path.match(/^\/api\/admin\/v3-allocations\/(review|approve)$/);
    if(residualAction){
      try{
        const input=await body(req),mint=validWallet(input?.mint),launch=(await store.read()).launches?.[mint];
        if(!mint||!launch||launch.cluster!=='devnet'||!launch.onchainVerified
          ||launch.pumpFeeRoute?.programId!==env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID)
          throw new Error('A verified registered Devnet V3 mint is required.');
        const rpc=connection(),programId=env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
        if(await rpc.getGenesisHash()!==DEVNET_GENESIS_HASH)throw new Error('Residual RPC is not Devnet.');
        const ready=await verifyResidualReadiness({connection:rpc,programId,mint,
          expectedProgramDataSha256:env.FUNDED_V3_PROGRAM_DATA_SHA256,creatorWallet:launch.creatorWallet,
          initialAuthority:launch.pumpFeeRoute?.initialAuthority,split:launch.pumpFeeRoute?.protocolSplit});
        if(!ready.ready||ready.programId!==programId)
          throw new Error('The reviewed V3 program, router and immutable mint policy are required.');
        const options={store,connection:rpc,mint};
        const reviewed=await reviewResiduals(options);
        if(ready.protectedPolicy&&reviewed.status!=='reviewed-residual-not-paid')
          throw new Error('Protected residual review requires the verified beneficiary policy.');
        if(!ready.protectedPolicy&&(reviewed.status!=='reviewed-legacy-preservation-no-transfer'
          ||reviewed.programId!==programId||reviewed.mint!==mint||!/^[a-f0-9]{64}$/.test(reviewed.hash||'')
          ||!Array.isArray(reviewed.sources)||!reviewed.sources.length
          ||reviewed.sources.some(source=>!Array.isArray(source.unreleasedLamports)
            ||source.unreleasedLamports.length!==3||source.unreleasedLamports.some(amount=>amount!=='0'))))
          throw new Error('An unprotected legacy mint permits only a verified no-transfer preservation plan.');
        if(residualAction[1]==='approve'&&input.expectedHash!==reviewed.hash)
          throw new Error('The approved residual evidence changed after review.');
        const result=residualAction[1]==='review'?reviewed
          :await recordResidualPlan({...options,expectedHash:input.expectedHash,reason:input.reason,actor:session.wallet});
        if(residualAction[1]==='approve'&&result.plan?.hash!==reviewed.hash)
          throw new Error('The approved residual evidence changed after review.');
        return json(res,200,result);
      }catch(error){return json(res,409,{error:String(error.message||error)});}
    }
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
        withdrawalDestination:session.wallet,
        gates:{ launch:env.FUNDED_V3_LAUNCH_ENABLED === 'true', collection:env.FUNDED_V3_COLLECTION_ENABLED === 'true',
          settlement:env.FUNDED_V3_SETTLEMENT_ENABLED === 'true', holder:env.FUNDED_V3_HOLDER_WORKER_ENABLED === 'true',
          automaticSettlement:env.FUNDED_V3_AUTO_SETTLEMENT_ENABLED==='true',automaticPayouts:env.FUNDED_V3_AUTO_DISBURSEMENT_ENABLED==='true',
          agencyBuybacks:env.FUNDED_V3_AGENCY_BUYBACK_ENABLED==='true',rpcGateway:env.FUNDED_RPC_GATEWAY_ENABLED==='true',
          referral:env.FUNDED_V3_REFERRAL_PAYOUT_ENABLED === 'true', xClaims:env.FUNDED_V3_X_CLAIMS_ENABLED === 'true',
          buyback:env.FUNDED_V3_BUYBACK_ENABLED === 'true' } });
    }
    if (req.method === 'GET' && path === '/api/admin/vaults') {
      const state = await store.read();
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return json(res, 400, { error:'Invalid vault page.' });
      try{return json(res,200,await readAdminVaults({state,offset,rpc:connection()}));}
      catch(error){return json(res,503,{error:String(error.message||'Vault balances unavailable.')});}
    }
    if(await handleWithdrawals(req,res,url,{session,sessionId,body,json}))return true;
    if (req.method === 'POST' && path === '/api/admin/fee-policy') {
      const input = await body(req) || {};
      if(input.split?.agencyPercent!==undefined)return json(res,409,{error:'Agency fee changes require a verified on-chain future-mint configuration update. Off-chain activation is not supported.'});
      let split;
      try { split = validateProtocolFeeSplit(input.split); protocolGrossUnits(split); }
      catch { return json(res, 400, { error:'The six rates must be nonnegative, representable on-chain, and total 100% of the protocol share.' }); }
      const expectedRevision = Number(input.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        return json(res, 400, { error:'The current policy revision is required.' });
      const saved = await store.update(state => {
        if(state.adminSettings?.protocolFeePolicy?.split?.agencyPercent!==undefined)return null;
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
