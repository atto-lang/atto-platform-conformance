#!/usr/bin/env node
// Self-contained finite-state model: not a compiled AttoLang guest, runtime proof, or arbitrary-tree theorem.
function verifyNestedSupervisorCrashV2(){
 const nodes=["R","S","T","A","B"],managed=["S","T","A"],parent={R:null,S:"R",T:"S",A:"T",B:"R"};
 const children=n=>nodes.filter(x=>parent[x]===n);
 const descendants=n=>nodes.filter(x=>{let p=parent[x];while(p){if(p===n)return true;p=parent[p]}return false});
 const initial=()=>({
  phase:Object.fromEntries(nodes.map(n=>[n,"running"])),
  generation:Object.fromEntries(nodes.map(n=>[n,1])),
  fenced:Object.fromEntries(nodes.map(n=>[n,false])),
  loans:Object.fromEntries(nodes.map(n=>[n,1])),
  pending:Object.fromEntries(nodes.map(n=>[n,0])),
  delivered:Object.fromEntries(nodes.map(n=>[n,""]))
 });
 const clone=s=>JSON.parse(JSON.stringify(s));
 const assert=(ok,why)=>{if(!ok)throw Error(why)};
 const controller=(s,n)=>{let p=parent[n];while(p){if(s.phase[p]==="running"&&!s.fenced[p])return p;p=parent[p]}return null};
 const lease=(s,n)=>`${n}@${s.generation[n]}`;
 const canSend=(s,n,epoch)=>s.phase[n]==="running"&&!s.fenced[n]&&s.generation[n]===epoch;
 const invariants=s=>{
  if(s.phase.R!=="running"||s.phase.B!=="running"||s.fenced.R||s.fenced.B||s.generation.B!==1)return false;
  for(const n of nodes){
   if(!["running","failed","stopping","retired","reclaimed"].includes(s.phase[n]))return false;
   if(![1,2].includes(s.generation[n])||![0,1].includes(s.loans[n]))return false;
   if(s.pending[n]!==0&&s.pending[n]!==s.generation[n])return false;
   if(s.pending[n]===0&&s.delivered[n]!=="")return false;
   if(s.delivered[n]!==""&&!/^(R|S|T)@[12]$/.test(s.delivered[n]))return false;
   if(s.phase[n]==="running"&&s.loans[n]!==1)return false;
   if(["failed","stopping"].includes(s.phase[n])&&!s.fenced[n])return false;
   if(["retired","reclaimed"].includes(s.phase[n])&&s.loans[n]!==0)return false;
   if(s.phase[n]==="reclaimed"&&(s.pending[n]!==0||children(n).some(c=>s.phase[c]!=="reclaimed")))return false;
   if(s.phase[n]==="failed"&&descendants(n).some(d=>!s.fenced[d]))return false;
   if(!s.fenced[n]&&s.phase[n]==="running"){
    let a=parent[n];
    while(a){if(s.phase[a]!=="running"||s.fenced[a])return false;a=parent[a]}
   }
   if(s.pending[n]!==0&&controller(s,n)===null)return false;
  }
  return true;
 };
 const acknowledge=(s,n,actor,actorGeneration)=>{
  const c=controller(s,n);
  if(!s.pending[n]||c!==actor||s.generation[actor]!==actorGeneration||s.delivered[n]!==`${actor}@${actorGeneration}`)return null;
  const t=clone(s);t.pending[n]=0;t.delivered[n]="";return t;
 };
 const successor=s=>{
  const edges=[];
  for(const n of managed){
   if(s.phase[n]==="running"){
    const t=clone(s);t.phase[n]="failed";t.fenced[n]=true;t.pending[n]=t.generation[n];t.delivered[n]="";
    for(const d of descendants(n))t.fenced[d]=true;
    edges.push([`crash:${n}@${t.generation[n]}`,t]);
   }
   const c=controller(s,n);
   if(s.pending[n]>0&&c){
    const current=lease(s,c);
    if(s.delivered[n]!==current){
     const t=clone(s);t.delivered[n]=current;edges.push([`deliver:${n}:${current}`,t]);
    }else{
     const t=acknowledge(s,n,c,s.generation[c]);
     if(t)edges.push([`ack:${n}:${current}`,t]);
    }
   }
   if(s.phase[n]==="failed"||(s.phase[n]==="running"&&s.fenced[n])){
    const t=clone(s);t.phase[n]="stopping";edges.push([`begin_stop:${n}`,t]);
   }
   if(s.phase[n]==="stopping"&&s.loans[n]===1){
    const t=clone(s);t.loans[n]=0;t.phase[n]="retired";edges.push([`physical_done:${n}`,t]);
   }
   if(s.phase[n]==="retired"&&s.pending[n]===0&&children(n).every(c=>s.phase[c]==="reclaimed")){
    const t=clone(s);t.phase[n]="reclaimed";edges.push([`reclaim:${n}`,t]);
   }
   if(s.phase[n]==="reclaimed"&&s.generation[n]===1){
    const p=parent[n];
    if(s.phase[p]==="running"&&!s.fenced[p]){
     const t=clone(s);t.phase[n]="running";t.generation[n]=2;t.fenced[n]=false;t.loans[n]=1;edges.push([`restart:${n}@2`,t]);
    }
   }
  }
  return edges;
 };
 const root=initial(),queue=[root],seen=new Map([[JSON.stringify(root),0]]),hits={},witness={},edgesByType={};
 const cap=180000;
 for(let i=0;i<queue.length;i++){
  const s=queue[i];assert(invariants(s),`state invariant failed at index ${i}`);
  if(s.phase.S==="failed"&&s.pending.T===1&&s.delivered.T==="S@1"&&witness.supervisorCrashesWithDeliveredChild===undefined)witness.supervisorCrashesWithDeliveredChild=i;
  if(s.phase.S==="failed"&&s.pending.T===1&&s.delivered.T==="R@1"&&witness.reroutedToGuardian===undefined)witness.reroutedToGuardian=i;
  if(managed.every(n=>s.generation[n]===2&&s.phase[n]==="running")&&witness.recoveredAll===undefined)witness.recoveredAll=i;
  if(s.phase.S==="failed"&&s.phase.T==="failed"&&s.pending.S&&s.pending.T&&witness.nestedConcurrentFailure===undefined)witness.nestedConcurrentFailure=i;
  for(const [a,t] of successor(s)){
   assert(invariants(t),`transition ${a} violated invariant at ${i}`);
   hits[a]=(hits[a]||0)+1;
   const kind=a.split(":")[0];edgesByType[kind]=(edgesByType[kind]||0)+1;
   const key=JSON.stringify(t);if(!seen.has(key)){seen.set(key,queue.length);queue.push(t);if(queue.length>cap)throw Error(`bounded state explosion ${queue.length}`)}
  }
 }
 const crashS=successor(root).find(([a])=>a==="crash:S@1")[1];
 assert(!canSend(crashS,"T",1)&&!canSend(crashS,"A",1),"descendant admission escaped fence");
 assert(canSend(crashS,"B",1),"unrelated sibling suppressed");
 const crashT=successor(root).find(([a])=>a==="crash:T@1")[1];
 const delivered=successor(crashT).find(([a])=>a==="deliver:T:S@1")[1];
 const parentCrashed=successor(delivered).find(([a])=>a==="crash:S@1")[1];
 assert(parentCrashed.pending.T===1&&parentCrashed.delivered.T==="S@1","escrow lost on parent crash");
 assert(acknowledge(parentCrashed,"T","S",1)===null,"dead supervisor acknowledged");
 const rerouted=successor(parentCrashed).find(([a])=>a==="deliver:T:R@1")[1];
 assert(acknowledge(rerouted,"T","R",1)!==null,"surviving ancestor cannot ack");
 assert(acknowledge(rerouted,"T","R",2)===null,"forged guardian generation accepted");
 assert(acknowledge(rerouted,"T","S",1)===null,"stale old delivery accepted");
 const mut1=clone(crashS);mut1.fenced.T=false;assert(!invariants(mut1),"descendant-fence mutation escaped");
 const mut2=clone(parentCrashed);mut2.phase.S="reclaimed";assert(!invariants(mut2),"unearned reclamation escaped");
 const mut3=clone(parentCrashed);mut3.pending.T=2;assert(!invariants(mut3),"wrong receipt generation escaped");
 const mut4=clone(parentCrashed);mut4.fenced.B=true;assert(!invariants(mut4),"sibling-isolation mutation escaped");
 const mut5=clone(crashS);mut5.phase.T="running";mut5.fenced.T=false;assert(!invariants(mut5),"unsupervised active descendant mutation escaped");
 for(const key of ["supervisorCrashesWithDeliveredChild","reroutedToGuardian","recoveredAll","nestedConcurrentFailure"])
  assert(witness[key]!==undefined,`missing critical witness ${key}`);
 return {status:"MODEL_ONLY",states:queue.length,edges:Object.values(hits).reduce((a,b)=>a+b,0),actions:Object.keys(hits).length,edgesByType,witness,mutantsRejected:5,forgedAcksRejected:3};
}
const result = verifyNestedSupervisorCrashV2();
if (typeof process !== 'undefined' && process.stdout) process.stdout.write(JSON.stringify(result) + '\n');
