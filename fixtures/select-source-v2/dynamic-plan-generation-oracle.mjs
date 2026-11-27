// Source-free reference oracle only. Not compiler/guest execution evidence.
// Run: node fixtures/select-source-v2/dynamic-plan-generation-oracle.mjs
function verifyDynamicPlanOracle() {
  let checks=0;
  function check(ok,msg){checks++;if(!ok)throw new Error(msg);}
  function create(keys,cursor=0){return {version:0,keys:[...keys],cursor};}
  function mutate(p,keys){return {version:p.version+1,keys:[...keys],cursor:p.cursor};}
  function ticket(p){return {generation:p,state:"pending",result:null};}
  function cancel(t){if(t.state!=="pending")return false;t.state="cancelled";return true;}
  function probe(t,ready,policy="fair"){
    if(t.state!=="pending")return null;
    const g=t.generation,n=g.keys.length;
    for(let k=0;k<n;k++){
      const i=policy==="fair"?(g.cursor+k)%n:k;
      const key=g.keys[i];
      if(!ready.has(key))continue;
      ready.delete(key);
      t.state="committed";t.result={version:g.version,key,index:i};
      if(policy==="fair")g.cursor=(i+1)%n;
      return t.result;
    }
    return null;
  }
  for(let n=1;n<=8;n++)for(let start=0;start<n;start++)for(let mask=0;mask<(1<<n);mask++){
    const keys=Array.from({length:n},(_,i)=>i),g=create(keys,start),a=ticket(g),b=ticket(g);
    const ready=new Set(keys.filter(i=>mask&(1<<i)));
    const ordered=Array.from({length:n},(_,i)=>(start+i)%n).filter(i=>ready.has(i));
    let first=probe(a,ready),second=probe(b,ready);
    check((first?.key??null)===(ordered[0]??null),"first FAIR winner");
    check((second?.key??null)===(ordered[1]??null),"overlapping FAIR winner");
    check(g.cursor===(ordered.length?((ordered[Math.min(1,ordered.length-1)]+1)%n):start),"commit-only cursor");
    check(ready.size===Math.max(0,ordered.length-2),"losers preserve readiness");
    if(first){check(!cancel(a),"postcommit cancellation");check(probe(a,ready)===null,"no duplicate commit");}
    else{check(cancel(a),"precommit cancellation");check(probe(a,new Set(keys))===null,"cancelled cannot consume");}
    const old=ticket(g),newG=mutate(g,keys.map(x=>x+n)),fresh=ticket(newG),before=newG.cursor;
    const oldReady=new Set(keys),newReady=new Set(newG.keys);
    const oldWinner=probe(old,oldReady);
    check(oldWinner.version===0 && oldWinner.key<n,"old version/key pinned");
    check(newG.cursor===before,"old generation cannot rotate new generation");
    const next=probe(fresh,newReady);
    check(next.version===1 && next.key>=n,"new version/key pinned");
    const x=ticket(newG),y=ticket(newG);let c=newG.cursor;
    check(cancel(x),"cancel accepted");
    check(probe(x,newReady)===null && newG.cursor===c,"cancel does not affect fairness");
    check(probe(y,new Set(),"first")===null && newG.cursor===c,"immediate miss preserves fairness");
  }
  return checks;
}
const checks = verifyDynamicPlanOracle();
console.log("DYNAMIC_PLAN_REFERENCE_CHECKS=" + checks);
