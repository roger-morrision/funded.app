export function plainPublicText(value){
  return value.replace(/\b(?:per-mint\s+)?V3\s+(?:fee\s+)?router\b/gi,'fee system')
    .replace(/\bV3\s+/gi,'').replace(/\bV3\b/gi,'')
    .replace(/\bAwaiting\s+payout\b/g,'Awaiting payout');
}
export function initializePlainCopy(document=globalThis.document){
  if(!document?.body||document.body.dataset.plainCopyReady)return;
  document.body.dataset.plainCopyReady='true';
  const untouched='script,style,code,pre,textarea,input,[contenteditable],[data-user-content],.callout-text,.coin-chat-messages,.compact-token-link,.directory-token-identity,.home-new-token-heading';
  const clean=root=>{
    if(root.nodeType===3){
      if(root.parentElement?.closest(untouched))return;
      const next=plainPublicText(root.data);if(next!==root.data)root.data=next;return;
    }
    if(root.nodeType!==1||root.closest(untouched))return;
    const walk=document.createTreeWalker(root,4);let node;while((node=walk.nextNode()))clean(node);
    // Preserve existing paragraph nodes and controls. Only long, static prose
    // becomes an outline; live status fields and transaction reviews are untouched.
    for(const p of root.querySelectorAll('p')){
      if(p.id||p.children.length||p.getAttribute('role')||p.attributes.length&&[...p.attributes].some(a=>a.name.startsWith('data-'))
        ||p.closest(untouched)||p.closest('form,dialog,[aria-live],.legal-content,pre,code')||p.classList.contains('guidance-points'))continue;
      const content=p.textContent.trim();if(content.length<180)continue;
      const points=content.split(/(?<=[.!?])\s+(?=[A-Z$])/);if(points.length<2)continue;
      p.classList.add('guidance-points');p.style.whiteSpace='pre-line';
      p.textContent=points.map(point=>`• ${point}`).join('\n');
    }
  };
  clean(document.body);
  new MutationObserver(records=>{for(const record of records){if(record.type==='characterData')clean(record.target);else for(const node of record.addedNodes)clean(node);}})
    .observe(document.body,{childList:true,subtree:true,characterData:true});
}
