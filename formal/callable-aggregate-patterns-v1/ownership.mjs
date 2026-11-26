// Finite ownership transition model. No actual compiler execution or async proof.
export function ownershipModel(){
 const assert=(p,m)=>{if(!p)throw Error(m)};
 const paths=["root","root.0","root.0.0","root.0.1","root.1"];
 const leaves=paths.slice(2);
 const overlap=(a,b)=>a===b||a.startsWith(b+".")||b.startsWith(a+".");
 const selected=p=>leaves.map((x,i)=>overlap(p,x)?i:-1).filter(i=>i>=0);
 const init={root:[1,1,1],local:[0,0,0],drops:[0,0,0],loans:[null,null]};
 const clone=s=>JSON.parse(JSON.stringify(s)), key=s=>JSON.stringify(s);
 function invariant(s){
   for(let i=0;i<3;i++){
     if(![s.root[i],s.local[i],s.drops[i]].every(x=>x===0||x===1))return false;
     if(s.root[i]+s.local[i]+s.drops[i]!==1)return false;
   }
   for(const l of s.loans.filter(Boolean))if(selected(l.path).some(i=>s.root[i]!==1))return false;
   const [a,b]=s.loans;
   if(a&&b&&overlap(a.path,b.path)&&(a.mode==="exclusive"||b.mode==="exclusive"))return false;
   return true;
 }
 const ops=[];
 for(const p of paths){
   ops.push({kind:"move",path:p},{kind:"dropRoot",path:p},{kind:"readRoot",path:p});
   for(let slot=0;slot<2;slot++)for(const mode of ["shared","exclusive"])ops.push({kind:"loan",path:p,slot,mode});
 }
 for(let slot=0;slot<2;slot++)ops.push({kind:"release",slot});
 for(let i=0;i<3;i++)ops.push({kind:"dropLocal",index:i});
 ops.push({kind:"close"});
 function step(s,o,mutation=""){
   const t=clone(s);
   const ids=o.path?selected(o.path):[];
   const anyOverlap=o.path!==undefined&&s.loans.some(l=>l&&overlap(l.path,o.path));
   switch(o.kind){
     case "loan":
       if(s.loans[o.slot]||ids.some(i=>s.root[i]!==1))return null;
       if(mutation!=="overlap"&&s.loans.some(l=>l&&overlap(l.path,o.path)&&(o.mode==="exclusive"||l.mode==="exclusive")))return null;
       t.loans[o.slot]={path:o.path,mode:o.mode};break;
     case "release":
       if(!s.loans[o.slot])return null;t.loans[o.slot]=null;break;
     case "readRoot":
       if(ids.some(i=>s.root[i]!==1)||s.loans.some(l=>l&&l.mode==="exclusive"&&overlap(l.path,o.path)))return null;break;
     case "move":case "dropRoot":
       if(ids.some(i=>s.root[i]!==1)||(anyOverlap&&mutation!=="moveWhileBorrowed"))return null;
       for(const i of ids){
         if(mutation!=="duplicateOwner")t.root[i]=0;
         if(o.kind==="move")t.local[i]=1;else t.drops[i]++;
       }break;
     case "dropLocal":
       if(!s.local[o.index]&&mutation!=="doubleDrop")return null;
       t.local[o.index]=0;t.drops[o.index]++;break;
     case "close":
       if(s.loans.some(Boolean)&&mutation!=="closeWithLoan")return null;
       for(let i=0;i<3;i++){
         t.drops[i]+=t.root[i]+t.local[i];t.root[i]=0;t.local[i]=0;
       }break;
     default:throw Error("unknown operation");
   }
   return t;
 }
 // Independent admission predicate using sets of leaf identities, not prefix overlap.
 function allowed(s,o){
   if(o.kind==="release")return s.loans[o.slot]!==null;
   if(o.kind==="dropLocal")return s.local[o.index]===1;
   if(o.kind==="close")return s.loans.every(l=>l===null);
   const member=(p,x)=>p.split(".").every((part,j)=>part===x.split(".")[j]);
   const covered=leaves.map((x,i)=>member(o.path,x)?i:-1).filter(i=>i!==-1);
   if(!covered.every(i=>s.root[i]===1))return false;
   const intersect=l=>covered.some(i=>member(l.path,leaves[i]));
   const conflicts=s.loans.filter(l=>l&&intersect(l));
   if(o.kind==="loan")return !s.loans[o.slot]&&conflicts.every(l=>l.mode==="shared"&&o.mode==="shared");
   if(o.kind==="readRoot")return conflicts.every(l=>l.mode==="shared");
   return conflicts.length===0;
 }
 const q=[init],seen=new Set([key(init)]);let edges=0,denials=0,reads=0,closures=0,acceptedMoves=0;
 const counters={};
 for(let h=0;h<q.length;h++){
   const s=q[h];assert(invariant(s),"invariant at reachable state");
   for(const op of ops){
     const t=step(s,op);assert((t!==null)===allowed(s,op),"admission disagrees with leaf-set oracle");
     if(!t){denials++;continue;}
     edges++;assert(invariant(t),"invariant violation after "+JSON.stringify(op));
     if(op.kind==="move")acceptedMoves++;
     if(op.kind==="readRoot"){reads++;assert(key(s)===key(t),"read mutated ownership");}
     if(op.kind==="close"){closures++;assert(t.drops.every(d=>d===1),"close fails to destroy exactly once");}
     const k=key(t);if(!seen.has(k)){seen.add(k);q.push(t);}
   }
 }
 for(const m of ["overlap","moveWhileBorrowed","duplicateOwner","doubleDrop","closeWithLoan"]){
   let witness=null;
   outer:for(const s of q)for(const op of ops){
     const t=step(s,op,m);
     if(t&&!invariant(t)){witness={before:s,operation:op,after:t};break outer;}
   }
   assert(witness,"mutation not caught: "+m);counters[m]=witness;
 }
 return {status:"MODEL_ONLY",resources:3,loanSlots:2,reachableStates:q.length,acceptedTransitions:edges,rejectedTransitions:denials,readChecks:reads,closeChecks:closures,moveChecks:acceptedMoves,mutantsDetected:Object.keys(counters),counterexamples:counters,compilerExecuted:false,asyncUnwindAndEscapesModeled:false};
}

console.log(JSON.stringify(ownershipModel(), null, 2));
