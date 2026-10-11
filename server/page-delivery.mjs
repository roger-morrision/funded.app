import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { staticCacheControl } from './http-policy.mjs';
import { isAppPagePath } from './page-routes.mjs';
import { creatorPageHtml } from './creator-social.mjs';
import { tokenPageHtml } from './token-social.mjs';
import { publicMetadata } from './devnet-metadata.mjs';

// Keep the public metadata lookup before API dispatch and page fallbacks after it.
export function createPageDelivery({ staticRoot, store, solanaCluster, feeRouterConfig, respond }) {
  const json = (...args) => { respond(...args); return true; };
  const end = (res, content) => { res.end(content); return true; };
  async function serveStatic(pathname, res) {
    const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = resolve(staticRoot, fileName);
    if (!filePath.startsWith(`${staticRoot}${sep}`)) return json(res, 404, { error: 'Not found.' });
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
      '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { 'content-type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream', 'cache-control': staticCacheControl(fileName), 'x-content-type-options': 'nosniff' });
      return end(res, content);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, 404, { error: 'Not found.' });
      throw error;
    }
  }

  async function handlePublicMetadata(req, res, url, metadataHost) {
    if (req.method === 'GET' && url.pathname === '/default.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
      return end(res, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#111827"/><circle cx="128" cy="128" r="68" fill="#d7b65d"/><text x="128" y="148" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="70" fill="#111827">F</text></svg>');
    }
    const publicMint = req.method === 'GET' ? url.pathname.match(/^\/devnet-(?:metadata|images|banners)\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (publicMint && url.pathname.startsWith('/devnet-banners/')) {
      const banner = await store.readMetadataBanner(publicMint);
      if (!banner) return json(res, 404, { error: 'Banner not found.' });
      res.writeHead(200, { 'content-type': banner.mime, 'content-length': banner.bytes.length, 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
      return end(res, banner.bytes);
    }
    if (publicMint && url.pathname.startsWith('/devnet-images/')) {
      const image = await store.readMetadataImage(publicMint);
      if (!image) return json(res, 404, { error: 'Image not found.' });
      res.writeHead(200, { 'content-type': image.mime, 'content-length': image.bytes.length, 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
      return end(res, image.bytes);
    }
    if (publicMint && url.pathname.startsWith('/devnet-metadata/')) {
      const prepared = await store.readMetadata(publicMint);
      if (prepared) return json(res, 200, publicMetadata(prepared));
      if (metadataHost) return json(res, 404, { error: 'Solana metadata not found.' });
    }
    return false;
  }

  async function handlePages(req, res, url) {
    const metadataMint = req.method === 'GET' ? url.pathname.match(/^\/devnet-metadata\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (metadataMint) {
      const launch = await store.readLaunch(metadataMint);
      const routerAddress = feeRouterConfig()?.address.toBase58();
      if (!launch || launch.cluster !== 'devnet' || !launch.onchainVerified || launch.creator !== routerAddress || !launch.name || !launch.symbol) return json(res, 404, { error: 'Verified Solana launch metadata is not available.' });
      return json(res, 200, { name: launch.name, symbol: launch.symbol, description: 'Token launched on funded.vip.', image: 'https://funded.vip/favicon.svg' });
    }
    if (req.method === 'GET' && /^\/creator\/x\/\d{1,24}\/?$/.test(url.pathname)) {
      const creatorId=url.pathname.split('/')[3];
      const html = creatorPageHtml(await readFile(resolve(staticRoot, 'index.html'), 'utf8'), await store.readCreatorState(creatorId,solanaCluster,{financial:false}), creatorId, solanaCluster);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return end(res, html);
    }
    const tokenPageMint=req.method==='GET'?url.pathname.match(/^\/(?:token|launch\/coin)\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/)?.[1]:null;
    if(tokenPageMint){
      const [template,launch,metadata]=await Promise.all([readFile(resolve(staticRoot,'index.html'),'utf8'),store.readLaunch(tokenPageMint),store.readMetadata(tokenPageMint)]);
      const page=tokenPageHtml(template,launch,metadata,tokenPageMint,solanaCluster,undefined,url.search);
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});return end(res, page);
    }
    if (req.method === 'GET' && isAppPagePath(url.pathname)) return await serveStatic('/', res);
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return await serveStatic(url.pathname, res);
    return false;
  }

  return { handlePublicMetadata, handlePages };
}
