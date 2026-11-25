// Task #35: bounded linear ownership/borrow-check reference oracle, not a compiler CFG.
const MODES=new Set(['read','write']);
const OPS=new Set(['declare','borrow','release','take','share','send','await','use','retire']);
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const reject=(code,index)=>Object.freeze({ok:false,diagnostic:code,index,evidence:'LINEAR_OWNERSHIP_ORACLE'});
export function verifyOwnershipTrace(events){
  if(!Array.isArray(events)||events.length>256)return reject('TRACE_LIMIT',-1);
  const values=new Map(),loans=new Map(),usedTokens=new Set();
  for(let index=0;index<events.length;index++){
    const e=events[index];
    if(!e||typeof e!=='object'||Array.isArray(e)||!OPS.has(e.op))
      return reject('INVALID_EVENT',index);
    const v=e.name===undefined?undefined:values.get(e.name);
    if(e.op==='declare'){
      if(!NAME.test(e.name||'')||values.has(e.name)||!NAME.test(e.owner||'')||
         typeof e.mutable!=='boolean'||typeof e.sendable!=='boolean'||
         !['data','closure','actor-state'].includes(e.kind))
        return reject('INVALID_DECLARATION',index);
      values.set(e.name,{owner:e.owner,mutable:e.mutable,sendable:e.sendable,
        kind:e.kind,live:true,readers:0,writer:false});
      continue;
    }
    if(e.op==='await'){
      if([...values.values()].some(v=>v.live&&v.writer&&v.kind==='actor-state'))
        return reject('EXCLUSIVE_ACTOR_LOAN_CROSSES_AWAIT',index);
      continue;
    }
    if(e.op==='release'){
      const loan=loans.get(e.token);
      if(!loan)return reject('UNKNOWN_OR_RELEASED_LOAN',index);
      if(e.actor!==undefined&&e.actor!==values.get(loan.name)?.owner)
        return reject('FOREIGN_ACTOR_LOAN_RELEASE',index);
      const owner=values.get(loan.name);
      if(loan.mode==='read')owner.readers--;
      else owner.writer=false;
      loans.delete(e.token);continue;
    }
    if(!v||!v.live)return reject('USE_AFTER_TAKE_OR_UNKNOWN',index);
    if(e.actor!==undefined&&e.actor!==v.owner)
      return reject('CROSS_ACTOR_PRIVATE_ACCESS',index);
    if(e.op==='borrow'){
      if(!MODES.has(e.mode)||!NAME.test(e.token||'')||usedTokens.has(e.token))
        return reject('INVALID_BORROW_TOKEN',index);
      if(e.mode==='write'&&(!v.mutable||v.writer||v.readers>0))
        return reject('WRITE_BORROW_CONFLICT',index);
      if(e.mode==='read'&&v.writer)return reject('READ_BORROW_CONFLICT',index);
      if(e.mode==='write')v.writer=true;else v.readers++;
      usedTokens.add(e.token);
      loans.set(e.token,{name:e.name,mode:e.mode});
    }else if(e.op==='take'||e.op==='send'||e.op==='retire'){
      if(v.writer||v.readers>0)return reject('OWNED_VALUE_HAS_LIVE_LOANS',index);
      if(e.op==='send'&&(!v.sendable||v.kind!=='data'))
        return reject('NON_SENDABLE_EXECUTABLE_VALUE',index);
      v.live=false;
    }else if(e.op==='share'){
      if(v.mutable||!v.sendable||v.kind!=='data'||v.writer)
        return reject('MUTABLE_OR_NON_SENDABLE_SHARE',index);
    }else if(e.op==='use'&&e.write===true&&(!v.mutable||v.readers>0||v.writer)){
      return reject('UNAUTHORIZED_WRITE',index);
    }
  }
  if(loans.size>0)return reject('UNRELEASED_LOANS',events.length);
  return Object.freeze({ok:true,diagnostic:null,index:events.length,
    evidence:'LINEAR_OWNERSHIP_ORACLE',verifiedGuest:false});
}
