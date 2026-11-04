const bound=new WeakSet();
export function revealCalculatorFeedback(document=globalThis.document,view=globalThis.window){
 const input=document?.querySelector('#fee-flow-input'),feedback=document?.querySelector('#fee-flow-feedback');
 if(!view||!input||!feedback||document.activeElement!==input||!input.getClientRects().length)return;
 const header=document.querySelector('.topbar'),dock=document.querySelector('.mobile-workspace-nav');
 const top=Math.max(0,header?.getBoundingClientRect().bottom||0)+8;
 const bottom=(dock?.getClientRects().length?dock.getBoundingClientRect().top:view.innerHeight)-8;
 const field=input.getBoundingClientRect(),note=feedback.getBoundingClientRect();
 const delta=note.bottom>bottom?Math.min(note.bottom-bottom,field.top-top):field.top<top?field.top-top:0;
 if(delta)view.scrollBy({top:delta,behavior:'instant'});
}
export function bindCalculatorVisibility(document=globalThis.document){
 const input=document?.querySelector('#fee-flow-input');if(!input?.addEventListener||bound.has(input))return;
 bound.add(input);input.addEventListener('focus',()=>revealCalculatorFeedback(document));
}
