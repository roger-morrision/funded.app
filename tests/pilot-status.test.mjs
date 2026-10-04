import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual browser renderer with minimal DOM controls. Importing the
// full browser entry in Node would also install document/window event handlers.
const moduleSource=readFileSync(new URL('../pilot-metrics.js',import.meta.url),'utf8');
const start=moduleSource.indexOf('function render(message){');
const end=moduleSource.indexOf('\nasync function withRecorder',start);
assert.ok(start>=0 && end>start,'Pilot status renderer must be available.');
function renderStatus({pilotEnabled=false,error=null,message,record=null,pending=0,controlPending=0,initialized=true,legacyCleanupFailed=false}={}){
  const controls={consent:{},exportButton:{},clearButton:{},role:{},source:{},status:{},section:{setAttribute(name,value){this[name]=value;}}};
  const names=['committedRecord','consent','exportButton','clearButton','role','source','status','section','pilotEnabled','pending','controlPending','initialized','storageFailed','deletionPending','legacyCleanupFailed'];
  const render=Function(...names,`let notice='';${moduleSource.slice(start,end)};return render;`)(record,controls.consent,controls.exportButton,controls.clearButton,controls.role,controls.source,controls.status,controls.section,pilotEnabled,pending,controlPending,initialized,Boolean(error),0,legacyCleanupFailed);
  render(message ?? error ?? undefined);return controls;
}
test('disabled-network pilot status preserves failed deletion and storage-read warnings alongside its network notice',()=>{
  for(const warning of ['Recording stopped in this tab, but saved data could not be cleared.','Device storage is unavailable. Recording and export stopped.']){
    const {status,consent,exportButton}=renderStatus({message:warning});
    assert.ok(status.textContent.includes(warning));assert.match(status.textContent,/only on Devnet/);
    assert.equal(consent.disabled,true);assert.equal(exportButton.disabled,true);
  }
  assert.match(renderStatus({error:'Device storage is unavailable.'}).status.textContent,/Device storage is unavailable\..*only on Devnet/);
});
test('disabled-network pilot keeps deletion confirmation and the normal Devnet status stays unchanged',()=>{
  assert.match(renderStatus({message:'Local pilot record deleted. Recording is off.'}).status.textContent,/Local pilot record deleted\..*only on Devnet/);
  assert.equal(renderStatus({pilotEnabled:true,message:'Local pilot record deleted.'}).status.textContent,'Local pilot record deleted.');
  assert.match(renderStatus().status.textContent,/^Local pilot recording is available only on Devnet\./);
});

test('pending enrollment keeps consent unchecked and exposes a busy committed snapshot',()=>{
  const controls=renderStatus({pilotEnabled:true,pending:1,controlPending:1,message:'Saving your local pilot choice…'});
  assert.equal(controls.consent.checked,false);assert.equal(controls.consent.disabled,true);
  assert.equal(controls.section['aria-busy'],'true');assert.equal(controls.exportButton.disabled,true);
  assert.equal(controls.clearButton.disabled,false,'Revocation remains available during a queued enrollment');
});
test('only committed records enable export, with persistent legacy-cleanup warnings',()=>{
  const record={role:'creator',source:'organic',cluster:'devnet',events:[]};
  const controls=renderStatus({pilotEnabled:true,record,legacyCleanupFailed:true});
  assert.equal(controls.consent.checked,true);assert.equal(controls.exportButton.disabled,false);
  assert.match(controls.status.textContent,/Older browser data could not be cleared/);
  assert.equal(renderStatus({pilotEnabled:true,record,pending:1}).exportButton.disabled,true);
  assert.equal(renderStatus({pilotEnabled:true,initialized:false}).consent.disabled,true);
});
