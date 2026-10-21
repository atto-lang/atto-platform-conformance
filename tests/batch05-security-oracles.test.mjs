import test from "node:test";
import assert from "node:assert/strict";
import {
  HierarchicalOutboundQuotaModel, TrustedFdAliasModel,
  TrainingControlModel, transportActorAdmission, projectClosureBindings, receiptOriginDecision,
  IpcPublicationFenceModel
} from "../src/batch05-security-oracles.mjs";

const scope=(kind,over={})=>({kind,id:"host-"+kind,
  ratePerSecond:10,burst:2,bytesPerSecond:10000,byteBurst:10000,
  maxOutstanding:10,...over});
const profiles=over=>["actor","lineage","supervisor","tenant"]
  .map(kind=>scope(kind,over?.[kind]||{}));
const quota=over=>new HierarchicalOutboundQuotaModel(profiles(over));
const accepted=out=>{assert.equal(out.accepted,true);return out.lease;};
const admitted=(q,bytes=10,clock=0n)=>accepted(q.admit(bytes,clock));

test("hierarchical quota issues opaque runtime-owned leases and debits every scope",()=>{
  const q=quota(),lease=admitted(q);
  const s=q.inspect();
  assert.equal(s.outstanding,1);
  for(const layer of s.scopes){
    assert.equal(layer.active,1);
    assert.equal(layer.tokenWhole,1);
  }
  q.finish(lease);
  assert.equal(q.inspect().outstanding,0);
});
test("ten starts per second with burst two rejects immediate third request",()=>{
  const q=quota(),a=admitted(q),b=admitted(q);
  assert.deepEqual(q.admit(10,0n),{accepted:false,reason:"RATE"});
  q.finish(a);q.finish(b);
  assert.deepEqual(q.admit(10,0n),{accepted:false,reason:"RATE"});
  assert.ok(q.admit(10,100000000n).accepted);
});
test("published start-token refunds are forbidden after time refill",()=>{
  const q=quota(),a=admitted(q),b=admitted(q);
  assert.equal(q.admit(1,100000000n).accepted,true);
  // At t=100ms only one token refills. Retiring prior slots cannot
  // manufacture additional burst tokens at that same timestamp.
  q.finish(a);q.finish(b);
  assert.deepEqual(q.admit(1,100000000n),{accepted:false,reason:"RATE"});
});
test("repeated cancellation cannot increase start rate",()=>{
  const q=quota();
  for(let i=0;i<2;i++)q.finish(admitted(q,1,0n));
  for(let i=0;i<30;i++)
    assert.equal(q.admit(1,0n).accepted,false);
  assert.equal(q.inspect().outstanding,0);
});
test("eleventh simultaneous HTTP/TCP in-flight request denied",()=>{
  const config={ratePerSecond:1000,burst:100,maxOutstanding:10};
  const q=new HierarchicalOutboundQuotaModel(profiles({
    actor:config,lineage:config,supervisor:config,tenant:config
  }));
  const leases=Array.from({length:10},()=>admitted(q));
  assert.deepEqual(q.admit(1,0n),{accepted:false,reason:"OUTSTANDING"});
  q.finish(leases[0]);assert.equal(q.admit(1,0n).accepted,true);
});
test("lineage and tenant ceilings cannot be bypassed by one actor",()=>{
  const q=quota({
    actor:{ratePerSecond:100,burst:100},
    lineage:{ratePerSecond:10,burst:1},
    supervisor:{ratePerSecond:100,burst:100},
    tenant:{ratePerSecond:100,burst:100}
  });
  assert.ok(q.admit(1,0n).accepted);
  assert.deepEqual(q.admit(1,0n),{accepted:false,reason:"RATE"});
  assert.equal(q.inspect().scopes[0].tokenWhole,99);
});
test("restarting child does not mint new actor or supervisor tokens",()=>{
  const q=quota(),a=admitted(q),b=admitted(q);
  q.restart();
  assert.equal(q.inspect().incarnation,2);
  assert.equal(q.admit(1,0n).accepted,false);
  q.finish(a);q.finish(b);
  assert.equal(q.admit(1,0n).accepted,false);
});
test("cancellation after admission frees pending credit but never burst",()=>{
  const q=quota(),a=admitted(q),b=admitted(q);
  q.finish(a);q.finish(b);
  for(const x of q.inspect().scopes)assert.equal(x.tokenWhole,0);
});
test("byte budget is reserved for serialized cost and never overshoots",()=>{
  const q=quota({tenant:{byteBurst:15,bytesPerSecond:15}});
  const a=admitted(q,10);
  assert.deepEqual(q.admit(10,0n),{accepted:false,reason:"BYTES"});
  assert.equal(q.inspect().outstanding,1);
  q.finish(a);
  assert.deepEqual(q.admit(10,0n),{accepted:false,reason:"BYTES"});
});
test("negative, missing or reversed monotonic time fails closed",()=>{
  const q=quota();
  assert.throws(()=>q.admit(10),/clock/);
  assert.throws(()=>q.admit(10,-1n),/clock/);
  admitted(q,10,500000000n);
  assert.throws(()=>q.admit(10,400000000n),/rollback/);
});
test("preflight rejects huge payload, negative size and token-unsafe inputs",()=>{
  const q=quota();
  for(const size of [0,-1,10000001,1.1,NaN])
    assert.throws(()=>q.admit(size,0n),/preflight/);
  assert.equal(q.inspect().outstanding,0);
});
test("duplicate/foreign quota credit retirement never alters counters",()=>{
  const a=quota(),b=quota(),ticket=admitted(a);
  assert.throws(()=>b.finish(ticket),/foreign/);
  a.finish(ticket);assert.throws(()=>a.finish(ticket),/duplicate/);
  assert.equal(a.inspect().outstanding,0);
});
test("supervisor shutdown seals new egress while physical credits remain live",()=>{
  const q=quota(),lease=admitted(q);
  q.stop();
  assert.throws(()=>q.admit(1,0n),/closed/);
  assert.equal(q.inspect().outstanding,1);
  q.finish(lease);assert.equal(q.inspect().outstanding,0);
});
test("rate and in-flight are independent quota axes",()=>{
  const q=quota({actor:{maxOutstanding:1,ratePerSecond:100,burst:20}});
  const a=admitted(q);
  assert.deepEqual(q.admit(1,0n),{accepted:false,reason:"OUTSTANDING"});
  q.finish(a);
  assert.equal(q.admit(1,0n).accepted,true);
});
test("quota profiles require all stable ancestor levels",()=>{
  assert.throws(()=>new HierarchicalOutboundQuotaModel(profiles().slice(0,3)),/four/);
  assert.throws(()=>new HierarchicalOutboundQuotaModel([scope("actor"),scope("actor"),
    scope("supervisor"),scope("tenant")]),/scope owner/);
});

test("duplicated eventfd aliases reuse canonical open-description identity",()=>{
  const fd=new TrustedFdAliasModel();
  const original=fd.open(5),alias=fd.duplicate(original,7);
  const ticket=fd.watch(original);
  assert.throws(()=>fd.watch(alias),/duplicated/);
  fd.retire(ticket);
  assert.ok(fd.watch(alias));
});
test("unrelated eventfds are distinct despite matching anon_inode metadata",()=>{
  const fd=new TrustedFdAliasModel(),a=fd.open(5),b=fd.open(7);
  fd.watch(a);fd.watch(b);
  assert.equal(fd.inspect().watches,2);
});
test("same live numeric FD cannot mint a second trusted open description",()=>{
  const fd=new TrustedFdAliasModel(),a=fd.open(9);
  assert.throws(()=>fd.open(9),/already live/);
  assert.throws(()=>fd.duplicate(a,9),/already live/);
  const t=fd.watch(a);
  assert.equal(fd.inspect().openHandles,1);
  fd.retire(t);fd.close(a);
  const reopened=fd.open(9);
  assert.ok(fd.watch(reopened));
});
test("FD reuse after retirement is safe, stale handle can't revive",()=>{
  const fd=new TrustedFdAliasModel(),a=fd.open(9),ticket=fd.watch(a);
  fd.retire(ticket);fd.close(a);
  assert.throws(()=>fd.watch(a),/foreign/);
  const b=fd.open(9);
  assert.ok(fd.watch(b));
});
test("cannot close watched FD or bypass owner via duplicated alias",()=>{
  const fd=new TrustedFdAliasModel(),a=fd.open(5),alias=fd.duplicate(a,8);
  const t=fd.watch(a);
  assert.throws(()=>fd.close(alias),/watched/);
  fd.retire(t);fd.close(alias);
  assert.throws(()=>fd.watch(alias),/foreign/);
});
test("foreign FD watch tickets and handles are rejected",()=>{
  const a=new TrustedFdAliasModel(),b=new TrustedFdAliasModel();
  const x=a.open(11),ticket=a.watch(x);
  assert.throws(()=>b.retire(ticket),/foreign/);
  assert.throws(()=>b.duplicate(x,12),/foreign/);
});
test("bounded FD watcher table rejects N+1 aliases or watchers",()=>{
  const fd=new TrustedFdAliasModel(2);
  fd.watch(fd.open(1));fd.watch(fd.open(2));
  assert.throws(()=>fd.watch(fd.open(3)),/capacity/);
});
test("reactor numeric and capability claims retire exactly once",()=>{
  const fd=new TrustedFdAliasModel(),h=fd.open(1),t=fd.watch(h);
  fd.retire(t);assert.throws(()=>fd.retire(t),/double/);
  const x=fd.inspect();assert.equal(x.identities,0);assert.equal(x.numbers,0);
});

test("ML DATA cannot impersonate supervisor CONTROL by raw string or tag",()=>{
  const ml=new TrainingControlModel("trainer");
  assert.throws(()=>ml.data("cancel_failed"),/DATA fields/);
  assert.throws(()=>ml.data({kind:"Commit",run:1,incarnation:1,step:0}),/untrusted CONTROL/);
});
test("ML optimizer commit requires trusted runtime-issued authority",()=>{
  const ml=new TrainingControlModel("trainer"),auth=ml.controlAuthorityForHost();
  assert.throws(()=>ml.commit({}, {run:1,incarnation:1,expectedVersion:1,step:0}),
    /CONTROL authority/);
  assert.equal(ml.commit(auth,{run:1,incarnation:1,expectedVersion:1,step:0}).weightVersion,2);
});
test("ML restart invalidates old authority even if step and weight version reset",()=>{
  const ml=new TrainingControlModel("trainer"),old=ml.controlAuthorityForHost();
  ml.restart();
  assert.throws(()=>ml.commit(old,{run:2,incarnation:2,expectedVersion:1,step:0}),/CONTROL/);
  const fresh=ml.controlAuthorityForHost();
  assert.equal(ml.commit(fresh,{run:2,incarnation:2,expectedVersion:1,step:0}).step,1);
});
test("ML stale run/incarnation and weight version never mutate state",()=>{
  const ml=new TrainingControlModel("trainer"),auth=ml.controlAuthorityForHost();
  for(const bad of [{run:2,incarnation:1,expectedVersion:1,step:0},
    {run:1,incarnation:2,expectedVersion:1,step:0},
    {run:1,incarnation:1,expectedVersion:2,step:0}]){
    assert.throws(()=>ml.commit(auth,bad),/stale/);
    assert.equal(ml.inspect().weightVersion,1);
  }
});
test("ML stopped actor denies DATA and privileged commit",()=>{
  const ml=new TrainingControlModel("trainer"),auth=ml.controlAuthorityForHost();
  ml.stop(auth);
  assert.throws(()=>ml.data({kind:"Gradient",run:1,incarnation:1,step:0}),/stopped/);
  assert.throws(()=>ml.commit(auth,{run:1,incarnation:1,expectedVersion:1,step:0}),/CONTROL/);
});

test("unsupported transport actor modes remain non-executable without adapter",()=>{
  for(const transport of ["http","ipc","tcp","ffi","proxy","websocket"]){
    const result=transportActorAdmission({transport,role:"actor",
      serial:false,requires:[],with:[]});
    assert.equal(result.status,"UNSUPPORTED");
    assert.equal(result.guestExecution,"DENIED");
  }
});
test("unary, serial and unverified capability clauses remain denied",()=>{
  for(const descriptor of [
    {transport:"mail",role:"unary",serial:false,requires:[],with:[]},
    {transport:"mail",role:"actor",serial:true,requires:[],with:[]},
    {transport:"mail",role:"actor",serial:false,requires:["NETWORK"],with:[]},
    {transport:"mail",role:"actor",serial:false,requires:[],with:["filesystem"]}
  ])assert.equal(transportActorAdmission(descriptor).status,"UNSUPPORTED");
});
test("conservative local-mail result is not proof runtime guest compiled",()=>{
  const out=transportActorAdmission({transport:"mail",role:"actor",
    serial:false,requires:[],with:[]});
  assert.equal(out.status,"LOCAL_MAIL_ONLY");
  assert.equal(out.guestExecution,"REFERENCE_NOT_PROOF");
});
test("guest cannot attach unrecognized execution authority fields",()=>{
  assert.throws(()=>transportActorAdmission({transport:"ipc",role:"actor",serial:false,
    requires:[],with:[],authenticated:true}),/fields/);
});

test("unreferenced actor self and host capability are omitted from closure",()=>{
  const available=[
    {binding:"b1",spelling:"count",kind:"ordinary"},
    {binding:"b2",spelling:"self",kind:"self"},
    {binding:"b3",spelling:"broker",kind:"capability"}
  ];
  assert.deepEqual(projectClosureBindings({available,referenced:["b1"]}),
    [available[0]]);
});
test("shadowed same-name lexical slots are distinct by binding identity",()=>{
  const available=[
    {binding:"outer1",spelling:"x",kind:"ordinary"},
    {binding:"inner1",spelling:"x",kind:"ordinary"}
  ];
  assert.deepEqual(projectClosureBindings({available,referenced:["inner1"]}),
    [available[1]]);
});
test("explicit construction-stage receiver cannot escape to closure",()=>{
  const available=[{binding:"construction1",spelling:"self",kind:"constructorSelf"}];
  assert.throws(()=>projectClosureBindings({available,referenced:["construction1"]}),
    /constructing self/);
});
test("unresolved binding and guest-provided capture metadata fail closed",()=>{
  const available=[{binding:"b1",spelling:"a",kind:"ordinary"}];
  assert.throws(()=>projectClosureBindings({available,referenced:["ghost"]}),/unresolved/);
  assert.throws(()=>projectClosureBindings({available:[{...available[0],trusted:true}],
    referenced:["b1"]}),/fields/);
});
test("authenticated peer cannot claim OUTCOME_UNKNOWN local transport failure",()=>{
  assert.equal(receiptOriginDecision({source:"authenticated-peer",stage:"OUTCOME_UNKNOWN"}),
    "DENY");
  assert.equal(receiptOriginDecision({source:"trusted-local-transport",
    stage:"OUTCOME_UNKNOWN"}),"ADMISSIBLE_ORIGIN_ONLY");
});
test("local transport cannot forge remote handler commit or ACK",()=>{
  for(const stage of ["REMOTE_ACCEPTED","HANDLER_COMMITTED","HANDLER_FAILED"])
    assert.equal(receiptOriginDecision({source:"trusted-local-transport",stage}),
      "DENY");
  assert.equal(receiptOriginDecision({source:"authenticated-peer",
    stage:"HANDLER_COMMITTED"}),"ADMISSIBLE_ORIGIN_ONLY");
});

test("FD identity registry cannot grow without bound on open/dup storms",()=>{
  const fd=new TrustedFdAliasModel(1),handles=[];
  for(let i=0;i<4;i++)handles.push(fd.open(i));
  assert.throws(()=>fd.open(5),/bounded FD handle inventory/);
  fd.close(handles[0]);
  assert.ok(fd.open(5));
});
test("trusted alias allocation is also bounded by open FD inventory",()=>{
  const fd=new TrustedFdAliasModel(1),h=fd.open(5);
  const aliases=[fd.duplicate(h,6),fd.duplicate(h,7),fd.duplicate(h,8)];
  assert.throws(()=>fd.duplicate(h,9),/bounded FD handle inventory/);
  aliases.forEach(x=>fd.close(x));
  fd.close(h);
});

test("dup of an occupied FD number is never a silent dup2 authority overwrite",()=>{
  const fd=new TrustedFdAliasModel(),a=fd.open(5),b=fd.open(6);
  assert.throws(()=>fd.duplicate(a,6),/already live/);
  assert.equal(fd.inspect().openHandles,2);
  const t=fd.watch(b);
  assert.equal(fd.inspect().watches,1);
  fd.retire(t);fd.close(a);fd.close(b);
});
test("numeric FD reuse remains fenced while any prior alias owns that number",()=>{
  const fd=new TrustedFdAliasModel(),a=fd.open(10),duplicate=fd.duplicate(a,12);
  fd.close(a);
  const recreated=fd.open(10); // distinct kernel open description after close
  assert.ok(fd.watch(recreated));
  assert.throws(()=>fd.open(12),/already live/);
  const other=fd.watch(duplicate);
  assert.equal(fd.inspect().watches,2);
  fd.retire(other);fd.close(duplicate);
  const newTwelve=fd.open(12);
  assert.ok(fd.watch(newTwelve));
});

test("authenticated peer cannot classify REJECTED_BEFORE_REMOTE",()=>{
  assert.equal(receiptOriginDecision({source:"authenticated-peer",
    stage:"REJECTED_BEFORE_REMOTE"}),"DENY");
  assert.equal(receiptOriginDecision({source:"trusted-local-transport",
    stage:"REJECTED_BEFORE_REMOTE"}),"ADMISSIBLE_ORIGIN_ONLY");
});
test("unknown IPC origin and pseudo terminal result remain denied",()=>{
  assert.throws(()=>receiptOriginDecision({source:"guest",stage:"HANDLER_COMMITTED"}),
    /receipt origin/);
  assert.throws(()=>receiptOriginDecision({source:"authenticated-peer",
    stage:"CANCELLED_BEFORE_REMOTE"}),/receipt stage/);
});

test("50k seeded hierarchical quota transitions preserve aggregate credit invariants",()=>{
  let seed=20261019;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const q=quota(),live=[];
  let now=0n;
  for(let i=0;i<50000;i++){
    now+=1000000n; // trusted monotonic 1 ms increments
    const roll=rng()%17;
    if(roll===0)q.restart();
    else if(roll<6&&live.length)q.finish(live.splice(rng()%live.length,1)[0]);
    else{
      const admission=q.admit(1+(rng()%16),now);
      if(admission.accepted)live.push(admission.lease);
    }
    const snapshot=q.inspect();
    assert.equal(snapshot.outstanding,live.length);
    assert.ok(snapshot.outstanding<=10);
    for(const scope of snapshot.scopes){
      assert.equal(scope.active,live.length);
      assert.ok(scope.tokenWhole>=0&&scope.tokenWhole<=2);
      assert.ok(scope.bytesWhole>=0&&scope.bytesWhole<=10000);
    }
  }
  for(const ticket of live)q.finish(ticket);
  assert.equal(q.inspect().outstanding,0);
  q.stop();
  assert.throws(()=>q.admit(1,now),/closed/);
});
test("20k seeded FD handle/dup/watch/retire steps cannot double-own numeric FDs",()=>{
  let seed=7331;const rng=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed;};
  const fd=new TrustedFdAliasModel(12),handles=[],watches=[];
  let nextFd=1;
  for(let i=0;i<20000;i++){
    const action=rng()%5;
    if(action===0&&handles.length<24){
      const h=fd.open(nextFd++);
      handles.push(h);
    }else if(action===1&&handles.length&&handles.length<24){
      const target=handles[rng()%handles.length];
      handles.push(fd.duplicate(target,nextFd++));
    }else if(action===2&&handles.length&&watches.length<12){
      const h=handles[rng()%handles.length];
      try{watches.push(fd.watch(h));}catch(e){assert.match(String(e),/watch|duplicate|numeric|capacity/);}
    }else if(action===3&&watches.length){
      fd.retire(watches.splice(rng()%watches.length,1)[0]);
    }else if(action===4&&handles.length){
      const index=rng()%handles.length,h=handles[index];
      try{fd.close(h);handles.splice(index,1);}
      catch(e){assert.match(String(e),/watched/);}
    }
    const s=fd.inspect();
    assert.ok(s.openHandles<=24);
    assert.equal(s.openHandles,handles.length);
    assert.equal(s.watches,watches.length);
    assert.equal(s.numbers,s.watches);
    assert.equal(s.identities,s.watches);
  }
  watches.forEach(t=>fd.retire(t));
  handles.forEach(h=>fd.close(h));
  const stats=fd.inspect();
  assert.equal(stats.watches,0);
  assert.equal(stats.openHandles,0);
});


test("peer ACK is illegal before trusted local transport dispatch commitment",()=>{
  const f=new IpcPublicationFenceModel();
  assert.throws(()=>f.receivePeer("REMOTE_ACCEPTED"),/before local dispatch/);
  assert.ok(f.invariant());
  assert.deepEqual(f.inspect(),{
    stage:"LOCAL_ADMITTED",pending:true,transportCredits:1,lastObserved:null
  });
});
test("local never-sent rejection loses irreversibly after dispatch commit",()=>{
  const f=new IpcPublicationFenceModel();
  f.commitDispatch();
  assert.throws(()=>f.rejectBeforeRemote(),/cannot prove never-sent/);
  assert.equal(f.inspect().stage,"DISPATCH_COMMITTED");
  assert.equal(f.inspect().transportCredits,1);
  assert.equal(f.transportLost(),true);
  assert.equal(f.inspect().lastObserved,"DISPATCH_COMMITTED");
  assert.equal(f.inspect().stage,"OUTCOME_UNKNOWN");
  assert.equal(f.inspect().transportCredits,0);
  assert.throws(()=>f.commitDispatch(),/commitment denied/);
  assert.ok(f.invariant());
});
test("local rejection wins before dispatch: no publish and no credits leak",()=>{
  const f=new IpcPublicationFenceModel();
  f.rejectBeforeRemote();
  assert.throws(()=>f.commitDispatch(),/commitment denied/);
  assert.equal(f.transportLost(),false);
  assert.equal(f.inspect().stage,"REJECTED_BEFORE_REMOTE");
  assert.ok(f.invariant());
});
test("authenticated peer ACK and terminal must respect dispatch order",()=>{
  const f=new IpcPublicationFenceModel();
  assert.throws(()=>f.receivePeer("HANDLER_COMMITTED"),/without ACK/);
  f.commitDispatch();
  assert.throws(()=>f.receivePeer("HANDLER_COMMITTED"),/without ACK/);
  f.receivePeer("REMOTE_ACCEPTED");
  assert.equal(f.inspect().transportCredits,0);
  f.receivePeer("HANDLER_COMMITTED");
  assert.equal(f.inspect().pending,false);
  assert.equal(f.transportLost(),false);
  assert.throws(()=>f.receivePeer("HANDLER_FAILED"),/without ACK/);
  assert.ok(f.invariant());
});
test("a remote peer cannot issue locally authoritative terminal outcomes",()=>{
  const f=new IpcPublicationFenceModel();
  f.commitDispatch();
  assert.throws(()=>f.receivePeer("OUTCOME_UNKNOWN"),/trusted-local/);
  assert.throws(()=>f.receivePeer("REJECTED_BEFORE_REMOTE"),/trusted-local/);
  assert.equal(f.inspect().stage,"DISPATCH_COMMITTED");
  assert.ok(f.invariant());
});
test("trusted local EOF without dispatch is conservatively uncertain, not replayable",()=>{
  const f=new IpcPublicationFenceModel();
  assert.equal(f.transportLost(),true);
  assert.equal(f.inspect().lastObserved,"LOCAL_ADMITTED");
  assert.equal(f.inspect().stage,"OUTCOME_UNKNOWN");
  assert.throws(()=>f.rejectBeforeRemote(),/cannot prove/);
  assert.ok(f.invariant());
});
test("exhaustive serial orderings of commit, reject, ACK, DONE and EOF preserve credits",()=>{
  const commands=["commit","reject","ack","done","eof"];
  let serializations=0;
  const walk=(prefix,remaining)=>{
    if(remaining.length===0){
      const f=new IpcPublicationFenceModel();
      for(const name of prefix){
        try{
          if(name==="commit")f.commitDispatch();
          else if(name==="reject")f.rejectBeforeRemote();
          else if(name==="ack")f.receivePeer("REMOTE_ACCEPTED");
          else if(name==="done")f.receivePeer("HANDLER_COMMITTED");
          else f.transportLost();
        }catch(e){assert.match(String(e),/SECURITY_ORACLE_DENY/);}
        assert.ok(f.invariant());
      }
      serializations++;
      return;
    }
    for(let i=0;i<remaining.length;i++)
      walk([...prefix,remaining[i]],
        [...remaining.slice(0,i),...remaining.slice(i+1)]);
  };
  walk([],commands);
  assert.equal(serializations,120);
});
test("100k deterministic IPC publication fault transitions never underflow credits",()=>{
  let seed=20261019;
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed};
  for(let i=0;i<100000;i++){
    const f=new IpcPublicationFenceModel();
    for(let j=0;j<5;j++){
      const pick=rng()%6;
      try{
        if(pick===0)f.commitDispatch();
        else if(pick===1)f.rejectBeforeRemote();
        else if(pick===2)f.receivePeer("REMOTE_ACCEPTED");
        else if(pick===3)f.receivePeer("HANDLER_COMMITTED");
        else if(pick===4)f.receivePeer("HANDLER_FAILED");
        else f.transportLost();
      }catch(e){assert.match(String(e),/SECURITY_ORACLE_DENY/);}
      assert.ok(f.invariant());
    }
  }
});
