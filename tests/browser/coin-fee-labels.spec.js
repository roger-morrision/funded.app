import { test, expect } from '@playwright/test';
import { PROTOCOL_FEE_SPLIT } from '../../config/protocol-fee-split.js';

test('mobile collection and allocation labels never imply recipient payments', async ({ page }) => {
  const mint = '26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg';
  const signature = '3'.repeat(64);
  await page.setViewportSize({width:390, height:844});
  await page.route('**/api/**', route => route.fulfill({status:503, json:{error:'Offline fee-label fixture'}}));
  await page.route('**/api/fee-policy', route => route.fulfill({json:{split:PROTOCOL_FEE_SPLIT}}));
  await page.route(`**/api/tokens/${mint}/fee-activity`, route => route.fulfill({json:{
    mint, cluster:'devnet', overview:{available:true, scope:'per-mint-v3'},
    collections:[{signature, collectedLamports:'2462530', recordedAt:'2026-10-17T00:00:00Z'}],
    claims:[{claimSignature:signature, grossCreatorFees:'0.00246253', asset:'SOL',
      status:'allocated-not-funded', claimedAt:'2026-10-17T00:00:00Z'}],
  }}));
  await page.route('https://**/*', route => route.abort());
  await page.goto(`/token/${mint}`);
  await expect(page.locator('body')).toHaveClass(/workspace-ready/);
  await page.getByRole('tab', {name:/^Fee collections/}).click();
  const table = page.locator('#coin-activity-list .coin-fee-table');
  await expect(table).toContainText('0.00246253 SOL');
  const labels = () => table.locator('tbody tr').first().locator('td').evaluateAll(cells =>
    cells.map(cell => getComputedStyle(cell,'::before').content.replaceAll('"','')));
  expect(await labels()).toEqual(['none','Event','Amount collected','USD estimate','Collection transaction']);
  await page.getByRole('tab', {name:/^Allocations/}).click();
  await expect(table).toContainText('Allocated not funded');
  expect(await labels()).toEqual(['none','Event','Gross fees','Allocation status','Related collection']);
  await page.screenshot({path:test.info().outputPath('mobile-fee-labels-mocked.png'), fullPage:true});
});


// FQA-037 / UX-030: actual bootstrap fixtures; original labels case above is raw-preserved.
function observeCollectionRegion(original, readiness = {}) {
  const began = performance.now();
  return new Promise(resolve => {
    const samples = []; let stationaryAt = null, previous = null, frame;
    const finish = pass => { cancelAnimationFrame(frame); clearTimeout(timer); resolve({ pass, samples }); };
    const tick = () => {
      const element = original, rect = element?.getBoundingClientRect();
      const style = element && getComputedStyle(element);
      const edge = style ? (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0) : 0;
      const bounds = { left:0, right:innerWidth, top:0, bottom:innerHeight }, clips = [];
      let cornersClear = true;
      const rootStyle = getComputedStyle(document.documentElement);
      const root = { tag:document.documentElement.tagName, display:rootStyle.display,
        overflowX:rootStyle.overflowX, overflowY:rootStyle.overflowY, contain:rootStyle.contain };
      for (const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
        if (chrome.contains(element)) continue;
        if (!chrome.getClientRects().length) continue;
        const r = chrome.getBoundingClientRect();
        if (chrome.matches('.topbar')) bounds.top = Math.max(bounds.top, r.bottom);
        else bounds.bottom = Math.min(bounds.bottom, r.top);
      }
      for (let ancestor = element?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
        const clipX = /^(hidden|clip|auto|scroll)$/.test(css.overflowX);
        const clipY = /^(hidden|clip|auto|scroll)$/.test(css.overflowY);
        if (clipX || clipY) {
          // CSS Overflow 3: root overflow, or body overflow when the HTML root
          // is visible in both axes, is propagated to the viewport. Its used
          // clip is not its translated document-coordinate border rectangle.
          const viewportClip = ancestor === document.documentElement || (ancestor === document.body
            && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
            && rootStyle.contain === 'none' && css.contain === 'none');
          if (viewportClip) { clips.push({ tag:ancestor.tagName, display:css.display, overflowX:css.overflowX,
            overflowY:css.overflowY, contain:css.contain, viewportClip:true,
            propagationReason:ancestor === document.documentElement ? 'root overflow applies to viewport' : 'visible HTML root propagates body overflow to viewport',
            left:0, top:0, right:innerWidth, bottom:innerHeight }); continue; }
          const box = { left:r.left + ancestor.clientLeft, top:r.top + ancestor.clientTop,
            right:r.left + ancestor.clientLeft + ancestor.clientWidth,
            bottom:r.top + ancestor.clientTop + ancestor.clientHeight };
          const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
            .map(key => Math.max(0, (parseFloat(css[key]) || 0) - ancestor.clientLeft));
          if (rect && clipX && clipY) {
            const points = [[rect.left-edge,rect.top-edge],[rect.right+edge,rect.top-edge],
              [rect.right+edge,rect.bottom+edge],[rect.left-edge,rect.bottom+edge]];
            const centers = [[box.left+radii[0],box.top+radii[0]],[box.right-radii[1],box.top+radii[1]],
              [box.right-radii[2],box.bottom-radii[2]],[box.left+radii[3],box.bottom-radii[3]]];
            for (let i=0;i<4;i++) { const radius=radii[i], [x,y]=points[i], [cx,cy]=centers[i];
              const inCorner = (i===0||i===3 ? x<cx : x>cx) && (i<2 ? y<cy : y>cy);
              if (radius && inCorner && (x-cx)**2+(y-cy)**2>radius**2) cornersClear=false;
            }
          }
          clips.push({ id:ancestor.id, tag:ancestor.tagName, display:css.display, overflowX:css.overflowX,
            overflowY:css.overflowY, contain:css.contain, clipX, clipY, radii, ...box });
          if (clipX) { bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right); }
          if (clipY) { bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom); }
        }
      }
      const position = rect && { top:rect.top, bottom:rect.bottom, left:rect.left, right:rect.right };
      const ready = element?.getAttribute('role') === 'region'
        && element.getAttribute('tabindex') === '0'
        && element.getAttribute('aria-label') === readiness.label;
      const clear = Boolean(ready && element.isConnected && rect && cornersClear && element === document.activeElement && element.matches(':focus-visible')
        && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
        && rect.left - edge >= bounds.left && rect.right + edge <= bounds.right
        && rect.top - edge >= bounds.top && rect.bottom + edge <= bounds.bottom);
      const now = performance.now(), geometry = JSON.stringify([position, scrollX, scrollY, bounds]);
      if (clear) { if (stationaryAt === null || previous !== geometry) stationaryAt = now; }
      else stationaryAt = null;
      previous = geometry;
      samples.push({ at:now - began, clear, ready, position, edge, bounds, clips, root, cornersClear,
        stationaryMs:stationaryAt === null ? 0 : now - stationaryAt });
      if (now - began > 1000) return finish(false);
      if (clear && now - stationaryAt >= 100) return finish(true);
      frame = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish(false), 1000);
    frame = requestAnimationFrame(tick);
  });
}

async function armCollectionTab(original, label) {
  await original.evaluate((element, { source, label }) => {
    let resolve;
    const state = window.__collectionRegionFocus = { promise: new Promise(r => { resolve = r; }), events: [] };
    const changed = event => state.events.push({ original: event.target === element, id: event.target.id });
    document.addEventListener('focusin', changed, true);
    const begin = event => {
      if (!event.isTrusted || event.key !== 'Tab') return;
      document.removeEventListener('keydown', begin, true);
      state.began = performance.now(); state.key = { key: event.key, trusted: event.isTrusted };
      (new Function('return (' + source + ')')())(element, { label }).then(proof => {
        document.removeEventListener('focusin', changed, true);
        resolve({ proof, key: state.key, events: state.events, began: state.began, ended: performance.now(),
          connected: element.isConnected, active: document.activeElement === element });
      });
    };
    document.addEventListener('keydown', begin, true);
  }, { source: observeCollectionRegion.toString(), label });
}
async function checkCollectionTab(page) {
  const proof = await page.evaluate(() => window.__collectionRegionFocus.promise);
  await test.info().attach('collection-original-native-Tab-proof', { body: JSON.stringify(proof), contentType: 'application/json' });
  expect(proof.proof.pass, JSON.stringify(proof)).toBe(true);
  expect(proof.ended - proof.began).toBeLessThanOrEqual(1000);
  expect(proof.proof.samples.at(-1).stationaryMs).toBeGreaterThanOrEqual(100);
  expect(proof.connected && proof.active).toBe(true);
  expect(proof.events.every(e => e.original)).toBe(true);
  expect(proof.key).toEqual({ key: 'Tab', trusted: true });
}
async function collectionNameFixture(page, width, variant, fixtureOrigin = test.info().project.use.baseURL) {
  const { PublicKey } = await import('@solana/web3.js');
  const mint = '26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg', signature = '3'.repeat(64);
  const metadataProgram = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
  const mintKey = new PublicKey(mint);
  const [metadataPda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), metadataProgram.toBuffer(), mintKey.toBuffer()], metadataProgram);
  const borshString = value => { const text = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(text.length); return Buffer.concat([length, text]); };
  // Public deterministic metadata transport. Actual readMetadataString/parseOnChainMetadata consumes this.
  const metadata = Buffer.concat([Buffer.from([4]), new PublicKey('11111111111111111111111111111111').toBuffer(), mintKey.toBuffer(),
    borshString('Fee label QA'), borshString('FEE'), borshString(''), Buffer.from([0, 0, 0, 0, 1, 0])]);
  const known = variant === 'known-metadata';
  const ledger = { mint, cluster: 'devnet', overview: { available: true, scope: 'per-mint-v3' },
    collections: [{ signature, collectedLamports: '2462530', recordedAt: '2026-10-17T00:00:00Z' }],
    claims: [{ claimSignature: signature, grossCreatorFees: '0.00246253', asset: 'SOL', status: 'allocated-not-funded', claimedAt: '2026-10-17T00:00:00Z' }] };
  const f = { variant, mint, signature, metadataAddress: metadataPda.toBase58(), metadataProgram: metadataProgram.toBase58(), metadataBase64: metadata.toString('base64'),
    known, api: [], rpc: [], network: [], forbidden: [], errors: [], failed: [], ledgerReads: 0 };
  page.on('pageerror', error => f.errors.push(error.message));
  page.on('requestfailed', request => f.failed.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText }));
  await page.setViewportSize({ width, height: width === 360 ? 740 : width === 390 ? 844 : 900 });
  const readMethods = new Set(['getAccountInfo', 'getMultipleAccounts', 'getTokenLargestAccounts', 'getSlot', 'getGenesisHash']);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    f.network.push({ origin: url.origin, path: url.pathname, method });
    if (url.origin !== new URL(fixtureOrigin).origin) {
      if (method === 'GET' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
      f.forbidden.push({ origin: url.origin, path: url.pathname, method }); return route.abort();
    }
    if (url.pathname === '/api/solana/rpc') {
      let body; try { body = request.postDataJSON(); } catch {}
      const calls = Array.isArray(body) ? body : [body];
      if (method !== 'POST' || !calls.length || !calls.every(c => c && readMethods.has(c.method))) {
        f.forbidden.push({ path: url.pathname, method, calls }); return route.fulfill({ status: 403, json: { error: 'Unapproved RPC method' } });
      }
      const replies = calls.map(call => {
        let result, branch = 'empty-read';
        if (call.method === 'getAccountInfo' && call.params?.[0] === mint && call.params?.[1]?.encoding === 'jsonParsed') {
          branch = known ? 'confirmed-parsed-mint' : 'unavailable-mint';
          result = { context: { slot: 100 }, value: known ? { data: { program: 'spl-token', parsed: { type: 'mint', info: {
            decimals: 6, supply: '1000000000000', isInitialized: true, mintAuthority: null, freezeAuthority: null } }, space: 82 },
            owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', executable: false, lamports: 1000000, rentEpoch: 0, space: 82 } : null };
        } else if (call.method === 'getAccountInfo' && call.params?.[0] === f.metadataAddress) {
          branch = known ? 'confirmed-metadata-name-symbol' : 'unavailable-metadata';
          result = { context: { slot: 100 }, value: known ? { data: [metadata.toString('base64'), 'base64'], owner: f.metadataProgram,
            executable: false, lamports: 1000000, rentEpoch: 0, space: metadata.length } : null };
        } else if (call.method === 'getAccountInfo') result = { context: { slot: 100 }, value: null };
        else if (call.method === 'getMultipleAccounts') result = { context: { slot: 100 }, value: (call.params?.[0] || []).map(() => null) };
        else if (call.method === 'getTokenLargestAccounts') result = { context: { slot: 100 }, value: [] };
        else if (call.method === 'getSlot') result = 100;
        else result = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
        f.rpc.push({ method: call.method, params: call.params, id: call.id, branch });
        return { jsonrpc: '2.0', id: call.id, result };
      });
      return route.fulfill({ json: Array.isArray(body) ? replies : replies[0] });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      f.forbidden.push({ path: url.pathname, method }); return route.fulfill({ status: 403, json: { error: 'No writes in region-name fixture' } });
    }
    if (url.pathname === `/devnet-metadata/${mint}`) {
      f.api.push({ path: url.pathname, method });
      return route.fulfill({ status: 503, json: { error: 'Optional metadata details unavailable fixture' } });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    f.api.push({ path: url.pathname, method });
    if (url.pathname === '/api/fee-policy') return route.fulfill({ json: { split: PROTOCOL_FEE_SPLIT } });
    if (method === 'GET' && url.pathname === '/api/rewards/automatic') return route.fulfill({ json: {
      status: 'unavailable', reason: 'Offline collection-name fixture', schedules: [], serverTime: '2026-10-22T00:00:00.000Z' } });
    if (url.pathname === `/api/tokens/${mint}/fee-activity`) { f.ledgerReads++; return route.fulfill({ json: ledger }); }
    if (url.pathname === `/api/tokens/${mint}/token-accounts`) return route.fulfill({ json: { mint, cluster: 'devnet', accounts: [], coverage: 'complete-account-list' } });
    return route.fulfill({ status: 503, json: { error: 'Offline collection-name fixture' } });
  });
  return f;
}
async function collectionData(region) {
  return region.evaluate(e => ({ label: e.getAttribute('aria-label'), role: e.getAttribute('role'), tabIndex: e.getAttribute('tabindex'),
    headers: [...e.querySelectorAll('thead th')].map(x => x.textContent), rows: [...e.querySelectorAll('tbody tr')].map(x => [...x.querySelectorAll('td')].map(c => c.textContent)),
    dates: [...e.querySelectorAll('time')].map(x => x.getAttribute('datetime')), links: [...e.querySelectorAll('a')].map(x => ({ href: x.href, rel: x.rel, target: x.target, label: x.getAttribute('aria-label') })),
    scope: e.previousElementSibling?.textContent }));
}
for (const width of [360, 390, 1440]) for (const variant of ['missing-mint', 'known-metadata'])
test(`Collection region real-loader ${variant} native name and focus ${width}`, async ({ page }, info) => {
  test.setTimeout(60000);
  const f = await collectionNameFixture(page, width, variant), label = f.known ? 'FEE fee collections' : 'Token fee collections';
  try {
    await page.goto(`/token/${f.mint}`); await page.locator('body.workspace-ready.product-experience-ready').waitFor();
    if (f.known) { await expect(page.locator('#coin-symbol')).toHaveText('FEE'); await expect(page.locator('#coin-metadata-status')).toHaveText('On-chain name / symbol'); }
    else await expect(page.locator('#coin-page-title')).toHaveText('Token data unavailable');
    const font = await page.evaluate(async () => {
      const request = '700 14px "Manrope"', text = 'Fee collections';
      const faces = await document.fonts.load(request, text); await document.fonts.ready;
      return { request, text, available: document.fonts.check(request, text),
        faces: faces.map(face => ({ family: face.family, status: face.status, weight: face.weight, style: face.style })) };
    });
    await info.attach('collection-loaded-font', { body: JSON.stringify(font), contentType: 'application/json' });
    expect(font.available).toBe(true); expect(font.faces.length).toBeGreaterThan(0);
    expect(font.faces.some(face => {
      const weights = face.weight === 'bold' ? [700] : face.weight.split(/\s+/).map(Number);
      const covers700 = weights.length === 1 ? weights[0] === 700 : weights.length === 2 && weights[0] <= 700 && weights[1] >= 700;
      return face.family.replaceAll('"', '').replaceAll("'", '') === 'Manrope' && face.status === 'loaded' && covers700 && face.style === 'normal';
    })).toBe(true);
    await page.getByRole('button', { name: 'Fee collections', exact: true }).click();
    const tab = page.locator('.coin-tabs [data-coin-tab="payments"]'); await expect(tab).toBeFocused(); await expect(tab).toHaveAttribute('aria-selected', 'true');
    const region = page.getByRole('region', { name: label, exact: true }); await expect(region).toHaveCount(1); await expect(region).toHaveAttribute('tabindex', '0');
    const original = await region.elementHandle(), before = await collectionData(region), reads = { api: f.api.length, rpc: f.rpc.length, ledger: f.ledgerReads };
    expect(before.headers).toEqual(['Date', 'Event', 'Amount', 'USD est.', 'Txn']); expect(before.rows).toHaveLength(1);
    expect(before.rows[0][1]).toBe('Creator fees collectedCollected for this token'); expect(before.rows[0][2]).toBe('0.00246253 SOL');
    expect(before.dates).toEqual(['2026-10-17T00:00:00.000Z']); expect(before.links).toHaveLength(1);
    expect(before.links[0].href).toContain(`/tx/${f.signature}`); expect(before.links[0].href).toContain('cluster=devnet');
    expect(before.links[0].label).toBe('View collection transaction on Solana Explorer');
    expect(before.scope).toBe('Fees collected for this token. Check Rewards for confirmed payments to recipients.');
    await armCollectionTab(original, label); await page.keyboard.press('Tab'); await checkCollectionTab(page);
    expect(await collectionData(region)).toEqual(before); expect({ api: f.api.length, rpc: f.rpc.length, ledger: f.ledgerReads }).toEqual(reads);
    expect(f.ledgerReads).toBe(1);
    expect(f.rpc.some(x => x.branch === (f.known ? 'confirmed-parsed-mint' : 'unavailable-mint') && x.params[1].commitment === 'confirmed')).toBe(true);
    if (f.known) expect(f.rpc.some(x => x.branch === 'confirmed-metadata-name-symbol' && x.params[1].commitment === 'confirmed')).toBe(true);
    expect(await region.evaluate(e => getComputedStyle(e).fontFamily)).toContain('Manrope');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.forbidden).toEqual([]); expect(f.errors).toEqual([]); expect(f.failed).toEqual([]);
    await info.attach('collection-region-data', { body: JSON.stringify(before), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath(`collection-name-${variant}-${width}.png`) });
  } finally { await info.attach('collection-real-loader-lineage', { body: JSON.stringify(f), contentType: 'application/json' }); }
});

test('Collection region controlled exact-renderer null blank and escaped symbols preserve other markup', async () => {
  const { renderCoinActivityTab } = await import('../../src/features/coin/activity-view.js');
  const { escapeHtml } = await import('../../src/features/shared/display.js');
  const render = (symbol, tab = 'payments') => {
    const activity = { innerHTML: '' };
    const document = { querySelector(selector) {
      if (selector === '#coin-activity-list') return activity;
      if (selector === '[data-coin-tab].active') return { dataset: { coinTab: tab } };
      return null;
    } };
    renderCoinActivityTab({ coinActivity: { status: 'ready', ledgerAvailable: true, symbol,
      collections: [{ signature: '3'.repeat(64), collectedLamports: '2462530', recordedAt: '2026-10-17T00:00:00Z' }],
      claims: [{ claimSignature: '3'.repeat(64), asset: 'SOL', grossCreatorFees: '0.00246253', claimedAt: '2026-10-17T00:00:00Z', status: 'allocated-not-funded' }],
      sharedRouterCollections: [{ signature: '4'.repeat(64), collectedLamports: '1000000000', recordedAt: '2026-10-17T00:00:00Z' }] } },
      { document, formatOnchainAge: () => 'fixture date', formatCoinUsd: () => '$—', exploreExplorer: path => `https://explorer.solana.com/${path}?cluster=devnet` });
    return activity.innerHTML;
  };
  const symbols = [undefined, null, '', '   ', '\t\n', 'FEE', '  FEE  ', 'Q<&"\''];
  const records = [];
  const stripCollectionName = html => html.replace(/aria-label="[^"]*"/, 'aria-label="COLLECTION-NAME"');
  const baseline = stripCollectionName(render('FEE'));
  for (const symbol of symbols) {
    const html = render(symbol), expected = typeof symbol === 'string' && symbol.trim() ? `${symbol} fee collections` : 'Token fee collections';
    expect(html).toContain(`aria-label="${escapeHtml(expected)}" tabindex="0"`);
    expect(stripCollectionName(html)).toBe(baseline);
    expect(html).toContain('aria-label="Combined fee collections"');
    const claims = render(symbol, 'claims'); expect(claims).toContain(`aria-label="${escapeHtml(symbol)} fee allocations"`);
    records.push({ symbol: symbol === undefined ? '(undefined)' : symbol, expected, html, claims });
  }
  await test.info().attach('controlled-renderer-symbol-edge-cases', { body: JSON.stringify({ qualification: 'Pure actual-renderer controls; null/blank/markup variants are not claimed actual-loader paths. No application state or DOM patching.', records }), contentType: 'application/json' });
});
