import test from "node:test";
import assert from "node:assert/strict";
import {HotUpgradeGate,IpcReceiptLedger,StageDoneGate,WireMemoryLedger,EdgeCreditGate}
  from "../src/actor-upgrade-ipc-reference.mjs";
const code1="1".repeat(64),code2="2".repeat(64),ABI="a".repeat(64);
const STATE="b".repeat(64),SHARED="c".repeat(64),POLICY="d".repeat(64);
const initial=()=>({actor:"actorA",kind:"SHARED",code:code1,
  abi:ABI,state:STATE,shared:SHARED,policy:POLICY});
const candidate=(over={})=>({kind:"SHARED",code:code2,
  abi:ABI,state:STATE,shared:SHARED,policy:POLICY,...over});

test("code-only upgrade advances route+code while keeping actor incarnation",()=>{
  const gate=new HotUpgradeGate(initial());
  const before=gate.identity();
  gate.freeze();const stage=gate.stage(candidate());
  const after=gate.promote(stage,before.routeEpoch);
  assert.equal(after.actor,before.actor);
  assert.equal(after.incarnation,before.incarnation);
  assert.equal(after.routeEpoch,2);
  assert.equal(after.codeGeneration,2);
  assert.equal(after.code,code2);
});
test("await/FFI/persistent callback code pins prevent early code replacement",()=>{
  for(const kind of ["DATA","AWAIT","FFI","TIMER","CALLBACK","UNWIND"]){
    const gate=new HotUpgradeGate(initial());
    const pin=gate.acquire("DATA");gate.transfer(pin,kind);
    assert.equal(gate.pinInfo(pin).code,code1);
    gate.freeze();const ticket=gate.stage(candidate());
    assert.throws(()=>gate.promote(ticket,1),/still pinned/);
    assert.throws(()=>gate.acquire("DATA"),/frozen/);
    gate.release(pin);
    assert.equal(gate.promote(ticket,1).code,code2);
  }
});
test("code-only ABI, state schema, shared-cell, caps and placement drift fail",()=>{
  for(const bad of [{abi:"3".repeat(64)},{state:"3".repeat(64)},
    {shared:"3".repeat(64)},{policy:"3".repeat(64)},{kind:"UNTRUSTED"}]){
    const gate=new HotUpgradeGate(initial());gate.freeze();
    assert.throws(()=>gate.stage(candidate(bad)),/drift|mismatch/);
    assert.equal(gate.inspect().staged,false);
  }
});
test("duplicate same code and malformed digest reject",()=>{
  const gate=new HotUpgradeGate(initial());gate.freeze();
  assert.throws(()=>gate.stage(candidate({code:code1})),/duplicate/);
  assert.throws(()=>gate.stage(candidate({code:"unsafe"})),/code/);
});
test("rollback resumes original route without changing actor epochs",()=>{
  const gate=new HotUpgradeGate(initial());
  gate.freeze();const stage=gate.stage(candidate());
  gate.abort(stage);
  assert.equal(gate.inspect().routeEpoch,1);
  assert.equal(gate.acquire("DATA")!==null,true);
  assert.throws(()=>gate.promote(stage,1),/stale/);
});
test("concurrent CAS stale expected epoch and duplicate publication reject",()=>{
  const gate=new HotUpgradeGate(initial());gate.freeze();
  const staged=gate.stage(candidate());
  assert.throws(()=>gate.promote(staged,2),/CAS/);
  gate.promote(staged,1);
  assert.throws(()=>gate.promote(staged,1),/stale/);
});
test("crash restart advances incarnation independently of code generation",()=>{
  const gate=new HotUpgradeGate(initial());
  gate.freeze();const next=gate.restart();
  assert.equal(next.incarnation,2);
  assert.equal(next.routeEpoch,2);
  assert.equal(next.codeGeneration,1);
});
test("restart/close denied while suspended physical lease is active",()=>{
  const gate=new HotUpgradeGate(initial()),ticket=gate.acquire("FFI");
  gate.freeze();
  assert.throws(()=>gate.restart(),/physical quiescence/);
  assert.throws(()=>gate.close(),/cleanup/);
  gate.release(ticket);gate.restart();gate.close();
  assert.equal(gate.inspect().closed,true);
});
test("foreign or stale code pin and promotion token rejected",()=>{
  const a=new HotUpgradeGate(initial()),b=new HotUpgradeGate(initial());
  const token=a.acquire("DATA");
  assert.throws(()=>b.release(token),/stale/);
  a.release(token);assert.throws(()=>a.release(token),/stale/);
  a.freeze();const stage=a.stage(candidate());
  b.freeze();b.stage(candidate());
  assert.throws(()=>b.promote(stage,1),/foreign|stale/);
});
test("bounded pin admission rejects resource exhaustion",()=>{
  const gate=new HotUpgradeGate(initial()),leases=[];
  for(let i=0;i<4096;i++)leases.push(gate.acquire("DATA"));
  assert.throws(()=>gate.acquire("DATA"),/budget/);
  for(const lease of leases)gate.release(lease);
  assert.equal(gate.inspect().pins,0);
});

test("proxy admission does not imply worker received or done",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit();
  assert.equal(ipc.state(seq),"PROXY_ADMITTED");
  const r=ipc.dispatch(seq);
  assert.equal(ipc.state(seq),"DISPATCHED");
  assert.equal(ipc.inspect().transport,1);
  assert.equal(ipc.received(r),true);
  assert.equal(ipc.inspect().transport,0);
  assert.equal(ipc.state(seq),"WORKER_RECEIVED");
  assert.equal(ipc.terminal(r,"DONE"),true);
  assert.equal(ipc.state(seq),"RETIRED");
});
test("worker DONE before received is not authenticated completion",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit(),r=ipc.dispatch(seq);
  assert.equal(ipc.terminal(r,"DONE"),false);
  assert.equal(ipc.state(seq),"DISPATCHED");
});
test("duplicate ACK and DONE cannot affect credits or another message",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit(),r=ipc.dispatch(seq);
  assert.equal(ipc.received(r),true);
  assert.equal(ipc.received(r),false);
  assert.equal(ipc.terminal(r,"DONE"),true);
  assert.equal(ipc.terminal(r,"DONE"),false);
  assert.equal(ipc.inspect().transport,0);
});
test("forged session, incarnation, route, logical and frame sequence reject",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit(),r=ipc.dispatch(seq);
  for(const change of [{session:"foreign"},{incarnation:2},{routeEpoch:2},
    {logicalSequence:999},{frameSequence:999},{actor:"actorB"}]){
    assert.equal(ipc.received({...r,...change}),false);
  }
  assert.equal(ipc.received(r),true);
});
test("untrusted extra receipt field cannot smuggle identity",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const r=ipc.dispatch(ipc.admit());
  assert.throws(()=>ipc.received({...r,authority:"trusted"}),/shape/);
});
test("crash after worker receipt becomes indeterminate, never replayed",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit(),r=ipc.dispatch(seq);ipc.received(r);
  assert.equal(ipc.loseSession("s2",{restart:true}),1);
  assert.equal(ipc.state(seq),"RETIRED");
  assert.equal(ipc.terminal(r,"DONE"),false);
  assert.equal(ipc.inspect().incarnation,2);
  assert.equal(ipc.inspect().transport,0);
  assert.throws(()=>ipc.dispatch(seq),/double\/foreign/);
});
test("lost worker acknowledgement after dispatch is also ambiguous",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit(),r=ipc.dispatch(seq);
  assert.equal(ipc.loseSession("s2",{restart:true}),1);
  assert.equal(ipc.received(r),false);
});
test("admitted, never dispatched messages keep stable sequence across restart",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const seq=ipc.admit();
  assert.equal(ipc.loseSession("s2",{restart:true}),0);
  assert.equal(ipc.state(seq),"PROXY_ADMITTED");
  const r=ipc.dispatch(seq);
  assert.equal(r.logicalSequence,seq);
  assert.equal(r.incarnation,2);
});
test("code-only route upgrade retains logical sequence and incarnation",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const old=ipc.admit();ipc.codeOnlyUpgrade();
  const r=ipc.dispatch(old),next=ipc.admit();
  assert.equal(ipc.inspect().incarnation,1);
  assert.equal(ipc.inspect().routeEpoch,2);
  assert.equal(r.logicalSequence,old);
  assert.equal(next,old+1);
});
test("code-only swap forbidden while transport frame is in flight",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const r=ipc.dispatch(ipc.admit());
  assert.throws(()=>ipc.codeOnlyUpgrade(),/unretired/);
  ipc.received(r);assert.throws(()=>ipc.codeOnlyUpgrade(),/unretired/);
  ipc.terminal(r,"FAILED");ipc.codeOnlyUpgrade();
  assert.equal(ipc.inspect().routeEpoch,2);
});
test("separate local proxy capacity and transport credits are enforced",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1",
    maxPending:2,maxTransport:1});
  const a=ipc.admit(),b=ipc.admit();
  assert.equal(ipc.admit(),null);
  const ra=ipc.dispatch(a);
  assert.equal(ipc.dispatch(b),null);
  ipc.received(ra);
  assert.equal(ipc.inspect().pending,2);
  assert.ok(ipc.dispatch(b));
});
test("IPC terminal kind malformed cannot release state",()=>{
  const ipc=new IpcReceiptLedger({actor:"actorA",session:"s1"});
  const r=ipc.dispatch(ipc.admit());ipc.received(r);
  assert.throws(()=>ipc.terminal(r,"INDETERMINATE"),/terminal kind/);
  assert.equal(ipc.inspect().pending,1);
});

test("dispatcher rejection never settles get_done ahead of sibling finalization",()=>{
  const gate=new StageDoneGate(3);
  gate.failed(1,"STAGE_FAILED");gate.rejectDispatch();
  gate.finalized(1);
  assert.equal(gate.inspect().state,"PENDING");
  assert.equal(gate.inspect().dispatchRejected,true);
  gate.finalized(2);assert.equal(gate.inspect().state,"PENDING");
  gate.finalized(3);assert.equal(gate.inspect().state,"FAILED");
});
test("all stages finalized but route frames outstanding means PENDING",()=>{
  const gate=new StageDoneGate(1);
  gate.addFrame();gate.finalized(1);
  assert.equal(gate.inspect().state,"PENDING");
  gate.retireFrame();assert.equal(gate.inspect().state,"DONE");
});
test("first failure is terminal only once stage/frame retirement completes",()=>{
  const gate=new StageDoneGate(2);
  gate.addFrame();gate.failed(1,"PANIC");gate.finalized(1);
  gate.finalized(2);
  assert.equal(gate.inspect().state,"PENDING");
  gate.retireFrame();assert.equal(gate.inspect().state,"FAILED");
});
test("double stage retirement and route-frame credit underflow reject",()=>{
  const gate=new StageDoneGate(1);
  assert.throws(()=>gate.retireFrame(),/double/);
  gate.finalized(1);
  assert.throws(()=>gate.finalized(1),/double/);
});
test("dispatcher rejection requires a real failed stage",()=>{
  assert.throws(()=>new StageDoneGate(1).rejectDispatch(),/without failed/);
});

test("binary scratch charge must precede retained-frame accounting",()=>{
  const ledger=new WireMemoryLedger({scratchCap:100,retainedCap:120});
  const t=ledger.reserve(60);
  assert.equal(ledger.inspect().scratch,60);
  assert.equal(ledger.commit(t,90),t);
  assert.equal(ledger.inspect().scratch,0);
  assert.equal(ledger.inspect().retained,90);
  ledger.dequeue(t);
  assert.equal(ledger.inspect().retained,0);
});
test("concurrent scratch reservations cannot oversubscribe total budget",()=>{
  const ledger=new WireMemoryLedger({scratchCap:100,retainedCap:100});
  const a=ledger.reserve(70);
  assert.equal(ledger.reserve(31),null);
  const b=ledger.reserve(30);
  assert.ok(b);
  assert.equal(ledger.inspect().scratch,100);
  ledger.abort(a);ledger.abort(b);
  assert.equal(ledger.inspect().scratch,0);
});
test("mailbox fills during encoding without releasing scratch too early",()=>{
  const ledger=new WireMemoryLedger({scratchCap:100,retainedCap:100});
  const a=ledger.reserve(50),b=ledger.reserve(50);
  ledger.commit(a,70);
  assert.equal(ledger.commit(b,40),null);
  assert.equal(ledger.inspect().scratch,50);
  ledger.dequeue(a);
  ledger.commit(b,40);
  assert.equal(ledger.inspect().scratch,0);
  assert.equal(ledger.inspect().retained,40);
});
test("encode failure and cancellation release scratch exactly once",()=>{
  const ledger=new WireMemoryLedger({scratchCap:50,retainedCap:70});
  const a=ledger.reserve(40);
  ledger.abort(a);
  assert.throws(()=>ledger.abort(a),/mismatch/);
  assert.equal(ledger.inspect().scratch,0);
});
test("frame dequeue, stop and retention cleanup are exact-once",()=>{
  const ledger=new WireMemoryLedger({scratchCap:70,retainedCap:100});
  const t=ledger.reserve(50);ledger.commit(t,60);
  assert.throws(()=>ledger.abort(t),/mismatch/);
  ledger.dequeue(t);
  assert.throws(()=>ledger.dequeue(t),/duplicate/);
  assert.equal(ledger.inspect().retained,0);
});
test("resource byte charges must be positive safe integers",()=>{
  const ledger=new WireMemoryLedger({scratchCap:100,retainedCap:200});
  for(const bad of [0,-1,0.5,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>ledger.reserve(bad),/charge/);
  }
});

test("edge credit commits only capacity-one first producer",()=>{
  const edge=new EdgeCreditGate({capacity:1,maxWaiters:2});
  const a=edge.request(),b=edge.request();
  assert.equal(edge.status(a),"COMMITTED");
  assert.equal(edge.status(b),"WAITING");
  assert.equal(edge.inspect().queued,1);
  assert.equal(edge.inspect().waiting,1);
});
test("edge cancellation before commit returns credit without ghost delivery",()=>{
  const edge=new EdgeCreditGate({capacity:1,maxWaiters:2});
  const a=edge.request(),b=edge.request();
  assert.equal(edge.cancel(b),true);
  assert.equal(edge.status(b),"CANCELLED");
  assert.equal(edge.dequeue(),a);
  assert.equal(edge.inspect().queued,0);
  assert.equal(edge.status(a),"DELIVERED");
});
test("edge cancellation after commit cannot reclaim transferred ownership",()=>{
  const edge=new EdgeCreditGate({capacity:1});
  const a=edge.request();
  assert.equal(edge.cancel(a),false);
  assert.equal(edge.status(a),"COMMITTED");
  assert.equal(edge.dequeue(),a);
});
test("FIFO edge wakeup after capacity releases",()=>{
  const edge=new EdgeCreditGate({capacity:1,maxWaiters:3});
  const a=edge.request(),b=edge.request(),c=edge.request();
  assert.equal(edge.dequeue(),a);
  assert.equal(edge.status(b),"COMMITTED");
  assert.equal(edge.status(c),"WAITING");
  assert.equal(edge.dequeue(),b);
  assert.equal(edge.dequeue(),c);
});
test("bounded edge waiter capacity returns null without allocating",()=>{
  const edge=new EdgeCreditGate({capacity:1,maxWaiters:1});
  edge.request();edge.request();
  assert.equal(edge.request(),null);
  assert.equal(edge.inspect().waiting,1);
});
test("edge STOP cancels only waiters; committed frames stay reserved",()=>{
  const edge=new EdgeCreditGate({capacity:1,maxWaiters:2});
  const a=edge.request(),b=edge.request();
  edge.stop();
  assert.equal(edge.status(a),"COMMITTED");
  assert.equal(edge.status(b),"CANCELLED");
  assert.equal(edge.inspect().queued,1);
  assert.throws(()=>edge.request(),/sealed/);
  edge.retireCommitted(a);
  assert.equal(edge.status(a),"RETIRED");
  assert.equal(edge.inspect().queued,0);
});
test("double retire and queue underflow reject",()=>{
  const edge=new EdgeCreditGate({capacity:1});
  assert.throws(()=>edge.dequeue(),/underflow/);
  const a=edge.request();edge.retireCommitted(a);
  assert.throws(()=>edge.retireCommitted(a),/foreign\/double/);
  assert.throws(()=>edge.dequeue(),/underflow/);
});
test("edge tokens are instance-bound and cannot be forged",()=>{
  const a=new EdgeCreditGate({capacity:1}),b=new EdgeCreditGate({capacity:1});
  const x=a.request(),y=b.request();
  assert.equal(b.status(x),"UNKNOWN");
  assert.throws(()=>b.cancel(x),/foreign/);
  assert.equal(b.status(y),"COMMITTED");
});
test("edge credit saturation and cancellation churn preserves queue bound",()=>{
  let seed=31;const rand=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed;};
  const edge=new EdgeCreditGate({capacity:3,maxWaiters:11}),all=[];
  for(let i=0;i<6000;i++){
    const r=rand()%5;
    if(r<=2){const t=edge.request();if(t)all.push(t);}
    else if(r===3){
      const waiter=all.find(t=>edge.status(t)==="WAITING");
      if(waiter)edge.cancel(waiter);
    }else if(edge.inspect().queued)edge.dequeue();
    const inspect=edge.inspect();
    assert.ok(inspect.queued<=3&&inspect.waiting<=11);
  }
  edge.stop();
  while(edge.inspect().queued)edge.dequeue();
  assert.equal(edge.inspect().waiting,0);
});

test("terminal edge receipts are bounded during long-running pipeline churn",()=>{
  const edge=new EdgeCreditGate({capacity:1,maxWaiters:1});
  for(let i=0;i<2000;i++){
    const t=edge.request();assert.ok(t);
    assert.equal(edge.dequeue(),t);
  }
  const count=edge.inspect();
  assert.equal(count.queued,0);
  assert.equal(count.waiting,0);
  assert.ok(count.tracked<=256);
});
test("physical stage frame admission fails closed at maximum frame budget",()=>{
  const stream=new StageDoneGate(1);
  for(let i=0;i<4096;i++)stream.addFrame();
  assert.equal(stream.inspect().outstandingFrames,4096);
  assert.throws(()=>stream.addFrame(),/budget/);
  for(let i=0;i<4096;i++)stream.retireFrame();
  stream.finalized(1);
  assert.equal(stream.inspect().state,"DONE");
});
