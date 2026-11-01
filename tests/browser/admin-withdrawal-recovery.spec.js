import {test,expect} from '@playwright/test';
import {Keypair,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {adminFixture,ADMIN} from './admin-review-fixture.js';
const storage='funded.admin.pending-withdrawal.devnet.v1';
async function setup(page){
 const blockhash=Keypair.generate().publicKey.toBase58(),state={prepares:0,sends:0,signature:null,expired:false,reconciles:0,recordedSignature:null};
 const fixture=await adminFixture(page,async({route,path,method,send})=>{
  if(path==='/api/admin/withdrawals/prepare'){
   state.prepares++;const input=route.request().postDataJSON();await send(200,{id:'qa-plan',...input,blockhash,lastValidBlockHeight:500,expiresAt:new Date(Date.now()+120000).toISOString()});return true;
  }
  if(path==='/api/admin/withdrawals/reconcile'){
   state.reconciles++;state.recordedSignature=route.request().postDataJSON().signature;
   await send(200,{amountLamports:'1000000',signature:state.recordedSignature,finalized:true,balanceDeltaVerified:true});return true;
  }
  if(path==='/api/solana/rpc'){
   const input=route.request().postDataJSON();let result;
   if(input.method==='getGenesisHash')result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
   else if(input.method==='isBlockhashValid')result={context:{slot:100},value:true};
   else if(input.method==='sendTransaction'){
    state.sends++;const transaction=Transaction.from(Buffer.from(input.params[0],'base64'));state.signature=bs58.encode(transaction.signature);
    // Deliberately lose the acknowledgement. No real provider is connected.
    await route.abort('failed');return true;
   }
   else if(input.method==='getSignatureStatuses')result={context:{slot:1000},value:[state.expired?null:{slot:100,confirmations:null,confirmationStatus:'finalized',err:null}]};
   else if(input.method==='getBlockHeight')result=534;
   else if(input.method==='getTransaction')result=null;
   else throw Error('Unexpected QA RPC '+input.method);
   await send(200,{jsonrpc:'2.0',id:input.id,result});return true;
  }return false;
 },{wallet:false});
 await page.goto('/admin.html');await expect(page.locator('#workspace')).toBeVisible();
 fixture.source=await page.evaluate(async()=>{const module=await import('/tests/browser/admin-ephemeral-wallet.js');return module.installEphemeralAdminWallet();});
 await page.locator('#connect').click();await page.locator('#refresh').click();await expect(page.locator('#withdraw-source')).toHaveValue(fixture.source);
 await page.locator('#withdraw-amount').fill('0.001');return state;
}
async function submitTwice(page){page.once('dialog',dialog=>dialog.accept());await page.locator('#withdraw-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});}
test('lost RPC acknowledgement retains the known signature and prevents duplicate signing (mocked RPC)',async({page})=>{
 const state=await setup(page);await submitTwice(page);await expect.poll(()=>state.sends).toBe(1);
 await expect(page.locator('#reconcile-signature')).toHaveValue(state.signature);await expect(page.locator('#withdraw-form [type=submit]')).toBeDisabled();
 expect(state.prepares).toBe(1);expect(await page.evaluate(()=>window.qaWalletSigns)).toBe(1);
 const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),storage);expect(saved.signature).toBe(state.signature);
 expect(Object.keys(saved).sort()).toEqual(['amountLamports','destination','lastValidBlockHeight','signature','source'].sort());
 await page.getByRole('button',{name:'Check pending transfer'}).click();await expect(page.locator('#message')).toContainText('Finalized 0.001 SOL transfer recorded');
 expect(state.recordedSignature).toBe(state.signature);expect(state.sends).toBe(1);expect(await page.evaluate(key=>sessionStorage.getItem(key),storage)).toBeNull();
});
test('public pending signature survives reload and reconciles without another wallet signature (mocked RPC)',async({page})=>{
 const state=await setup(page);await submitTwice(page);await expect.poll(()=>state.sends).toBe(1);await page.reload();
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#reconcile-signature')).toHaveValue(state.signature);await expect(page.locator('#withdraw-form [type=submit]')).toBeDisabled();
 await page.getByRole('button',{name:'Check pending transfer'}).click();await expect.poll(()=>state.reconciles).toBe(1);expect(state.sends).toBe(1);
});
test('expired unlanded transfer is released only after finalized absence proof (mocked RPC)',async({page})=>{
 const state=await setup(page);await submitTwice(page);await expect.poll(()=>state.sends).toBe(1);state.expired=true;
 await page.getByRole('button',{name:'Check pending transfer'}).click();await expect(page.locator('#withdraw-review')).toContainText('expired without landing');
 await expect(page.locator('#withdraw-form [type=submit]')).toBeEnabled();expect(state.sends).toBe(1);expect(state.reconciles).toBe(0);
});
test('wallet cannot alter the reviewed transfer before broadcast (mocked RPC)',async({page})=>{
 const state=await setup(page);await page.evaluate(()=>{window.qaMutateTransfer=true;});await submitTwice(page);
 await expect(page.locator('#message')).toContainText('reviewed transfer changed');expect(state.sends).toBe(0);
 expect(await page.evaluate(key=>sessionStorage.getItem(key),storage)).toBeNull();
});
