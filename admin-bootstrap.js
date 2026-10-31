import { Buffer } from 'buffer';
import { icon } from './ui-icons.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
document.querySelectorAll('.admin-navigation [data-icon]').forEach(node=>{node.innerHTML=icon(node.dataset.icon);});

await import('./admin-page.js');
