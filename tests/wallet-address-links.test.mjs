import test from 'node:test';
import assert from 'node:assert/strict';
import {linkWalletText, walletDetailHref, walletAddressMarkup} from '../src/features/shared/wallet-links.js';

const wallet = 'EPdpzM11111111111111111111111111VzaFyd';
const document = {createElement: tag => new Element(tag)};
class Element {
  constructor(tag = 'strong') { this.tagName=tag.toUpperCase();this.ownerDocument=document;this.parts=[];this.attributes={}; }
  set textContent(value) { this.parts=[value]; }
  get textContent() { return this.parts.map(part=>typeof part==='string'?part:part.textContent).join(''); }
  replaceChildren(...parts) { this.parts=parts; }
  setAttribute(key,value) { this.attributes[key]=value; }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelector() { return this.parts.find(part=>part?.tagName==='A'); }
  closest() { return this.interactiveParent; }
}

test('full and shortened wallet labels open the complete wallet address',()=>{
  for(const label of [wallet,'EPdpzM…VzaFyd','EPdpzM...VzaFyd']) {
    const node=new Element();node.textContent=`Fee owner ${label} · verified`;
    linkWalletText(node,wallet);
    assert.equal(node.querySelector().href,`/wallet/${wallet}`);
    assert.equal(node.querySelector().textContent,label);
    assert.equal(node.textContent,`Fee owner ${label} · verified`);
    linkWalletText(node,wallet);assert.equal(node.parts.length,3);
  }
});

test('placeholders, unrelated shortened addresses and interactive controls are preserved',()=>{
  for(const label of ['Unavailable','Another…Wallet']) {
    const node=new Element();node.textContent=label;linkWalletText(node,wallet);assert.equal(node.querySelector(),undefined);
  }
  const node=new Element();node.textContent=wallet;node.interactiveParent={tagName:'BUTTON'};
  linkWalletText(node,wallet);assert.equal(node.querySelector(),undefined);
  assert.equal(walletDetailHref('javascript:alert(1)'),null);
  assert.equal(walletDetailHref(null),null);
});

test('existing address links navigate internally and markup escapes labels',()=>{
  const node=new Element('a');node.textContent=wallet;node.setAttribute('target','_blank');node.setAttribute('rel','noopener');
  linkWalletText(node,wallet);assert.equal(node.attributes.href,`/wallet/${wallet}`);assert.equal(node.attributes.target,undefined);
  const markup=walletAddressMarkup(wallet,'<img src=x onerror=alert(1)>');
  assert.ok(!markup.includes('<img'));assert.match(markup,/&lt;img/);assert.match(markup,/href="\/wallet\//);
  assert.equal(walletAddressMarkup('bad','<script>'),'&lt;script&gt;');
});
