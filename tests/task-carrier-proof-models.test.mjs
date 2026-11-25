import test from "node:test";
import assert from "node:assert/strict";
import {DOMAINS,CarrierBudgetModel,deriveSendSync,ScopedLoanModel,ActorStateRwModel}
  from "../src/task-carrier-proof-models.mjs";

const SCALAR={kind:"scalar",name:"int"};
const CELL={kind:"cell",value:SCALAR};
const ARC={kind:"arc",value:SCALAR};
const RC={kind:"rc",value:SCALAR};
const place=(over={})=>({domain:"PROCESS",owner:"root",allocation:1,
  generation:1,unique:true,path:[],...over});
const field=(name,proven=true)=>({kind:"field",name,proven});
const range=(from,to,proven=true)=>({kind:"range",from,to,proven});
const claim=(p,mode="WRITE",type=SCALAR)=>({place:p,mode,type});

test("five domain minima are guaranteed at physical cap five",()=>{
  const m=new CarrierBudgetModel(5);
  const issued=DOMAINS.map(d=>m.acquire(d));
  assert.equal(issued.length,5);
  assert.equal(issued.every(Boolean),true);
  assert.equal(m.acquire("CONTROL"),null);
  assert.equal(m.inspect().total,5);
  issued.forEach(t=>{m.enter(t);m.exit(t);});
  m.seal();
  assert.equal(m.finished(),true);
});
test("above-minimum borrowing cannot steal a protected reserve",()=>{
  for(const cap of [5,6,7,9,16,64,256]){
    const m=new CarrierBudgetModel(cap),extra=[];
    let t;
    while((t=m.acquire("PRIVATE"))!==null)extra.push(t);
    assert.equal(extra.length,cap-4);
    for(const d of DOMAINS.filter(x=>x!=="PRIVATE"))
      assert.ok(m.acquire(d));
    assert.equal(m.inspect().total,cap);
  }
});
test("work conserving after reserved workers are alive",()=>{
  const m=new CarrierBudgetModel(12);
  for(const d of DOMAINS){
    const t=m.acquire(d);
    assert.ok(t);
    m.enter(t);
  }
  const extras=Array.from({length:7},()=>m.acquire("CONTROL"));
  assert.ok(extras.every(Boolean));
  assert.equal(m.acquire("PRIVATE"),null);
  extras.forEach(t=>{m.failStartup(t);});
  assert.equal(m.inspect().total,5);
});
test("startup is logical reservation, not published usable carrier",()=>{
  const m=new CarrierBudgetModel(5);
  const t=m.acquire("CONTROL");
  assert.equal(m.inspect().pendingStartup,1);
  assert.equal(m.inspect().entered,0);
  m.enter(t);
  assert.equal(m.inspect().entered,1);
  assert.throws(()=>m.enter(t),/entered twice/);
  assert.throws(()=>m.failStartup(t),/physically exit/);
  m.exit(t);
  assert.throws(()=>m.exit(t),/stale/);
});
test("failed ThreadFactory/startup returns permit exactly once",()=>{
  const m=new CarrierBudgetModel(5),t=m.acquire("CONTROL");
  m.failStartup(t);
  assert.equal(m.inspect().total,0);
  assert.ok(m.acquire("CONTROL"));
  assert.throws(()=>m.failStartup(t),/stale/);
});
test("shutdown seal denies worker admission and publication",()=>{
  const m=new CarrierBudgetModel(5),t=m.acquire("CONTROL");
  m.seal();
  assert.equal(m.finished(),false);
  assert.throws(()=>m.acquire("CONTROL"),/closed/);
  assert.throws(()=>m.enter(t),/after shutdown/);
  m.failStartup(t);
  assert.equal(m.finished(),true);
});
test("foreign tickets cannot release or publish capacity",()=>{
  const a=new CarrierBudgetModel(5),b=new CarrierBudgetModel(5);
  const ticket=a.acquire("PRIVATE");
  assert.throws(()=>b.enter(ticket),/foreign/);
  assert.throws(()=>b.failStartup(ticket),/foreign/);
  assert.equal(a.inspect().total,1);
});
test("carrier budget rejects invalid cap/domains",()=>{
  for(const cap of [0,4,257,5.5,NaN]) assert.throws(()=>new CarrierBudgetModel(cap),/cap/);
  const b=new CarrierBudgetModel(5);
  assert.throws(()=>b.acquire("IO_REACTOR"),/unknown/);
});
test("seeded capacity churn preserves total and protected minima",()=>{
  let state=113,rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(const cap of [5,6,8,13,31,256]){
    const m=new CarrierBudgetModel(cap),live=[];
    for(let i=0;i<10000;i++){
      const d=DOMAINS[rand()%5];
      if((rand()&3)!==0){
        const t=m.acquire(d);
        if(t){m.enter(t);live.push(t);}
      }else if(live.length){
        const index=rand()%live.length;
        m.exit(live.splice(index,1)[0]);
      }
      const s=m.inspect();
      assert.ok(s.total<=cap && s.total>=0);
      assert.ok(s.total+DOMAINS.reduce((sum,x)=>sum+Math.max(0,1-s.counts[x]),0)<=cap);
    }
    live.forEach(t=>m.exit(t));m.seal();assert.equal(m.finished(),true);
  }
});

test("primitive send/sync and structural tuple/record derivation",()=>{
  assert.deepEqual(deriveSendSync(SCALAR),{send:true,sync:true});
  assert.deepEqual(deriveSendSync({kind:"tuple",items:[SCALAR,ARC]}),
    {send:true,sync:true});
  assert.deepEqual(deriveSendSync({kind:"record",items:[SCALAR,CELL]}),
    {send:true,sync:false});
});
test("Arc requires T Send AND Sync",()=>{
  assert.deepEqual(deriveSendSync({kind:"arc",value:CELL}),
    {send:false,sync:false});
  assert.deepEqual(deriveSendSync(ARC),{send:true,sync:true});
});
test("Mutex<T> only needs T Send for Send+Sync",()=>{
  assert.deepEqual(deriveSendSync({kind:"mutex",value:CELL}),
    {send:true,sync:true});
});
test("RwLock<T> Send iff T Send, Sync iff Send+Sync",()=>{
  assert.deepEqual(deriveSendSync({kind:"rwlock",value:CELL}),
    {send:true,sync:false});
});
test("Cell, RefCell are movable but not Sync; Rc and FFI fail closed",()=>{
  for(const k of ["cell","refcell"])
    assert.deepEqual(deriveSendSync({kind:k,value:SCALAR}),
      {send:true,sync:false});
  assert.deepEqual(deriveSendSync(RC),{send:false,sync:false});
  assert.deepEqual(deriveSendSync({kind:"ffi"}),{send:false,sync:false});
});
test("shared borrow may Send iff referent Sync; mutable borrow conservative",()=>{
  assert.deepEqual(deriveSendSync({kind:"borrow",mutable:false,value:CELL}),
    {send:false,sync:false});
  assert.deepEqual(deriveSendSync({kind:"borrow",mutable:false,value:SCALAR}),
    {send:true,sync:true});
  assert.deepEqual(deriveSendSync({kind:"borrow",mutable:true,value:SCALAR}),
    {send:false,sync:false});
});
test("unknown nominal, false traits, and recursive object descriptors fail closed",()=>{
  assert.throws(()=>deriveSendSync({kind:"unsafe_ffi"}),/unknown trait/);
  assert.throws(()=>deriveSendSync({kind:"scalar",name:"Ptr"}),/non-core/);
  const cycle={kind:"option"};cycle.value=cycle;
  assert.throws(()=>deriveSendSync(cycle),/recursive/);
});
test("no guest-supplied unsafe Send override or hidden descriptor fields",()=>{
  assert.throws(()=>deriveSendSync({kind:"scalar",name:"int",send:true}),/non-core|fields/);
  assert.throws(()=>deriveSendSync({kind:"arc",value:SCALAR,unsafeSync:true}),/fields/);
});
test("large recursive type declarations and excess compound width denied",()=>{
  let value=SCALAR;
  for(let n=0;n<50;n++)value={kind:"option",value};
  assert.throws(()=>deriveSendSync(value),/budget/);
  assert.throws(()=>deriveSendSync({kind:"tuple",items:Array(65).fill(SCALAR)}),/width/);
});

test("loan readers coexist but writers conflict",()=>{
  const m=new ScopedLoanModel(),p=place();
  const a=m.admit([claim(p,"READ")]),b=m.admit([claim(p,"READ")]);
  assert.equal(m.inspect().active,2);
  assert.equal(m.parentMayAccess(claim(p,"WRITE")),false);
  assert.throws(()=>m.admit([claim(p,"WRITE")]),/overlapping/);
  m.quiescent(a);m.quiescent(b);
  const writer=m.admit([claim(p,"WRITE")]);m.quiescent(writer);m.finish();
});
test("disjoint proven fields and nonoverlapping ranges write concurrently",()=>{
  const m=new ScopedLoanModel(),p=place();
  const a=m.admit([claim({...p,path:[field("position")]},"WRITE")]);
  const b=m.admit([claim({...p,path:[field("velocity")]},"WRITE")]);
  assert.equal(m.inspect().active,2);
  assert.equal(m.parentMayAccess(claim({...p,path:[field("position")]},"READ")),false);
  m.quiescent(a);m.quiescent(b);m.finish();
});
test("whole field and nested range conservatively overlap",()=>{
  const m=new ScopedLoanModel(),p=place();
  m.admit([claim({...p,path:[field("position")]},"WRITE")]);
  assert.throws(()=>m.admit([claim({...p,path:[field("position"),range(0,10)]},"READ")]),/overlapping/);
});
test("distinct disjoint ranges coexist, overlapping ranges conflict",()=>{
  const m=new ScopedLoanModel(),p=place(),base=[field("positions")];
  const a=m.admit([claim({...p,path:[...base,range(0,10)]})]);
  const b=m.admit([claim({...p,path:[...base,range(10,20)]})]);
  assert.throws(()=>m.admit([claim({...p,path:[...base,range(9,11)]})]),/overlapping/);
  m.cancel(a);assert.equal(m.cancellationRequested(a),true);
  assert.throws(()=>m.admit([claim({...p,path:[...base,range(5,8)]})]),/overlapping/);
  m.quiescent(a);m.quiescent(b);m.finish();
});
test("unproven intermediate layout cannot launder disjoint child fields",()=>{
  const m=new ScopedLoanModel(),p=place(),ancestor=[field("opaque",false)];
  m.admit([claim({...p,path:[...ancestor,field("x")]})]);
  assert.throws(()=>m.admit([claim({...p,path:[...ancestor,field("y")]})]),/overlapping/);
});
test("READ requires Sync; WRITE requires Send and proof rejects after prior reservations",()=>{
  const m=new ScopedLoanModel(),p=place();
  assert.throws(()=>m.admit([claim(p,"READ",CELL)]),/Send\/Sync/);
  assert.equal(m.inspect().active,0);
  const t=m.admit([claim(p,"WRITE",CELL)]);
  assert.equal(m.inspect().active,1);m.quiescent(t);
});
test("mixed trust domains/actor incarnations cannot share Task loan scope",()=>{
  const m=new ScopedLoanModel();
  const a=place({domain:"ACTOR_PRIVATE",owner:"actorA:epoch1"});
  const b=place({domain:"ACTOR_PRIVATE",owner:"actorB:epoch1"});
  const t=m.admit([claim(a,"READ")]);
  assert.throws(()=>m.admit([claim(b,"READ")]),/mixed Task owner/);
  m.quiescent(t);
  assert.throws(()=>m.admit([claim(b,"READ")]),/mixed Task owner/);
});
test("unknown allocation uniqueness cannot prove separate roots disjoint",()=>{
  const m=new ScopedLoanModel();
  m.admit([claim(place({allocation:3,unique:false}))]);
  assert.throws(()=>m.admit([claim(place({allocation:4,unique:true}))]),/overlapping/);
});
test("mixed generation admissions are all-or-nothing, no leaked child count",()=>{
  const m=new ScopedLoanModel();
  assert.throws(()=>m.admit([claim(place()),
    claim(place({generation:2}),"READ")]),/stale allocation/);
  assert.equal(m.inspect().active,0);
  assert.equal(m.inspect().recordedAllocations,0);
  assert.ok(m.admit([claim(place())]));
});
test("quiescence is the only release; cancellation and finish do not release",()=>{
  const m=new ScopedLoanModel(),p=place(),t=m.admit([claim(p)]);
  m.cancel(t);
  assert.throws(()=>m.finish(),/quiescence/);
  assert.equal(m.parentMayAccess(claim(p,"READ")),false);
  m.quiescent(t);
  m.finish();assert.equal(m.inspect().sealed,true);
  assert.throws(()=>m.admit([]),/sealed/);
});
test("foreign/stale loan tickets cannot retire unrelated scopes",()=>{
  const a=new ScopedLoanModel(),b=new ScopedLoanModel(),t=a.admit([claim(place())]);
  assert.throws(()=>b.quiescent(t),/foreign\/stale/);
  a.quiescent(t);assert.throws(()=>a.quiescent(t),/foreign\/stale/);
});
test("layout mutation blocks all aliasing children and fences old generation",()=>{
  const m=new ScopedLoanModel(),p=place(),t=m.admit([claim(p,"READ")]);
  assert.throws(()=>m.structuralBarrier(p,2),/layout mutation/);
  m.quiescent(t);m.structuralBarrier(p,2);
  assert.equal(m.parentMayAccess(claim(p,"READ")),false);
  assert.equal(m.parentMayAccess(claim(place({generation:2}),"READ")),true);
});
test("invalid projections, overflow and forged capture fields rejected",()=>{
  const m=new ScopedLoanModel();
  assert.throws(()=>m.admit([claim(place({path:[range(3,3)]}))]),/range layout/);
  assert.throws(()=>m.admit([claim(place({path:[field("a",true),{kind:"pointer"}]}))]),/projection/);
  assert.throws(()=>m.admit([{...claim(place()),owner:"foreign"}]),/fields/);
});
test("parent has no ambient permission to untracked allocation",()=>{
  const m=new ScopedLoanModel(),p=place(),t=m.admit([claim(p,"READ")]);
  assert.equal(m.parentMayAccess(claim(place({allocation:999}),"READ")),false);
  m.quiescent(t);assert.equal(m.parentMayAccess(claim(p,"WRITE")),true);
});

test("actor max=1 serializes even verified READ/READ",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:1,maxThreads:1});
  const a=m.request("READ","t1"),b=m.request("READ","t2");
  assert.equal(m.status(a),"ACTIVE");
  assert.equal(m.status(b),"QUEUED");
  m.release(a);assert.equal(m.status(b),"ACTIVE");
});
test("actor max=3 admits reader cohorts but never writers in parallel",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:1,maxThreads:3});
  const rs=[1,2,3].map(i=>m.request("READ","r"+i));
  assert.equal(m.inspect().active,3);
  const w=m.request("WRITE","w"),late=m.request("READ","r4");
  assert.equal(m.status(w),"QUEUED");assert.equal(m.status(late),"QUEUED");
  m.release(rs[0]);assert.equal(m.status(late),"QUEUED");
  m.release(rs[1]);m.release(rs[2]);
  assert.equal(m.status(w),"ACTIVE");
  assert.equal(m.inspect().writers,1);
  m.release(w);assert.equal(m.status(late),"ACTIVE");
});
test("writer-aware FIFO queue cannot be bypassed by later readers",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:1,maxThreads:3});
  const r=m.request("READ","r"),w=m.request("WRITE","w"),r2=m.request("READ","r2");
  assert.equal(m.status(r2),"QUEUED");
  m.release(r);assert.equal(m.status(w),"ACTIVE");
  assert.equal(m.status(r2),"QUEUED");
});
test("STOP seals queue but active callbacks retain loans until physical exit",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:1,maxThreads:3});
  const r=m.request("READ","r"),w=m.request("WRITE","w");
  m.stop();
  assert.equal(m.status(w),"STALE");
  assert.equal(m.finished(),false);
  assert.throws(()=>m.request("READ","after"),/stale\/stopped/);
  m.release(r);assert.equal(m.finished(),true);
});
test("cancel only queued actor grants, never live resource loans",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:1});
  const a=m.request("READ","a"),b=m.request("WRITE","b");
  assert.throws(()=>m.cancelQueued(a),/cannot cancel/);
  m.cancelQueued(b);assert.equal(m.status(b),"STALE");
  m.release(a);assert.equal(m.inspect().active,0);
});
test("actor state loan cannot be retained across await/select",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:1});
  const a=m.request("READ","a");
  assert.throws(()=>m.suspend(a),/cannot cross await\/select\/IO/);
  assert.equal(m.status(a),"ACTIVE");m.release(a);
});
test("stale incarnation and duplicate continuation refuse admission",()=>{
  const m=new ActorStateRwModel({actor:"actorA",epoch:13});
  assert.throws(()=>m.request("READ","a",12),/stale\/stopped/);
  const a=m.request("READ","a");
  assert.throws(()=>m.request("READ","a"),/duplicate continuation/);
  m.release(a);assert.equal(m.status(a),"STALE");
});
test("actor permit cannot be forged by another actor",()=>{
  const a=new ActorStateRwModel({actor:"a",epoch:1});
  const b=new ActorStateRwModel({actor:"b",epoch:1});
  const permit=a.request("WRITE","t");
  assert.throws(()=>b.release(permit),/only physically retiring/);
  assert.equal(a.inspect().active,1);
});
test("actor capacity and malformed params fail closed",()=>{
  assert.throws(()=>new ActorStateRwModel({actor:"a",epoch:1,maxThreads:2}),/capacity/);
  assert.throws(()=>new ActorStateRwModel({actor:"",epoch:1}),/incarnation/);
  const m=new ActorStateRwModel({actor:"a",epoch:1,maxThreads:3});
  assert.throws(()=>m.request("CRITICAL_WRITE","t"),/request/);
});

test("shared borrow cannot be passed off as mutable Task write authority",()=>{
  const m=new ScopedLoanModel();
  const borrowed={kind:"borrow",mutable:false,value:SCALAR};
  assert.throws(()=>m.admit([claim(place(),"WRITE",borrowed)]),/not mutable Task write/);
  assert.equal(m.inspect().active,0);
  const reader=m.admit([claim(place(),"READ",borrowed)]);
  assert.equal(m.inspect().active,1);m.quiescent(reader);m.finish();
});
test("unrecognized parent access mode does not become an implicit write permission",()=>{
  const m=new ScopedLoanModel(),p=place(),t=m.admit([claim(p,"READ")]);
  assert.throws(()=>m.parentMayAccess(claim(p,"UNKNOWN")),/parent access mode/);
  m.quiescent(t);
});
test("all-or-none claim admission across disjoint components",()=>{
  const m=new ScopedLoanModel(),p=place();
  const t=m.admit([claim({...p,path:[field("position")]},"WRITE")]);
  assert.throws(()=>m.admit([
    claim({...p,path:[field("velocity")]},"WRITE"),
    claim({...p,path:[field("position")]},"WRITE")
  ]),/overlapping/);
  assert.equal(m.inspect().active,1);
  const u=m.admit([claim({...p,path:[field("velocity")]},"WRITE")]);
  assert.equal(m.inspect().active,2);m.quiescent(t);m.quiescent(u);m.finish();
});

test("void is not a runtime transferable scalar and cannot derive Send or Sync",()=>{
  for(const name of ["void","Void","unknown"]){
    assert.throws(()=>deriveSendSync({kind:"scalar",name}),/non-core scalar/);
  }
  assert.deepEqual(deriveSendSync({kind:"scalar",name:"int"}),
    {send:true,sync:true});
});
