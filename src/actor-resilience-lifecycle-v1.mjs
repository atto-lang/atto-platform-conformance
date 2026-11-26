export function model({limit=8,arenaLimit=8,unwindReserve=0,receipt=true,restarts=1}={}) {
  // Sequential source-free oracle: no physical allocation, concurrency or certification.
  const count=n=>Number.isSafeInteger(n)&&n>=0;
  const key=id=>typeof id==="string"&&id.length>0&&id.length<=128;
  const valid=count(limit)&&count(arenaLimit)&&count(unwindReserve)&&unwindReserve<=limit&&count(restarts)&&receipt===true;
  let state=valid?"running":"rejected", generation=1, used=0, arena=0, reserve=valid?unwindReserve:0, primary=null, incomplete=false, published=false, budget=valid?restarts:0, dataFull=false;
  const live=new Map(), seen=new Set(), io=new Map(), ioSeen=new Set();
  let replies=0;
  const snapshot=()=>({state,generation,used,arena,reserve,primary,incomplete,published,budget,dataFull,live:live.size,io:io.size,replies,certified:false});
  return {snapshot,
    admit(id,n,g=generation){if(state!=="running"||g!==generation||!key(id)||seen.has(id)||!count(n)||n===0||n>limit-unwindReserve-used)return false;seen.add(id);live.set(id,n);used+=n;return true},
    suspend(id){return state==="running"&&live.has(id)},
    allocate(n){if(state!=="running"||!count(n)||n===0||n>arenaLimit-arena)return false;arena+=n;return true},
    startIo(id,inv,g=generation){if(state!=="running"||g!==generation||!key(id)||ioSeen.has(id)||!live.has(inv))return false;ioSeen.add(id);io.set(id,inv);return true},
    finishIo(id,g){if(g!==generation||!io.has(id))return false;io.delete(id);return true},
    fillData(){if(state==="running")dataFull=true},
    checkedError(){return state==="running"?"Err":null},
    fault(reason){if(state!=="running"||!key(reason))return false;state="fenced";primary=reason;return true},
    cleanup(n){if(state!=="fenced"||incomplete||!count(n)||n===0)return false;if(n>reserve){incomplete=true;return false}reserve-=n;return true},
    cleanupFailed(){if(state!=="fenced")return false;incomplete=true;return true},
    finish(id,g){if(g!==generation||!live.has(id)||[...io.values()].includes(id))return false;used-=live.get(id);live.delete(id);replies++;return true},
    quarantine(){if(state!=="fenced")return false;state="quarantined";return true},
    retire(){if(state!=="fenced"||live.size!==0||io.size!==0)return false;arena=0;state="retired";return true},
    notice(){if(state!=="retired"||published)return false;published=true;return true},
    restart(){if(state!=="retired"||!published||budget===0||generation===Number.MAX_SAFE_INTEGER)return false;budget--;generation++;state="running";primary=null;incomplete=false;published=false;replies=0;reserve=unwindReserve;seen.clear();ioSeen.clear();return true}
  };
}
