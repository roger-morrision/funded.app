const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function tokenSocialModel(launch, metadata, mint, cluster, publicOrigin='') {
  const verified=Boolean(launch?.mint===mint&&launch.cluster===cluster&&launch.onchainVerified===true&&launch.policySignature&&launch.name&&launch.symbol);
  if(!verified)return {available:false,title:'Token verification unavailable | funded.vip',description:'This token is not verified in the current app registry. Do not infer safety or endorsement.',canonical:null,image:null};
  const signed=metadata?.mint===mint&&metadata.creatorWallet===launch.creatorWallet&&metadata.name===launch.name&&metadata.symbol===launch.symbol;
  const purpose=signed?String(metadata.tagline||metadata.description||'').slice(0,160):'';
  let origin=null;try{const url=new URL(publicOrigin);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)origin=url.origin;}catch{}
  return {available:true,title:`${String(launch.name).slice(0,32)} (${String(launch.symbol).slice(0,10)}) | funded.vip (${cluster})`,
    description:`${purpose?purpose+' ':''}Review the canonical mint and fee policy. Not an endorsement. Tokens can lose all value. ${cluster==='devnet'?'Devnet test assets have no intended monetary value.':''}`,
    canonical:origin?`${origin}/token/${mint}`:null,image:origin&&signed&&metadata.imageSha256&&cluster==='devnet'?`${origin}/devnet-images/${mint}`:null};
}
export function tokenPageHtml(template, launch, metadata, mint, cluster, publicOrigin=process.env.PUBLIC_APP_URL) {
  const model=tokenSocialModel(launch,metadata,mint,cluster,publicOrigin);
  const tags=`<meta property="og:type" content="website" /><meta property="og:title" content="${escape(model.title)}" /><meta property="og:description" content="${escape(model.description)}" /><meta name="twitter:card" content="${model.image?'summary_large_image':'summary'}" />${model.canonical?`<link rel="canonical" href="${escape(model.canonical)}" /><meta property="og:url" content="${escape(model.canonical)}" />`:''}${model.image?`<meta property="og:image" content="${escape(model.image)}" /><meta property="og:image:alt" content="Token image signed by the launcher; not an endorsement" />`:''}${model.available?'':'<meta name="robots" content="noindex" />'}`;
  return template.replace(/<title>[^<]*<\/title>/,`<title>${escape(model.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/,`<meta name="description" content="${escape(model.description)}" />`).replace('</head>',`${tags}</head>`);
}
