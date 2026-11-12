import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { staticCacheControl } from './http-policy.mjs';
import { isAppPagePath } from './page-routes.mjs';
import { creatorPageHtml } from './creator-social.mjs';
import { tokenPageHtml } from './token-social.mjs';
import { publicMetadata } from './devnet-metadata.mjs';
import { tokenPlaceholderSvg } from './token-placeholder.mjs';
import { publicDiscoveryHtml } from './public-discovery.mjs';
import { normalizeDevnetMetadataOrigin } from '../devnet-metadata.js';

// Keep the public metadata lookup before API dispatch and page fallbacks after it.
export function createPageDelivery({ staticRoot, store, solanaCluster, respond, readTokenName = async () => null }) {
  // index.html changes only with a new build; keep it in memory for a minute.
  let templateCache = null, homeHtml = null;
  const readTemplate = async () => {
    if (!templateCache || Date.now() - templateCache.at > 60_000) templateCache = { at: Date.now(), html: await readFile(resolve(staticRoot, 'index.html'), 'utf8') };
    return templateCache.html;
  };
  const json = (...args) => { respond(...args); return true; };
  const end = (res, content) => { res.end(content); return true; };
  let discoveryCache = { expiresAt: 0, launches: [] };
  let discoveryInflight = null;
  async function recentLaunches() {
    if (Date.now() < discoveryCache.expiresAt) return discoveryCache.launches;
    if (!discoveryInflight) discoveryInflight = store.readLaunches({ limit: 80 })
      .then(launches => {
        discoveryCache = { expiresAt: Date.now() + 30_000, launches };
        return launches;
      })
      .catch(() => {
        discoveryCache = { expiresAt: Date.now() + 5_000, launches: null };
        return null;
      })
      .finally(() => { discoveryInflight = null; });
    return discoveryInflight;
  }
  async function serveStatic(pathname, res) {
    const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = resolve(staticRoot, fileName);
    if (!filePath.startsWith(`${staticRoot}${sep}`)) return json(res, 404, { error: 'Not found.' });
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
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
    const readRequest = req.method === 'GET' || req.method === 'HEAD';
    if (readRequest && url.pathname === '/default.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
      return end(res, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#111827"/><circle cx="128" cy="128" r="68" fill="#d7b65d"/><text x="128" y="148" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="70" fill="#111827">F</text></svg>');
    }
    const publicMint = readRequest ? url.pathname.match(/^\/(?:devnet-(?:metadata|images|banners)|m)\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (publicMint && url.pathname.startsWith('/devnet-banners/')) {
      const banner = await store.readMetadataBanner(publicMint);
      if (!banner) return json(res, 404, { error: 'Banner not found.' });
      res.writeHead(200, { 'content-type': banner.mime, 'content-length': banner.bytes.length, 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
      return end(res, banner.bytes);
    }
    if (publicMint && url.pathname.startsWith('/devnet-images/')) {
      const image = await store.readMetadataImage(publicMint);
      if (!image) {
        const launch = await store.readLaunch(publicMint);
        if (launch?.mint !== publicMint || launch.cluster !== 'devnet' || launch.onchainVerified !== true
          || !launch.policySignature || !launch.symbol) return json(res, 404, { error: 'Image not found.' });
        const avatar = Buffer.from(tokenPlaceholderSvg(publicMint, launch.symbol));
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-length': avatar.length, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'access-control-allow-origin': '*' });
        return end(res, avatar);
      }
      res.writeHead(200, { 'content-type': image.mime, 'content-length': image.bytes.length, 'cache-control': 'public, max-age=86400, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
      return end(res, image.bytes);
    }
    if (publicMint && (url.pathname.startsWith('/devnet-metadata/')||url.pathname.startsWith('/m/'))) {
      const prepared = await store.readMetadata(publicMint);
      if (prepared) return json(res, 200, publicMetadata(prepared));
      if (metadataHost) return json(res, 404, { error: 'Solana metadata not found.' });
    }
    return false;
  }

  async function handlePages(req, res, url) {
    const readRequest = req.method === 'GET' || req.method === 'HEAD';
    const metadataMint = readRequest ? url.pathname.match(/^\/(?:devnet-metadata|m)\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1] : null;
    if (metadataMint) {
      const launch = await store.readLaunch(metadataMint);
      if (!launch || launch.cluster !== 'devnet' || !launch.onchainVerified
        || launch.pumpFeeRoute?.scope !== 'per-mint-v3' || launch.pumpFeeRoute.verified !== true
        || launch.pumpFeeRoute.router !== launch.creator || !launch.pumpFeeRoute.programId
        || !launch.name || !launch.symbol) return json(res, 404, { error: 'Verified V3 launch metadata is not available.' });
      return json(res, 200, { name: launch.name, symbol: launch.symbol, description: 'Token launched on richpad.fun.', image: `${normalizeDevnetMetadataOrigin(process.env.PUBLIC_APP_URL || process.env.DEVNET_METADATA_ORIGIN)}/favicon.svg` });
    }
    if (readRequest && /^\/creator\/x\/\d{1,24}\/?$/.test(url.pathname)) {
      const creatorId=url.pathname.split('/')[3];
      const html = creatorPageHtml(await readTemplate(), await store.readCreatorState(creatorId,solanaCluster,{financial:false}), creatorId, solanaCluster);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return end(res, html);
    }
    const tokenPageMint=readRequest?url.pathname.match(/^\/(?:token|launch\/coin)\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/)?.[1]:null;
    if(tokenPageMint){
      const [template,launch,metadata,indexed]=await Promise.all([readTemplate(),store.readLaunch(tokenPageMint),store.readMetadata(tokenPageMint),readTokenName(tokenPageMint)]);
      const page=tokenPageHtml(template,launch,metadata,tokenPageMint,solanaCluster,undefined,url.search,indexed);
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});return end(res, page);
    }
    if (readRequest && /^\/welcome\/?$/.test(url.pathname)) return await serveStatic('/welcome.html', res);
    if (readRequest && (url.pathname === '/admin' || url.pathname === '/admin/')) return await serveStatic('/admin.html', res);
    if (readRequest && ['/', '/explore', '/explore/'].includes(url.pathname)) {
      // The public home HTML is the same for every visitor: rebuild it at most every 10 s.
      if (!homeHtml || Date.now() - homeHtml.at > 10_000) {
        const [template, launches] = await Promise.all([readTemplate(), recentLaunches()]);
        homeHtml = { at: Date.now(), html: publicDiscoveryHtml(template, launches, solanaCluster) };
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return end(res, homeHtml.html);
    }
    if (readRequest && isAppPagePath(url.pathname)) return await serveStatic('/', res);
    if (readRequest && !url.pathname.startsWith('/api/')) return await serveStatic(url.pathname, res);
    return false;
  }

  return { handlePublicMetadata, handlePages };
}
