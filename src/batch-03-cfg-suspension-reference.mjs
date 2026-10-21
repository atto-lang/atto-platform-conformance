// Source-free CFG loan check for native continuation design.
// The pin marker here is synthetic; it cannot authorize actual LLVM lowering.
const deny=s=>{throw Error("CFG_DENIED: "+s)};
const need=(x,s)=>{if(!x)deny(s)};
const token=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_:-]{0,80}$/.test(x);
const snap=s=>JSON.stringify({
  loans:[...s.loans].sort((a,b)=>a[0].localeCompare(b[0])),
  pins:[...s.pins].sort((a,b)=>a[0].localeCompare(b[0]))
});
export function auditSuspensionCfg(cfg){
  need(cfg?.schema===1&&token(cfg.entry)&&Array.isArray(cfg.blocks)&&
    cfg.blocks.length>0&&cfg.blocks.length<=128,"CFG budget");
  const blocks=new Map();
  for(const b of cfg.blocks){
    need(token(b.id)&&!blocks.has(b.id)&&Array.isArray(b.ops)&&
      b.ops.length<=128&&Array.isArray(b.next)&&b.next.length<=8,"block");
    blocks.set(b.id,b);
  }
  need(blocks.has(cfg.entry),"entry");
  for(const b of blocks.values())
    need(b.next.every(n=>blocks.has(n))&&new Set(b.next).size===b.next.length,
      "CFG successor");
  const queue=[{block:cfg.entry,state:{loans:new Map(),pins:new Map()}}];
  const visited=new Map();let terminals=0;
  while(queue.length){
    need(visited.size+queue.length<=4096,"CFG convergence budget");
    const {block,state}=queue.shift(),prior=visited.get(block),current=snap(state);
    if(prior!==undefined){need(prior===current,"conflicting CFG join");continue;}
    visited.set(block,current);
    const b=blocks.get(block);
    for(const op of b.ops){
      need(op&&typeof op==="object"&&token(op.op),"CFG instruction");
      switch(op.op){
        case "borrow":
          need(token(op.loan)&&token(op.owner)&&!state.loans.has(op.loan)&&
            ["READ","WRITE"].includes(op.mode),"loan identity");
          for(const existing of state.loans.values())
            need(existing.owner!==op.owner||
              (existing.mode==="READ"&&op.mode==="READ"),"overlap");
          state.loans.set(op.loan,{owner:op.owner,mode:op.mode});break;
        case "release":
          need(state.loans.delete(op.loan),"missing loan");break;
        case "pin":
          need(token(op.owner)&&token(op.frame)&&!state.pins.has(op.owner),
            "frame pin");
          state.pins.set(op.owner,op.frame);break;
        case "unpin":
          need(state.pins.has(op.owner)&&
            ![...state.loans.values()].some(l=>l.owner===op.owner),"live pin");
          state.pins.delete(op.owner);break;
        case "suspend":
          need(["await","select","readch","writech","timeout"].includes(op.kind)&&
            token(op.frame),"suspend");
          for(const l of state.loans.values())
            need(state.pins.get(l.owner)===op.frame,"unpinned continuation loan");
          break;
        case "move":
        case "drop":
          need(token(op.owner)&&!state.pins.has(op.owner)&&
            ![...state.loans.values()].some(l=>l.owner===op.owner),"owner still borrowed");
          break;
        case "exit":
          need(state.loans.size===0&&state.pins.size===0,"early physical exit");
          break;
        default:deny("unknown instruction");
      }
    }
    if(!b.next.length){
      need(b.ops.at(-1)?.op==="exit","missing terminal exit");
      terminals++;
    }
    for(const next of b.next)queue.push({block:next,
      state:{loans:new Map(state.loans),pins:new Map(state.pins)}});
  }
  need(terminals>0&&visited.size===blocks.size,"unreachable/unending CFG");
  return {classification:"SOURCE_FREE_CFG_ONLY",nativeGuestVerified:false,
    nodes:visited.size,terminatingPaths:terminals};
}
