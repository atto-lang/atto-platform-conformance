// Sequential oracle for bounded CONTROL registry reuse. No physical or backend certification.
// The external physical-release observation is a model input, not an authenticated receipt.
export function registry({capacity=4, maxIdentity=Number.MAX_SAFE_INTEGER, admissions=2}={}) {
  if (!Number.isSafeInteger(capacity)||capacity<2||capacity>4096||
      !Number.isSafeInteger(maxIdentity)||maxIdentity<1||
      !Number.isSafeInteger(admissions)||admissions<1||admissions>65536)
    throw new RangeError('invalid registry bounds');
  const slots=Array(capacity).fill(null);
  let next=1;
  const find=h=>h&&Number.isInteger(h.slot)&&h.slot>=0&&h.slot<capacity&&slots[h.slot]?.handle===h?slots[h.slot]:null;
  function mint(parent) {
    const index=slots.indexOf(null);
    if(index<0||next===null)return null;
    const handle=Object.freeze({slot:index,identity:next});
    next=next===maxIdentity?null:next+1;
    slots[index]={handle,parent,alive:true,fenced:false,primary:null,pending:false,
      decision:null,recovery:false,physical:false,permits:Array(admissions).fill(null)};
    return handle;
  }
  const guardian=mint(null);
  function below(cell,ancestor) {
    for(let p=cell.parent;p!==null;){if(p===ancestor)return true;p=find(p).parent;}
    return false;
  }
  return {guardian,
    status(h){const c=find(h);return c?{alive:c.alive,fenced:c.fenced,primary:c.primary,
      pending:c.pending,decision:c.decision!==null,recovery:c.recovery,physical:c.physical,
      permits:c.permits.filter(Boolean).length,certified:false}:null;},
    occupied(){return slots.filter(Boolean).length;},
    admit(parent){const p=find(parent);return p?.alive&&!p.fenced?mint(parent):null;},
    beginData(h){const c=find(h);if(!c?.alive||c.fenced)return null;const i=c.permits.indexOf(null);
      if(i<0)return null;const permit=Object.freeze({handle:h,index:i});c.permits[i]=permit;return permit;},
    finishData(p){const c=find(p?.handle);if(!c||c.permits[p.index]!==p)return false;
      c.permits[p.index]=null;return true;},
    fault(h,reason){const c=find(h);if(!c?.alive||h===guardian||typeof reason!=='string'||!reason.length)return false;
      c.alive=false;c.fenced=true;c.primary=reason;c.pending=true;c.recovery=true;
      for(const child of slots)if(child&&below(child,h))child.fenced=true;
      return true;},
    beginDecision(h){const c=find(h);if(!c?.pending||c.decision!==null)return null;
      c.decision=Object.freeze({handle:h});return c.decision;},
    finishDecision(d,committed){const c=find(d?.handle);if(!c||c.decision!==d||typeof committed!=='boolean')return false;
      c.decision=null;if(committed)c.pending=false;return true;},
    recoveryDrained(h){const c=find(h);if(!c?.recovery)return false;c.recovery=false;return true;},
    observePhysicalRelease(h){const c=find(h);if(!c||c.alive||c.permits.some(Boolean))return false;
      c.physical=true;return true;},
    reclaim(h){const c=find(h);if(!c||h===guardian||c.alive||!c.fenced||!c.physical||c.pending||
      c.decision!==null||c.recovery||c.permits.some(Boolean)||slots.some(child=>child&&child.parent===h))return false;
      slots[h.slot]=null;return true;}
  };
}
