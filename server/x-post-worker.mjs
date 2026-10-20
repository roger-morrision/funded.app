// X has no reliable idempotency key for create-post. Durable claims prevent
// normal duplicate dispatch; unknown delivery always requires reconciliation.
export async function runXPostWorker({ store, publish, enabled = false, dryRun = true, maxPosts = 1, timeoutMs = 15_000,kinds } = {}) {
  if (!Number.isSafeInteger(maxPosts) || maxPosts < 1 || maxPosts > 20) throw new Error('X dispatch batch must contain 1 to 20 posts.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('X publication timeout is invalid.');
  if(kinds!==undefined&&(!Array.isArray(kinds)||!kinds.length||kinds.length>16||kinds.some(kind=>typeof kind!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(kind))))throw new Error('X worker kinds are invalid.');
  const summary = { mode:!enabled ? 'disabled' : dryRun ? 'dry-run' : 'dispatch', claimed:0, posted:0, uncertain:0, retried:0, failed:0, events:[] };
  if (!enabled) return summary;
  if (dryRun) { summary.events = (await store.list({status:'pending',limit:kinds?200:maxPosts})).map(row => row.event).filter(event=>!kinds||kinds.includes(event.kind)).slice(0,maxPosts); return summary; }
  if (typeof publish !== 'function') throw new Error('An X publisher is required.');
  if (!Number.isSafeInteger(store.leaseMs) || store.leaseMs < timeoutMs + 1000) throw new Error('X dispatch lease must exceed the publication timeout by at least one second.');
  for (let count = 0; count < maxPosts; count++) {
    const claim = await store.claim(kinds?{kinds}:undefined);
    if (!claim) break;
    summary.claimed++;
    const controller = new AbortController();
    let timer;
    let result;
    let publicationError;
    try {
      result = await Promise.race([
        Promise.resolve().then(() => publish(claim.event, {signal:controller.signal})),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error('X publication timed out.'), {delivery:'unknown'}));
        }, timeoutMs); }),
      ]);
    } catch (error) { publicationError = error; }
    finally { clearTimeout(timer); }
    if (!publicationError) {
      try {
        await store.markPosted(claim.event.id, claim.token, result);
        summary.posted++;
        summary.events.push({id:claim.event.id,status:'posted'});
      } catch {
        // A successful response with a lost persistence write is also ambiguous.
        // Never call publish again to repair it. On DB failure the durable
        // sending record itself becomes uncertain after its lease expires.
        await store.markUncertain(claim.event.id, claim.token, 'publication-persistence-unknown');
        summary.uncertain++;
        summary.events.push({id:claim.event.id,status:'uncertain'});
      }
      if(summary.uncertain)break;
      continue;
    }
    const status=publicationError.status??publicationError.statusCode;
    if(['not-sent','rejected'].includes(publicationError.delivery)&&[401,402,403].includes(status)){
      await store.deferAccount(claim.event.id,claim.token,status);
      summary.retried++;summary.events.push({id:claim.event.id,status:'pending'});
    } else if (publicationError.delivery === 'not-sent' && Number(status) === 429) {
      const requested = Number(publicationError.retryAfterMs);
      const delay = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested,86_400_000) : 60_000;
      const updated = await store.retryLater(claim.event.id, claim.token, delay);
      if (updated?.status === 'failed') { summary.failed++; summary.events.push({id:claim.event.id,status:'failed'}); }
      else { summary.retried++; summary.events.push({id:claim.event.id,status:'pending'}); }
    } else if (['not-sent','rejected'].includes(publicationError.delivery)) {
      await store.fail(claim.event.id, claim.token, 'delivery-rejected');
      summary.failed++;
      summary.events.push({id:claim.event.id,status:'failed'});
    } else {
      await store.markUncertain(claim.event.id, claim.token, 'delivery-unknown');
      summary.uncertain++;
      summary.events.push({id:claim.event.id,status:'uncertain'});
    }
    // Do not consume another queued item after a provider or persistence error.
    break;
  }
  return summary;
}
