// Candidate source-free AttoLang borrow oracle. This is NOT compiler or guest execution.
function checkCase(t) {
 const err=(s)=>{throw Error(s)}, clone=s=>({owners:JSON.parse(JSON.stringify(s.owners)),loans:JSON.parse(JSON.stringify(s.loans))});
 const root=s=>s.split(".")[0], owns=(s,p)=>{let k=root(p);if(!s.owners[k])err("E_NOT_OWNED");return k};
 const loans=(s,p)=>Object.values(s.loans).filter(v=>v.root===root(p));
 const shape=s=>JSON.stringify({owners:Object.entries(s.owners).sort(),loans:Object.entries(s.loans).sort()});
 function walk(steps,s) {
  for(const a of steps) {
   const [op,x,y]=a;
   switch(op) {
    case "init": if(s.owners[x])err("E_DOUBLE_INIT");s.owners[x]={copy:y==="copy",send:y==="copy"||y==="send"};break;
    case "read": owns(s,x);if(loans(s,x).some(v=>v.mode==="mut"))err("E_ALIAS");break;
    case "write": owns(s,x);if(loans(s,x).length)err("E_ALIAS");break;
    case "borrow_shared":case "borrow_mut":
      owns(s,x);if(s.loans[y]||!y)err("E_LOAN_ID");
      if(loans(s,x).some(v=>v.mode==="mut")||(op==="borrow_mut"&&loans(s,x).length))err("E_ALIAS");
      s.loans[y]={root:root(x),mode:op==="borrow_mut"?"mut":"shared"};break;
    case "write_via_mut": owns(s,x);if(s.loans[y]?.mode!=="mut"||s.loans[y]?.root!==root(x))err("E_LOAN_AUTH");break;
    case "release":if(!s.loans[x])err("E_LOAN_ID");delete s.loans[x];break;
    case "move":case "copy":{const k=owns(s,x);if(loans(s,x).length)err("E_ALIAS");if(s.owners[y])err("E_DOUBLE_INIT");if(op==="copy"&&!s.owners[k].copy)err("E_COPY_PROOF");s.owners[y]={...s.owners[k]};if(op==="move")delete s.owners[k];break}
    case "drop":{const k=owns(s,x);if(loans(s,x).length)err("E_ALIAS");delete s.owners[k];break}
    case "capture_copy":{let k=owns(s,x);if(!s.owners[k].send||!s.owners[k].copy)err("E_CAPTURE_PROOF");break}
    case "capture_move":{let k=owns(s,x);if(!s.owners[k].send||loans(s,x).length)err("E_CAPTURE_PROOF");delete s.owners[k];break}
    case "suspend":if(Object.keys(s.loans).length)err("E_SUSPEND_LOAN");break;
    case "actor_hop_borrow":err("E_ACTOR_ESCAPE");
    case "branch":{const left=walk(x,clone(s)),right=walk(y,clone(s));if(shape(left)!==shape(right))err("E_JOIN");s=left;break}
    case "loop":err("E_UNPROVEN_LOOP");
    case "return":if(Object.keys(s.loans).length)err("E_LOAN_ESCAPE");break;
    default:err("E_UNKNOWN_OP");
   }
  }
  return s;
 }
 try{walk(t.ops,{owners:{},loans:{}});return "OK"}catch(e){return e.message.startsWith("E_")?e.message:"E_ORACLE"}
}
function verifyManifest(m) {
 const bs=["java","net","llvm","wasm","cranelift"];
 if(m.version!=="atto.borrow.v1"||JSON.stringify(m.backends)!==JSON.stringify(bs))throw Error("E_BACKENDS");
 if(Object.keys(m.status).sort().join(",")!==[...bs].sort().join(",")||Object.values(m.status).some(x=>x!=="NOT_EXECUTED"))throw Error("E_FALSE_EVIDENCE");
 if(m.cases.length<15||new Set(m.cases.map(x=>x.id)).size!==m.cases.length)throw Error("E_CASE_IDS");
 for(const c of m.cases)if(!c.id||checkCase(c)!==c.expected)throw Error("E_CASE:"+c.id);
 return m.cases.length;
}
export {checkCase,verifyManifest};
