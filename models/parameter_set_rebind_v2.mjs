// HOST_ONLY symbolic model; no source compilation, real allocation, CFG or concurrency proof.
function parameterSetModelChecks() {
  // HOST_ONLY: a symbolic reference/ownership state machine, not an Atto compiler.
  const check = (ok, label) => { if (!ok) throw new Error(label); };
  let count=0; const eq=(a,b,label)=>{check(a===b,label);count++;};
  const fail=(f,code)=>{let error;try{f()}catch(e){error=e.message}eq(error,code,code)};
  const obj=(id,domain=1,write=true)=>({id,domain,write,alive:true,drops:0,generation:1});
  const loan=(o,write=false,owned=false)=>({o,write,owned,generation:o.generation});
  const valid=(v,domain)=>v.o.alive&&v.o.domain===domain&&v.generation===v.o.generation;
  const enter=(v,maySet=false,write=false,domain=1)=>{
    if(!valid(v,domain)||(write&&(!v.write||!v.o.write)))throw Error("authority");
    return {current:v,maySet,write,domain,liveReborrow:0,version:0,materialized:0,closed:false};
  };
  const release=v=>{if(v.owned){if(!v.o.alive||v.o.drops)throw Error("double drop");v.o.drops++;v.o.alive=false;}};
  const set=(b,operator,rhs)=>{
    if(operator!=="set")throw Error("syntax");
    if(b.closed||!b.maySet)throw Error("fixed");
    if(b.liveReborrow)throw Error("live reborrow");
    const next=rhs();
    if(!valid(next,b.domain)||(b.write&&(!next.write||!next.o.write)))throw Error("authority");
    if(b.current.owned&&next.o===b.current.o)throw Error("owned self alias");
    release(b.current);b.current=next;b.version++;
    // No materialized reference cell is required for this symbolic SSA profile.
  };
  const close=b=>{if(b.closed)throw Error("closed");if(b.liveReborrow)throw Error("live reborrow");release(b.current);b.closed=true;};
  const alice=obj("alice"),bob=obj("bob"),input=loan(alice);
  const fixed=enter(input);const unused=enter(input,true);
  eq(fixed.current,input,"ordinary incoming SSA value");
  eq(unused.current,input,"unused rebind incoming SSA value");
  eq(unused.version,0,"no eager local definition");
  eq(unused.materialized,0,"no eager materialization");
  fail(()=>set(fixed,"set",()=>loan(bob)),"fixed");
  fail(()=>set(unused,"bare",()=>loan(bob)),"syntax");
  fail(()=>set(unused,"rebind",()=>loan(bob)),"syntax");
  let calls=0;for(const change of [false,true]){
    const b=enter(input,true);
    if(change)set(b,"set",()=>{calls++;return loan(bob)});
    eq(b.current.o,change?bob:alice,"branch current");
    eq(input.o,alice,"caller identity");
    eq(b.version,change?1:0,"conditional SSA version");
    eq(b.materialized,0,"no model cell");
    close(b);
  }
  eq(calls,1,"RHS only on taken arm");
  const b=enter(input,true);
  fail(()=>set(b,"set",()=>{calls++;throw Error("RHS")}),"RHS");
  eq(calls,2,"failed RHS once");
  eq(b.current,input,"old binding survives RHS failure");
  eq(b.version,0,"failed RHS no commit");
  b.liveReborrow=1;fail(()=>set(b,"set",()=>loan(bob)),"live reborrow");b.liveReborrow=0;
  fail(()=>set(b,"set",()=>loan(obj("foreign",2))),"authority");
  const stale=obj("stale");const staleLoan=loan(stale);stale.generation++;
  fail(()=>set(b,"set",()=>staleLoan),"authority");
  const one=obj("owned-1"),two=obj("owned-2");
  set(b,"set",()=>loan(one,false,true));eq(alice.drops,0,"caller survives");
  fail(()=>set(b,"set",()=>loan(one)),"owned self alias");
  eq(one.drops,0,"failed replacement preserves owned object");
  set(b,"set",()=>loan(two,false,true));eq(one.drops,1,"old owned drop once");
  close(b);eq(two.drops,1,"final owned drop once");fail(()=>close(b),"closed");
  eq(alice.drops,0,"no incoming drop");eq(bob.drops,0,"no borrowed replacement drop");
  const writable=enter(loan(alice,true),true,true);
  fail(()=>set(writable,"set",()=>loan(obj("readonly",1,false))),"authority");
  eq(writable.current.o,alice,"authority failure no commit");
  close(writable);close(fixed);close(unused);eq(alice.alive,true,"caller remains live");
  return count;
}
console.log(`HOST_ONLY: ${parameterSetModelChecks()} parameter-set checks passed`);
