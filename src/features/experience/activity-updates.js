import { activityRows, isActivityHidden } from './activity-model.js';
import { array } from './view-utils.js';
import { APP_NET } from '../shared/app-network.js';
let latestExperience = null, experienceCheckedAt = 0;
globalThis.addEventListener?.('funded:financial-experience',event=>{latestExperience=event.detail;experienceCheckedAt=Date.now();});

// Notifications still consume shared activity records after the Home feed is removed.
export function initializeActivityUpdates(app) {
  let statements=[],busy=false;
  function publish(){
    let trades=[];try{trades=app.collectRecentTrades(app.assets,{limit:50,since:Math.floor(Date.now()/1000)-86400});}catch{}
    const rows=activityRows(app.verifiedLaunchPolicies,latestExperience,trades,statements).filter(row=>!isActivityHidden(row));
    window.dispatchEvent(new CustomEvent('funded:feed-data',{detail:rows}));
  }
  async function refresh(){
    if(busy||!document.body.classList.contains('page-route-overview'))return;busy=true;
    try{
      const read=path=>app.apiRequest(path,{signal:AbortSignal.timeout(15000)}).catch(()=>null);
      const cached=latestExperience?.cluster===APP_NET&&Date.now()-experienceCheckedAt<30000;
      const [experience,content]=await Promise.all([cached?Promise.resolve({available:true,data:latestExperience}):read('/api/rewards/experience'),read('/api/financial/activity')]);
      if(experience?.available){latestExperience=experience.data;experienceCheckedAt=Date.now();}
      if(content?.available&&content.data?.cluster===APP_NET)statements=array(content.data.statements);
      publish();
    }finally{busy=false;}
  }
  for(const name of ['funded:financial-experience','funded:token-list-markets','funded:content-preferences'])window.addEventListener(name,publish);
  document.addEventListener('funded:token-list-markets',publish);
  window.addEventListener('funded:route-change',()=>void refresh());
  window.addEventListener('funded:reward-identity-change',()=>{latestExperience=null;experienceCheckedAt=0;void refresh();});
  void refresh();
}
