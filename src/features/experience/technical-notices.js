// Missing read-only values stay quiet; transaction errors remain actionable.
const WARNING = /\b(unavailable|could not|couldn't|failed|failure|not verified|unverified|verification (?:pending|unavailable|incomplete)|incomplete|stale|rate.?limit(?:ed)?|RPC|provider|retry shortly|try again shortly|partial coverage|awaiting (?:receipt|verified|verification)|current verification pending|no amount is confirmed|busy)\b/i;
const NETWORK = /\b(RPC|rate.?limit(?:ed)?|provider|retry|busy|network|connection)\b/i;
// Missing values may be quiet; financial status and recovery guidance must remain visible.
const ACTION_STATUS = /\b(transactions?|payouts?|payments?|claims?|reconciliation|saved|saving|awaiting verified community funding|call was)\b/i;
export function isQuietDataGap(text) {
  const kind=classifyTechnicalText(text,{valueCell:true});
  return Boolean(kind && kind!=='error' && !ACTION_STATUS.test(String(text)));
}
const ERROR = /\b(failed|rejected|error|insufficient|declined)\b/i;
const VALUE_CELLS = 'strong, b, dd';
const CANDIDATES = `p, small, em, span, li, div, [role="status"], ${VALUE_CELLS}`;
const SKIP = 'h1, h2, h3, h4, button, a, label, input, select, textarea, summary, option, dialog, kbd, code, [contenteditable], [id$="-error"], .field-error, .empty-state, [role="alert"], #wizard-hint, #wallet-stat-sol-note, #docs, #privacy, #terms, #disclosures, #opt-out, .technical-notice, #preview-launch-cost, [data-launch-protection]';
// People's own words (callouts, coin chat) are never reworded; rewording made
// the callout feed flip between versions on every refresh.
const INLINE = 'i, b, strong, em, span, abbr, time, wbr, br';
// A status line is a leaf, or a short text element whose children are only
// inline formatting (no links, buttons or nested blocks).
const plainLine = element => !element.childElementCount
  || (!element.matches('div, [role="status"]') && [...element.children].every(child => child.matches(INLINE) && !child.childElementCount));

// Display-only wording: records, APIs and receipts keep their exact terms.
const PLAIN_WORDS = [
  [/\bV3 router\b/g, 'fee router'], [/\bV3 (?=settlement|fee|router|claim)/g, ''],
  [/\bfinalized\b/g, 'confirmed'], [/\bFinalized\b/g, 'Confirmed'],
  [/\bkeeper\b/g, 'automation'], [/\bKeeper\b/g, 'Automation'],
  [/\bindexed\b/g, 'recorded'], [/\bIndexed\b/g, 'Recorded'],
  [/\bworker(?=[ -]recorded| snapshots?\b)/g, 'automation'],
  [/\bSolana RPC\b/g, 'Solana network'], [/\bRPC\b/g, 'network'],
  // The network is shown once, in the top label; page copy does not repeat it.
  [/\s*·\s*Devnet QA\b/g, ''], [/\bDevnet QA\b/g, 'QA'], [/\s+(?:on|for) (?:Solana )?Devnet\b/g, ''],
  [/\bSolana Devnet\b/g, 'Solana'], [/\s*\(Devnet\)/g, ''], [/\bDevnet\s+(?=[a-z])/g, ''], [/\bDevnet\s+(?=[A-Z])/g, ''],
];

export function plainWording(text) {
  return PLAIN_WORDS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text));
}

export function classifyTechnicalText(text, { valueCell = false } = {}) {
  const value = String(text || '').trim();
  if (value.length < (valueCell ? 8 : 14) || value.length > 240 || !WARNING.test(value)) return null;
  if (ERROR.test(value)) return 'error';
  return NETWORK.test(value) ? 'network' : 'verification';
}

// Missing read-only data uses a dash. Transaction reviews and actionable errors
// retain their original wording; no technical notification or device preference.
export function mountTechnicalNotices({document=globalThis.document,root=document?.querySelector('#main-content')}={}){
  if(!document||!root)return null;
  const view=document.defaultView;
  const excluded=SKIP+', #recovery-inbox, #community .section-state, #wallet-detail-content .wallet-detail-empty, [data-wallet-bonus-coverage], [data-agency-history], [data-agency-status], #wallet-detail-content .wallet-section-state, [data-flow-status], [data-flow-rows], [data-flow-empty], [data-flow-count], [data-flow-scope], [data-coin-trade-results], #coin-chat-post-result, #callouts-status, #creator-directory-status, [data-bonus-status], [data-bonus-history-status], #payment-history-footnote, [data-auto-status], #coin-description, .creator-reward-name, .creator-claim-heading a, .coin-chart-status, #coin-activity-list, [data-watchlist-status], #portfolio-holdings-status, #portfolio-trade-rows, #funded-buy-status, #funded-burn-status, form, [data-user-content], .callout-text, .coin-chat-messages, .guidance-outline, .guidance-points, .help-topics-answer';
  const clean=element=>{
    if(!element?.matches?.(CANDIDATES)||!plainLine(element)||element.closest(excluded))return;
    if(isQuietDataGap(element.textContent)&&element.textContent!=='-')element.textContent='-';
  };
  const scan=()=>{for(const element of root.querySelectorAll(CANDIDATES))clean(element);};
  const observer=new view.MutationObserver(records=>{
    for(const {target,addedNodes}of records){clean(target.nodeType===1?target:target.parentElement);
      for(const node of addedNodes)if(node.nodeType===1){clean(node);for(const child of node.querySelectorAll(CANDIDATES))clean(child);}}
  });
  observer.observe(root,{subtree:true,childList:true,characterData:true});scan();
  return {scan,disconnect:()=>observer.disconnect()};
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mountTechnicalNotices(),{once:true});
  else mountTechnicalNotices();
}
