import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { issueOperationContext } from '../../issue-context.js';
import { readJsonBody } from '../request-body.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import {reviewProductIssue} from '../product-issue-review.mjs';
export {issueStates} from '../product-issue-review.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export function validateIssue(input) {
  if (!input || typeof input.description !== 'string' || input.description.trim().length < 10 || input.description.length > 2000
    || !['bug','impersonation','spam','request'].includes(input.category)) throw new Error('Choose a category and describe the issue in 10–2000 characters.');
  const context = input.context || {};
  return {category:input.category,description:input.description.trim(),context:{cluster:'devnet',...issueOperationContext(context),
    route:typeof context.route === 'string' && /^\/[A-Za-z0-9/_#-]*$/.test(context.route) ? context.route.slice(0,160) : '/',
    mint:/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(context.mint || '') ? context.mint : null,
    signature:/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(context.signature || '') ? context.signature : null}};
}
export function createProductIssueRoutes({store,cluster,requireAuthorized}) {
  return async (req,res,url) => {
    if (!url.pathname.startsWith('/api/creator-support/issues')) return false;
    const json = (status,body) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));return true;};
    if (cluster !== 'devnet') return json(503,{error:'Issue reporting is available on the Devnet app.'});
    if (req.method === 'GET' && url.pathname.endsWith('/config')) return json(200,{enabled:true,cluster,tokenHoldingRequired:false});
    const id = url.pathname.match(/^\/api\/creator-support\/issues\/([a-f0-9]{32})(?:\/status)?$/)?.[1];
    if (req.method === 'POST') {
      if (!allowedAuthOrigin(req,process.env.CORS_ORIGIN)) return json(403,{error:'Submit from the app origin.'});
      if (id && url.pathname.endsWith('/status')) {
        if (!requireAuthorized || !requireAuthorized(req,res)) return requireAuthorized ? true : json(503,{error:'Operator review is unavailable.'});
        const result=await reviewProductIssue({store,id,input:await readJsonBody(req,{maxBytes:1000})});
        return json(result.status,result.data);
      }
      if (url.pathname !== '/api/creator-support/issues') return json(404,{error:'Report route not found.'});
      const client = req.socket?.remoteAddress || 'local';
      if (!await store.chargeRpcRate(`product-issue:${client}`,1,2,Math.floor(Date.now()/60000)*60000)
        || !await store.chargeRpcRate('product-issues:global',1,200,Math.floor(Date.now()/86400000)*86400000)) return json(429,{error:'Reporting is busy. Save a copy and try later.'});
      let value;try{value=validateIssue(await readJsonBody(req,{maxBytes:5000}));}catch(error){return json(400,{error:error.statusCode ? 'Report is too large or malformed.' : error.message});}
      const reportId=randomBytes(16).toString('hex'), token=randomBytes(24).toString('hex'), at=new Date().toISOString();
      await store.update(state=>{
        const rows = state.productIssues ||= {};
        for (const [key,row] of Object.entries(rows)) if (Date.parse(row.updatedAt || row.createdAt) < Date.now()-90*86400000) delete rows[key];
        if (Object.keys(rows).length >= 1000) throw new Error('Report storage is at capacity.');
        rows[reportId]={...value,id:reportId,status:'received',createdAt:at,updatedAt:at,tokenHash:hash(token),note:''};
      });
      return json(201,{id:reportId,token,status:'received',createdAt:at});
    }
    if (req.method === 'GET' && id) {
      if (!await store.chargeRpcRate(`product-issue-read:${req.socket?.remoteAddress || 'local'}`,1,30,Math.floor(Date.now()/60000)*60000)) return json(429,{error:'Wait before checking again.'});
      const row=(await store.read()).productIssues?.[id], token=String(req.headers['x-issue-token'] || '');
      if (!row || !/^[a-f0-9]{48}$/.test(token) || !/^[a-f0-9]{64}$/.test(row.tokenHash || '')
        || !timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(row.tokenHash,'hex'))) return json(404,{error:'Report is unavailable on this device.'});
      return json(200,{id:row.id,status:row.status,note:row.note,createdAt:row.createdAt,updatedAt:row.updatedAt});
    }
    return json(405,{error:'Method not allowed.'});
  };
}
