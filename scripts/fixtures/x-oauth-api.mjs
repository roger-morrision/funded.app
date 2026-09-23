// Explicit test subprocess only: never contact X, RPC, or retain a real identity.
if(process.env.FUNDED_AUTH_HTTP_FIXTURE !== '1' || !process.env.FUNDED_STORE_PATH || process.env.NODE_ENV !== 'test')throw new Error('Isolated auth fixture required.');
globalThis.fetch=async url=>{
  if(String(url)==='https://api.x.com/2/oauth2/token')return Response.json({access_token:'synthetic-token-not-persisted'});
  if(String(url).startsWith('https://api.x.com/2/users/me?'))return Response.json({data:{id:'9000001',username:'fixture',name:'Synthetic QA identity'}});
  throw new Error('External network is disabled in the auth fixture.');
};
await import('../../server/index.mjs');
