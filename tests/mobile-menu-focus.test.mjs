import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationController} from '../src/app/controllers/navigation.js';

test('mobile menu isolates background, wraps keyboard focus and restores prior inert state',()=>{
  const previous={document:globalThis.document,window:globalThis.window};let mobile=true;
  const doc={activeElement:null};
  function node(){const names=new Set();return{inert:false,tabIndex:0,disabled:false,attributes:{},
    classList:{toggle:(k,on)=>on?names.add(k):names.delete(k),contains:k=>names.has(k)},
    focus(){doc.activeElement=this;},getClientRects:()=>[{}],closest:()=>null,
    setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};}
  const sidebar=node(),open=node(),close=node(),main=node(),skip=node(),bottom=node(),backdrop=node(),brand=node(),profile=node();
  const controls=[brand,close,profile];sidebar.querySelectorAll=()=>controls;sidebar.contains=x=>controls.includes(x);
  const nodes={'#sidebar':sidebar,'#open-menu':open,'#close-menu':close,'#main-content':main,'#menu-backdrop':backdrop};
  doc.querySelector=s=>nodes[s];doc.querySelectorAll=()=>[main,skip,bottom];doc.body=node();
  globalThis.document=doc;globalThis.window={matchMedia:()=>({matches:mobile})};
  const press=(key,shiftKey=false)=>{let prevented=false;controller.handleMenuKeydown({key,shiftKey,preventDefault(){prevented=true;}});return prevented;};
  const controller=createNavigationController({});
  try{
    skip.inert=true;open.focus();controller.setMenuOpen(true);
    assert.equal(doc.activeElement,close);assert(main.inert&&skip.inert&&bottom.inert);
    backdrop.focus();assert(press('Tab'));assert.equal(doc.activeElement,brand);
    assert(press('Tab',true));assert.equal(doc.activeElement,backdrop);
    open.focus();assert(press('Tab'));assert.equal(doc.activeElement,brand);
    assert(press('Escape'));assert.equal(doc.activeElement,open);assert.equal(main.inert,false);assert.equal(bottom.inert,false);assert.equal(skip.inert,true);
    controller.setMenuOpen(true);controller.setMenuOpen(true);mobile=false;controller.setMenuOpen(false);
    assert.equal(main.inert,false);assert.equal(sidebar.inert,false);assert.equal(skip.inert,true);
    assert.equal(press('Tab'),false);
  }finally{globalThis.document=previous.document;globalThis.window=previous.window;}
});
