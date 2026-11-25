export function model({limit=8,receipt=true,restarts=1}={}) {
  // Source-free lifecycle oracle; deliberately not a runtime.
  let state="running", generation=1, used=0, primary=null, incomplete=false, published=false, budget=restarts, dataFull=false;
  const live=new Map(), replies=new Set();
  const snapshot=()=>({state,generation,used,primary,incomplete,published,budget,dataFull,live:live.size,replies:replies.size,certified:false});
  if(!receipt)state="rejected";
  return {snapshot,
    admit(id,n,g=generation){if(state!=="running"||g!==generation||live.has(id)||!Number.isSafeInteger(n)||n<1||n>limit-used)return false;live.set(id,n);used+=n;return true},
    suspend(id){return state==="running"&&live.has(id)},
    fillData(){dataFull=true},
    checkedError(){return state==="running"?"Err":null},
    fault(reason){if(state!=="running")return false;state="fenced";primary=reason;return true},
    cleanupFailed(){if(state!=="fenced")return false;incomplete=true;return true},
    finish(id,g=generation){if(g!==generation||!live.has(id))return false;used-=live.get(id);live.delete(id);replies.add(id);return true},
    retire(){if(state!=="fenced"||live.size!==0)return false;state="retired";return true},
    notice(){if(state!=="retired"||published)return false;published=true;return true},
    restart(){if(state!=="retired"||!published||budget===0)return false;budget--;generation++;state="running";primary=null;incomplete=false;published=false;replies.clear();dataFull=false;return true}
  };
}
