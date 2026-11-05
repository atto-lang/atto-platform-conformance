import test from "node:test";
import assert from "node:assert/strict";
import {BACKENDS, evaluateConcurrencyTrace} from "../lib/concurrency-trace-admission-v1.mjs";

// These are host/reference invariants, never evidence of an executed .atto guest.
const E=(kind,rest={})=>({kind,...rest});
const mk=(events,backend="llvm")=>({backend,events:events.map((x,i)=>({seq:i+1,...x}))});
const evalTrace=(events,backend)=>evaluateConcurrencyTrace(mk(events,backend));
const grade=(events)=>evalTrace(events).classification;
const good=(events)=>assert.equal(grade(events),"CONSISTENT_REFERENCE_TRACE_ONLY");
const bad=(events,reason)=>{
  const out=evalTrace(events);
  assert.equal(out.classification,"TRACE_REJECTED");
  if(reason)assert.match(out.reason,reason);
};
const C=(kind,task,lock="L")=>E("critical."+kind,{lock,task});
const A=(kind,task,actor="a",generation=1)=>E("actor."+kind,{actor,generation,task});
const S=(kind,rest={})=>E("select."+kind,{select:"s",generation:1,...rest});
const T=(kind,task="child")=>E("task."+kind,{scope:"root",task});
const Scope=kind=>E("scope."+kind,{scope:"root"});

test("five compiler backends never become parity proof from trace JSON",()=>{
  assert.equal(BACKENDS.length,5);
  for(const backend of BACKENDS){
    const result=evalTrace([C("enter","a"),C("exit","a")],backend);
    assert.equal(result.classification,"CONSISTENT_REFERENCE_TRACE_ONLY");
    assert.equal(result.compiler_executed,false);
    assert.equal(result.guest_executed,false);
    assert.equal(result.semantic_parity_certified,false);
    assert.equal(result.source_transfer_authorized,false);
  }
});
test("critical FIFO preserves survivors after cancellation",()=>{
  good([C("enter","a"),C("queue","b"),C("queue","c"),
    C("cancel","b"),C("exit","a"),C("grant","c"),C("exit","c")]);
  bad([C("enter","a"),C("queue","b"),C("queue","c"),
    C("exit","a"),C("grant","c")],/FIFO/);
});
test("try critical returns busy without waiting or lying about free gate",()=>{
  good([C("enter","a"),E("critical.try",{lock:"L",task:"b",outcome:"busy"}),C("exit","a")]);
  good([E("critical.try",{lock:"L",task:"a",outcome:"granted"}),C("exit","a")]);
  bad([C("enter","a"),E("critical.try",{lock:"L",task:"b",outcome:"granted"})],/try critical/);
  bad([E("critical.try",{lock:"L",task:"a",outcome:"busy"})],/try critical/);
});
test("critical nonowner release, duplicated waiter, and leaked guard reject",()=>{
  bad([C("enter","a"),C("exit","b")],/nonowner/);
  bad([C("enter","a"),C("queue","b"),C("queue","b")],/duplicate/);
  bad([C("enter","a")],/not drained/);
  bad([C("queue","b")],/without contention/);
  bad([C("enter","a","L1"),C("enter","a","L2")],/nested/);
  bad([C("enter","a","L1"),
    E("critical.try",{lock:"L2",task:"a",outcome:"granted"})],/nested/);
});
test("suspended actor preserves DATA turn while independent actor progresses",()=>{
  good([E("actor.open",{actor:"a",generation:1}),
    E("actor.open",{actor:"b",generation:1}),
    A("start","h1"),A("suspend","h1"),A("queue","h2"),
    A("start","other","b"),A("finish","other","b"),
    E("actor.control-stop",{actor:"a",generation:1}),
    A("resume","h1"),A("finish","h1"),A("start","h2"),A("finish","h2")]);
  bad([E("actor.open",{actor:"a",generation:1}),A("start","h1"),
    A("suspend","h1"),A("start","h2")],/reentrancy/);
});
test("actor stale resume and overtaken queued DATA reject",()=>{
  bad([E("actor.open",{actor:"a",generation:1}),A("start","h1"),
    A("suspend","h1"),A("resume","h1","a",2)],/stale/);
  bad([E("actor.open",{actor:"a",generation:1}),A("start","h1"),
    A("queue","h2"),A("queue","h3"),A("finish","h1"),
    A("start","h3")],/FIFO/);
});
test("select admits one winner then publishes and wakes once",()=>{
  const winner=[S("open"),S("arm",{arm:"left"}),S("arm",{arm:"right"}),
    S("win",{arm:"left",outcome:"success"}),S("publish",{arm:"left"}),
    S("wake"),S("close")];
  good(winner);
  bad([S("open"),S("arm",{arm:"left"}),S("arm",{arm:"right"}),
    S("win",{arm:"left",outcome:"success"}),S("publish",{arm:"right"})],/losing/);
  bad([S("open"),S("arm",{arm:"left"}),S("win",{arm:"left",outcome:"success"}),
    S("wake")],/early/);
  bad([...winner.slice(0,6),S("wake"),S("close")],/duplicate/);
  bad([S("open"),S("arm",{arm:"left"}),S("win",{arm:"left",outcome:"success"}),
    S("win",{arm:"left",outcome:"success"})],/duplicate/);
});
test("failed select result can wake with no payload publication",()=>{
  good([S("open"),S("arm",{arm:"a"}),S("win",{arm:"a",outcome:"failure"}),
    S("wake"),S("close")]);
  bad([S("open"),S("arm",{arm:"a"}),S("win",{arm:"a",outcome:"failure"}),
    S("publish",{arm:"a"})],/losing/);
});
test("select rearm requires closed earlier generation",()=>{
  const settled=[S("open"),S("arm",{arm:"a"}),S("win",{arm:"a",outcome:"failure"}),
    S("wake"),S("close")];
  good([...settled,E("select.open",{select:"s",generation:2}),
    E("select.close",{select:"s",generation:2})]);
  bad([...settled,S("open")],/generation/);
  bad([S("open"),S("arm",{arm:"a"}),
    E("select.arm",{select:"s",generation:2,arm:"b"})],/stale/);
});
test("TaskScope waits for both terminal and physical quiescence in any order",()=>{
  good([Scope("open"),T("spawn"),T("terminal"),T("quiesce"),T("retire"),Scope("close")]);
  good([Scope("open"),T("spawn"),T("quiesce"),T("terminal"),T("retire"),Scope("close")]);
  bad([Scope("open"),T("spawn"),T("terminal"),T("retire")],/quiescence/);
  bad([Scope("open"),T("spawn"),T("quiesce"),T("retire")],/terminal/);
});
test("scope cancellation blocks admission but not physical retirement",()=>{
  good([Scope("open"),T("spawn"),Scope("cancel"),
    T("terminal"),T("quiesce"),T("retire"),Scope("close")]);
  bad([Scope("open"),Scope("cancel"),T("spawn")],/admission/);
  bad([Scope("open"),T("spawn"),Scope("cancel"),T("terminal"),Scope("close")],/retirement/);
  bad([Scope("open"),T("spawn"),T("terminal"),T("quiesce"),
    T("retire"),T("retire"),Scope("close")],/retirement/);
});
test("unknown backend, forged fields, malformed sequence and huge input reject",()=>{
  assert.equal(evaluateConcurrencyTrace(mk([C("enter","a"),C("exit","a")],"alien")).classification,"TRACE_REJECTED");
  bad([E("carrier.block",{task:"a"})],/unknown event/);
  bad([E("critical.enter",{lock:"L",task:"a",spoof:"pass"})],/unexpected/);
  const sequence=mk([C("enter","a"),C("exit","a")]);
  sequence.events[1].seq=3;
  assert.equal(evaluateConcurrencyTrace(sequence).classification,"TRACE_REJECTED");
  assert.equal(evaluateConcurrencyTrace({backend:"llvm",events:Array(513).fill(null)}).classification,"TRACE_REJECTED");
});
test("integrated guard + actor + select + scope cancellation trace is checked atomically",()=>{
 const t=[
  C("enter","owner"),C("queue","cancelled"),C("queue","survivor"),C("cancel","cancelled"),
  E("actor.open",{actor:"a",generation:1}),A("start","h1"),A("suspend","h1"),
  A("queue","h2"),E("actor.control-stop",{actor:"a",generation:1}),
  S("open"),S("arm",{arm:"send"}),S("arm",{arm:"recv"}),
  S("win",{arm:"send",outcome:"success"}),S("publish",{arm:"send"}),S("wake"),S("close"),
  Scope("open"),T("spawn"),Scope("cancel"),T("quiesce"),T("terminal"),T("retire"),Scope("close"),
  A("resume","h1"),A("finish","h1"),A("start","h2"),A("finish","h2"),
  C("exit","owner"),C("grant","survivor"),C("exit","survivor")
 ];
 good(t);
 bad(t.filter(x=>x.kind!=="task.quiesce"),/quiescence/);
 bad(t.map(x=>x.kind==="select.publish"?S("publish",{arm:"recv"}):x),/losing/);
});
