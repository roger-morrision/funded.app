import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual browser renderer with minimal DOM controls. Importing the
// full browser entry in Node would also install document/window event handlers.
const moduleSource=readFileSync(new URL('../pilot-metrics.js',import.meta.url),'utf8');
const start=moduleSource.indexOf('function render(message){');
const end=moduleSource.indexOf('\nfunction recordEvent',start);
assert.ok(start>=0 && end>start,'Pilot status renderer must be available.');
function renderStatus({pilotEnabled=false,error=null,message}={}){
  const controls={consent:{},exportButton:{},role:{},source:{},status:{}};
  const recorder={current(){if(error)throw new Error(error);return null;}};
  const render=Function('recorder','consent','exportButton','role','source','status','pilotEnabled','serialized',`${moduleSource.slice(start,end)};return render;`)(recorder,controls.consent,controls.exportButton,controls.role,controls.source,controls.status,pilotEnabled,true);
  render(message);return controls;
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
