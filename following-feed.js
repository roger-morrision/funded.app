// No device identifiers or analytics. Each fetch covers one explicit page of follows.
export function createFollowingFeed({ load, render }) {
  let ids=[], enabled=false, sequence=0, abort=null;
  let state={creators:[],after:'',previous:[],nextCursor:null,loading:false,error:'',requestedCount:0,checkedCount:0};
  const emit=()=>render({...state,creators:[...state.creators],previous:[...state.previous],enabled});
  const invalidate=()=>{sequence++;abort?.abort();abort=null;};
  async function refresh() {
    if(!enabled)return;
    invalidate();const request=sequence,controller=new AbortController();abort=controller;
    state={...state,creators:[],loading:true,error:''};emit();
    try {
      const page=await load([...ids],state.after,controller.signal);
      if(request!==sequence||!enabled)return;
      if(!page||!Array.isArray(page.creators)||page.creators.length>20)throw new Error('Unexpected following response. Try again.');
      state={...state,...page,loading:false,error:''};
    }catch(error){if(request!==sequence||!enabled)return;state={...state,loading:false,error:'Updates are unavailable. Retry this page; no following preferences were changed.'};}
    if(request===sequence){abort=null;emit();}
  }
  function setContext(nextIds,nextEnabled) {
    const normalized=[...new Set(nextIds.filter(id=>typeof id==='string'&&/^\d{1,24}$/.test(id)))].sort().slice(0,200);
    if(enabled===nextEnabled&&JSON.stringify(ids)===JSON.stringify(normalized))return false;
    invalidate();ids=normalized;enabled=nextEnabled;
    state={creators:[],after:'',previous:[],nextCursor:null,loading:false,error:'',requestedCount:ids.length,checkedCount:0};emit();return true;
  }
  return {setContext,refresh,
    next(){if(!enabled||state.loading||!state.nextCursor)return;state={...state,previous:[...state.previous,state.after],after:state.nextCursor};return refresh();},
    previous(){if(!enabled||state.loading||!state.previous.length)return;const previous=[...state.previous],after=previous.pop();state={...state,previous,after};return refresh();},
    first(){if(!enabled||state.loading)return;state={...state,after:'',previous:[]};return refresh();},
    dispose(){invalidate();enabled=false;state={...state,creators:[],loading:false};emit();},
  };
}
