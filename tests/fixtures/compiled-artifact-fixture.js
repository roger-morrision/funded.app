// Test-only compiled profile. Default DEV fixtures and every other API remain unchanged.
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
import {readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const compiled=process.env.FQA_COMPILED_ARTIFACT_FIXTURES==='1';
export function requiredFeePolicyForCompiled(route){
  if(!compiled)return null;
  const request=route.request();
  if(request.method()!=='GET'||new URL(request.url()).pathname!=='/api/fee-policy')return null;
  return route.fulfill({status:200,json:{split:PROTOCOL_FEE_SPLIT}});
}
const aliases={'bootstrap-gate.js':'bootstrap','bootstrap.js':'bootstrap','app.js':'app','creator-support-ui.js':'creator-support-ui'};
export function browserModulePath(source){
  if(!compiled)return '/'+source;
  assert.equal(process.env.FQA_BUILD_ROOT,'/validation/built');
  const stem=aliases[source];assert(stem,'Only declared bootstrap fault boundaries may be mapped');
  assert(/^[a-z-]+$/.test(stem));
  const matches=readdirSync('/validation/built/assets').filter(name=>new RegExp('^'+stem+'-[A-Za-z0-9_-]{8}\\.js$').test(name));
  assert.equal(matches.length,1,'One actual immutable compiled asset per boundary');
  return '/assets/'+matches[0];
}
export const browserModuleRoute=source=>'**'+browserModulePath(source)+'*';
export function expectedBootstrapImportFailure(message){
  if(!compiled)return /Failed to fetch dynamically imported module: .*\/bootstrap\.js/.test(message);
  const match=message.match(/Failed to fetch dynamically imported module: (\S+)/);
  if(!match)return false;
  try{return new URL(match[1]).pathname===browserModulePath('bootstrap.js');}catch{return false;}
}
