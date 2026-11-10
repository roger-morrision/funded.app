export function plainPublicText(value){
  return value.replace(/\b(?:per-mint\s+)?V3\s+(?:fee\s+)?router\b/gi,'fee system')
    .replace(/\bV3\s+/gi,'').replace(/\bV3\b/gi,'')
    .replace(/\bAwaiting\s+payout\b/g,'Awaiting payout');
}
const OUTLINE_TARGETS = 'p, .source-note > span, small';
const OUTLINE_MIN = 180;
// Split prose into sentence points and render them as hanging-indent bullets.
export function outlinePoints(content) {
  return content.trim().split(/(?<=[.!?])\s+(?=[A-Z$0-9•])/).map(point => point.replace(/^•\s*/, '').trim()).filter(Boolean);
}
function outline(p, untouched, document) {
  if (p.dataset.outlined || p.children.length || p.closest(untouched)) return;
  if (p.closest('form,dialog,[aria-live],[role="status"],[role="alert"],.legal-content,pre,code,table,button,a,label,summary')) return;
  if (p.getAttribute('role') || p.hasAttribute('aria-live')) return;
  const content = p.textContent.trim(); if (content.length < OUTLINE_MIN) return;
  const points = outlinePoints(content); if (points.length < 2) return;
  p.dataset.outlined = 'true'; p.classList.add('guidance-points'); p.style.removeProperty('white-space');
  p.replaceChildren(...points.map(point => { const item = document.createElement('span'); item.className = 'guidance-point'; item.textContent = point; return item; }));
}
export function initializePlainCopy(document=globalThis.document){
  if(!document?.body||document.body.dataset.plainCopyReady)return;
  document.body.dataset.plainCopyReady='true';
  const untouched='script,style,code,pre,textarea,input,[contenteditable],[data-user-content],.callout-text,.coin-chat-messages,.compact-token-link,.directory-token-identity,.home-new-token-heading, .creator-reward-name, .creator-claim-heading a';
  const clean=root=>{
    if(root.nodeType===3){
      if(root.parentElement?.closest(untouched))return;
      const next=plainPublicText(root.data);if(next!==root.data)root.data=next;return;
    }
    if(root.nodeType!==1||root.closest(untouched))return;
    const walk=document.createTreeWalker(root,4);let node;while((node=walk.nextNode()))clean(node);
    // Long static prose becomes a bullet outline. Live regions, forms, dialogs and
    // transaction reviews stay untouched; nodes that already hold markup are skipped.
    const candidates = root.matches?.(OUTLINE_TARGETS) ? [root] : [];
    for (const p of [...candidates, ...root.querySelectorAll(OUTLINE_TARGETS)]) outline(p, untouched, document);
  };
  clean(document.body);
  new MutationObserver(records=>{for(const record of records){
      if(record.type==='characterData')clean(record.target);
      else{
        const target=record.target;
        if(target.nodeType===1&&target.dataset?.outlined&&!target.querySelector('.guidance-point'))delete target.dataset.outlined;
        if(target.nodeType===1&&target.matches?.(OUTLINE_TARGETS))clean(target);
        for(const node of record.addedNodes)clean(node);
      }
    }})
    .observe(document.body,{childList:true,subtree:true,characterData:true});
}
