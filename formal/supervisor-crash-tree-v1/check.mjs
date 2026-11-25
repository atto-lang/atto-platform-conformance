#!/usr/bin/env node
// Finite-state standalone REFERENCE MODEL. Not a production actor runtime, compiled guest, or unbounded proof.
function verifySupervisorCrashTree(){
 const names=["R","S","T","A","B"];
 const parent={R:null,S:"R",T:"S",A:"T",B:"R"};
 const controlled=["S","T","A"];
 const children=n=>names.filter(x=>parent[x]===n);
 const descendants=n=>names.filter(x=>{let p=parent[x];while(p){if(p===n)return true;p=parent[p]}return false});
 const newState=()=>({phase:{R:"running",S:"running",T:"running",A:"running",B:"running"},gen:{R:1,S:1,T:1,A:1,B:1},fenced:{R:false,S:false,T:false,A:false,B:false},loans:{R:1,S:1,T:1,A:1,B:1},pending:{R:0,S:0,T:0,A:0,B:0}});
 const copy=s=>JSON.parse(JSON.stringify(s));
 const assert=(v,m)=>{if(!v)throw Error(m)};
 const nearestController=(s,n)=>{let p=parent[n];while(p){if(s.phase[p]==="running"&&!s.fenced[p])return p;p=parent[p]}return null};
 function valid(s){
  if(s.phase.R!=="running"||s.fenced.R||s.phase.B!=="running"||s.fenced.B||s.gen.B!==1)return false;
  for(const n of names){
   if(!["running","failed","stopping","retired","reclaimed"].includes(s.phase[n]))return false;
   if(![1,2].includes(s.gen[n])||![0,1].includes(s.loans[n]))return false;
   if(s.pending[n]!==0&&s.pending[n]!==s.gen[n])return false;
   if(s.phase[n]==="reclaimed"&&(s.loans[n]!==0||s.pending[n]!==0||children(n).some(c=>s.phase[c]!=="reclaimed")))return false;
   if(s.phase[n]==="retired"&&s.loans[n]!==0)return false;
   if(s.phase[n]==="running"&&s.loans[n]!==1)return false;
   if(s.phase[n]==="failed"&&(!s.fenced[n]||descendants(n).some(c=>!s.fenced[c])))return false;
   if(s.pending[n]!==0&&nearestController(s,n)===null)return false;
  }
  return true;
 }
 function ack(s,n,epoch,controller){
  if(s.pending[n]!==epoch||epoch!==s.gen[n]||controller!==nearestController(s,n))return null;
  const t=copy(s);t.pending[n]=0;return t;
 }
 function send(s,n,epoch){
  return s.phase[n]==="running"&&!s.fenced[n]&&s.gen[n]===epoch;
 }
 function successors(s){
  const moves=[];
  for(const n of controlled){
   if(s.phase[n]==="running"&&!s.fenced[n]&&s.gen[n]===1){
    const t=copy(s);t.phase[n]="failed";t.fenced[n]=true;t.pending[n]=t.gen[n];
    for(const c of descendants(n))t.fenced[c]=true;
    moves.push(["crash:"+n,t]);
   }
  }
  for(const n of controlled){
   if(s.pending[n]!==0){
    const c=nearestController(s,n),t=ack(s,n,s.pending[n],c);
    if(t)moves.push(["ack:"+n+":"+c,t]);
   }
   if(s.phase[n]==="failed"||(s.phase[n]==="running"&&s.fenced[n])){
    const t=copy(s);t.phase[n]="stopping";moves.push(["stop:"+n,t]);
   }
   if(s.phase[n]==="stopping"&&s.loans[n]===1){
    const t=copy(s);t.loans[n]=0;t.phase[n]="retired";moves.push(["physical_done:"+n,t]);
   }
   if(s.phase[n]==="retired"&&s.pending[n]===0&&children(n).every(c=>s.phase[c]==="reclaimed")){
    const t=copy(s);t.phase[n]="reclaimed";moves.push(["reclaim:"+n,t]);
   }
   if(s.phase[n]==="reclaimed"&&s.gen[n]===1&&s.phase[parent[n]]==="running"&&!s.fenced[parent[n]]){
    const t=copy(s);t.phase[n]="running";t.gen[n]++;t.fenced[n]=false;t.loans[n]=1;
    moves.push(["restart:"+n,t]);
   }
  }
  return moves;
 }
 const init=newState();assert(valid(init),"bad initial state");
 const queue=[init],seen=new Set([JSON.stringify(init)]),hits={},examples={};
 const cap=180000;
 for(let i=0;i<queue.length;i++){
  const s=queue[i];assert(valid(s),"invalid reachable state at "+i);
  for(const [act,t] of successors(s)){
   assert(valid(t),"broken transition: "+act);
   if(act.startsWith("restart:")){const n=act.slice(8);assert(s.loans[n]===0&&s.phase[n]==="reclaimed","restart without retirement")}
   hits[act]=(hits[act]||0)+1;
   const k=JSON.stringify(t);
   if(!seen.has(k)){seen.add(k);queue.push(t);if(queue.length>cap)throw Error("state cap: "+queue.length)}
  }
  if(s.gen.S===2&&s.gen.T===2&&s.gen.A===2&&controlled.every(n=>s.phase[n]==="running")&&!examples.recovered)examples.recovered=i;
  if(s.phase.S==="failed"&&s.pending.T===1&&!examples.parent_failed_with_child_failure)examples.parent_failed_with_child_failure=i;
 }
 const crash=successors(init).find(([a])=>a==="crash:S")[1];
 assert(!send(crash,"A",1),"descendant admission not fenced");
 assert(send(crash,"B",1),"unrelated sibling not isolated");
 assert(ack(crash,"S",2,"R")===null,"future generation ack accepted");
 assert(ack(crash,"S",1,"S")===null,"dead self acknowledged");
 assert(ack(crash,"S",1,"R")!==null,"guardian cannot acknowledge");
 const mutant1=copy(crash);mutant1.fenced.A=false;
 assert(!valid(mutant1),"missing descendant-fence mutation undetected");
 const mutant2=copy(crash);mutant2.phase.S="reclaimed";
 assert(!valid(mutant2),"unearned reclamation mutation undetected");
 const mutant3=copy(crash);mutant3.pending.S=2;
 assert(!valid(mutant3),"wrong generation notice mutation undetected");
 assert(examples.recovered!==undefined,"no full subtree recovery path");
 assert(examples.parent_failed_with_child_failure!==undefined,"no live escrowed child failure during supervisor crash");
 for(const kind of ["crash:S","crash:T","crash:A","restart:S","restart:T","restart:A","reclaim:S","ack:T:R"])
  assert(hits[kind]>0,"vacuous action "+kind);
 return {status:"MODEL_ONLY",states:queue.length,edges:Object.values(hits).reduce((a,b)=>a+b,0),witnesses:examples,mutantsRejected:3,staleOrForgedAcksRejected:2,actionTypes:Object.keys(hits).length};
}
console.log(JSON.stringify(verifySupervisorCrashTree()));
