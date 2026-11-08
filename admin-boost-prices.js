import {BOOST_PACKAGES} from './boost-offer.js';
import {boostUsdCents,validateBoostPrices} from './boost-pricing.js';
export function initAdminBoostPrices({api,post,show,document=globalThis.document}){
  const workspace=document.querySelector('#workspace'),panel=document.createElement('section');panel.className='panel';
  panel.innerHTML=`<h2>Boost prices</h2><p>Prices are in USD, paid in SOL. New quotes use the saved prices; existing quotes keep their original price until expiry.</p><p data-boost-revision></p><form><div class="fee-fields">${BOOST_PACKAGES.map(pack=>`<label>${pack.id} · ${pack.hours} hours (USD)<input name="${pack.id}" type="number" min="0.01" max="100000" step="0.01" required></label>`).join('')}</div><label>Audit reason<input name="reason" minlength="10" maxlength="500" required></label><div class="actions"><button type="button" data-refresh>Refresh prices</button><button type="submit" disabled>Review and save boost prices</button></div></form>`;
  workspace.prepend(panel);const form=panel.querySelector('form'),status=panel.querySelector('[data-boost-revision]');let snapshot,busy=false,epoch=0;
  function controls(){for(const node of form.querySelectorAll('input,button'))node.disabled=busy||workspace.hidden;form.querySelector('[type=submit]').disabled||=!snapshot;}
  async function load(){if(busy||workspace.hidden)return;const token=++epoch;snapshot=null;controls();
    try{const data=await api('/api/admin/boost-prices');if(token!==epoch||workspace.hidden)return;
      validateBoostPrices(data.prices);snapshot=data;for(const pack of BOOST_PACKAGES)form.elements.namedItem(pack.id).value=(data.prices[pack.id]/100).toFixed(2);
      status.textContent=`Revision ${data.revision} · new quotes only`;
    }catch(error){if(token===epoch&&!workspace.hidden)show(error.message,true);}finally{if(token===epoch)controls();}}
  panel.querySelector('[data-refresh]').onclick=()=>void load();
  form.onsubmit=async event=>{event.preventDefault();if(busy||!snapshot||workspace.hidden||!form.reportValidity())return;
    const token=epoch;
    try{const prices=validateBoostPrices(Object.fromEntries(BOOST_PACKAGES.map(pack=>[pack.id,boostUsdCents(form.elements.namedItem(pack.id).value)])));
      const input={prices,expectedRevision:snapshot.revision,expectedHash:snapshot.hash,reason:form.elements.reason.value};busy=true;controls();
      await post('/api/admin/boost-prices',input);if(token!==epoch||workspace.hidden)return;show('Boost prices saved for new quotes.');
    }catch(error){if(token===epoch&&!workspace.hidden)show(error.message,true);}
    finally{if(token===epoch){busy=false;snapshot=null;controls();void load();}}};
  new MutationObserver(()=>{epoch++;busy=false;snapshot=null;form.reset();status.textContent='Sign in to load boost prices.';controls();if(!workspace.hidden)void load();})
    .observe(workspace,{attributes:true,attributeFilter:['hidden']});if(!workspace.hidden)void load();
}
