import {readStatus} from './src/features/growth/status-page.js';
export function initAdminServiceStatus({session,api,document=globalThis.document}){
  const panel=document.getElementById('admin-service-status');let busy=false;
  async function refresh(){
    if(!session.active||busy)return;busy=true;const epoch=session.epoch;
    try{const rows=await readStatus(path=>api(path,{signal:AbortSignal.timeout(12000)}).catch(()=>null));
      if(!session.active||!session.current(epoch))return;
      const list=panel.querySelector('tbody');list.replaceChildren();
      for(const [name,state,detail] of rows){const tr=document.createElement('tr');for(const text of [name,({ok:'Operational',checking:'Checking',degraded:'Degraded',down:'Down',unknown:'Unavailable'})[state],detail]){const td=document.createElement('td');td.textContent=text;tr.append(td);}list.append(tr);}
    }finally{busy=false;}
  }
  panel.querySelector('button').addEventListener('click',()=>void refresh());
  return {refresh};
}
