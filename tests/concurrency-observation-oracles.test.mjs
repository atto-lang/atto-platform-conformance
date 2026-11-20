import test from "node:test";
import assert from "node:assert/strict";
import {auditMemoryTrace,auditTaskTrace,auditCausalDiagnostic,auditWaitGraph} from
  "../src/concurrency-observation-oracles.mjs";
const SHA="a".repeat(40);
const mem=(events,roots=["A","B"])=>auditMemoryTrace({
  schema:1,sourceTree:SHA,roots,events:events.map((e,i)=>({seq:i+1,...e}))
});
const write=(owner,over={})=>({owner,op:"write",domain:"shared",
  allocation:"cell",generation:1,place:"value",span:"main.ores:1:1",...over});
const read=(owner,over={})=>({...write(owner,over),op:"read"});
const task=(events)=>auditTaskTrace({schema:1,sourceTree:SHA,scope:"scope0",
  events:events.map((e,i)=>({seq:i+1,...e}))});
const reg=(name,parent=null)=>({task:name,op:"register",parent});
const ev=(task,op)=>({task,op});
const frame=(kind="await")=>({kind,file:"src/main.ores",line:1,column:1,
  correlation:"opaque0"});
const diag=(over={})=>({schema:1,backend:"java",sourceTree:SHA,
  errorCode:"TRAINING_ERROR",frames:[frame()],truncated:false,...over});

test("independent write/write is a race; trace array order is not HB",()=>{
  const x=mem([write("A"),write("B")]);
  assert.equal(x.races.length,1);
  assert.equal(x.races[0].earlierOwner,"A");
  assert.equal(x.races[0].laterOwner,"B");
  assert.equal(x.classification,"SOURCE_FREE_ORACLE_ONLY");
  assert.equal(x.guestInstrumentation,"NOT_ESTABLISHED");
});
test("independent write/read is a race",()=>{
  assert.equal(mem([write("A"),read("B")]).races.length,1);
});
test("read/read is not a race",()=>{
  assert.equal(mem([read("A"),read("B")]).races.length,0);
});
test("same-owner repeated writes are ordered",()=>{
  assert.equal(mem([write("A"),write("A")]).races.length,0);
});
test("mutex release and acquire establish HB",()=>{
  const x=mem([
    {owner:"A",op:"acquire",lock:"guard"},write("A"),
    {owner:"A",op:"release",lock:"guard"},
    {owner:"B",op:"acquire",lock:"guard"},read("B"),
    {owner:"B",op:"release",lock:"guard"}
  ]);
  assert.equal(x.races.length,0);
});
test("send/receive establishes HB for the receiving owner",()=>{
  const x=mem([
    write("A"),{owner:"A",op:"send",message:"m1"},
    {owner:"B",op:"recv",message:"m1"},read("B")
  ]);
  assert.equal(x.races.length,0);
});
test("spawn and physical join establish HB",()=>{
  const x=mem([
    {owner:"A",op:"spawn",child:"B"},
    write("B"),{owner:"B",op:"done"},
    {owner:"A",op:"join",child:"B"},read("A")
  ],["A"]);
  assert.equal(x.races.length,0);
});
test("spawn alone does not order later independent accesses",()=>{
  assert.equal(mem([
    {owner:"A",op:"spawn",child:"B"},write("A"),read("B")
  ],["A"]).races.length,1);
});
test("cancellation cannot manufacture an HB edge or physical exit",()=>{
  assert.equal(mem([
    write("A"),{owner:"A",op:"cancel"},read("B")
  ]).races.length,1);
});
test("reused allocations require generation identity",()=>{
  assert.equal(mem([write("A",{generation:1}),
    read("B",{generation:2})]).races.length,0);
});
test("field places and memory domains do not alias",()=>{
  assert.equal(mem([
    write("A",{place:"x"}),read("B",{place:"y"}),
    read("B",{domain:"private"})
  ]).races.length,0);
});
test("unknown operations and injected fields fail closed",()=>{
  assert.throws(()=>mem([{owner:"A",op:"ffi_borrow"}]),/unknown memory-trace operation/);
  assert.throws(()=>mem([write("A",{clock:{A:999}})]),/fields/);
});
test("receiving without send and duplicate receive fail closed",()=>{
  assert.throws(()=>mem([{owner:"B",op:"recv",message:"m1"}]),/receive/);
  assert.throws(()=>mem([
    {owner:"A",op:"send",message:"m1"},
    {owner:"B",op:"recv",message:"m1"},
    {owner:"B",op:"recv",message:"m1"}]),/receive/);
});
test("invalid mutex ownership/reentrance fail closed",()=>{
  assert.throws(()=>mem([{owner:"A",op:"release",lock:"guard"}]),/release/);
  assert.throws(()=>mem([
    {owner:"A",op:"acquire",lock:"guard"},
    {owner:"A",op:"acquire",lock:"guard"}]),/overlapping/);
});
test("join without physical child exit fails closed",()=>{
  assert.throws(()=>mem([
    {owner:"A",op:"spawn",child:"B"},
    {owner:"A",op:"join",child:"B"}
  ],["A"]),/physically exited/);
});
test("reject unregistered owner, duplicate child, source mismatches, gaps",()=>{
  assert.throws(()=>mem([write("C")]),/unregistered/);
  assert.throws(()=>mem([{owner:"A",op:"spawn",child:"B"}]),/duplicate/);
  assert.throws(()=>auditMemoryTrace({schema:1,sourceTree:"bad",
    roots:["A"],events:[{seq:1,...write("A")}]}),/source tree/);
  assert.throws(()=>auditMemoryTrace({schema:1,sourceTree:SHA,
    roots:["A"],events:[{seq:2,...write("A")}]}),/sequence/);
});
test("unsafe guest spans and stale object generation are denied",()=>{
  assert.throws(()=>mem([write("A",{span:"../../secret:1:1"})]),/source span/);
  assert.throws(()=>mem([write("A",{generation:0})]),/generation/);
});
test("event budget rejects unbounded synthetic traces",()=>{
  assert.throws(()=>auditMemoryTrace({schema:1,sourceTree:SHA,roots:["A"],
    events:Array(4097).fill(write("A"))}),/bounded trace events/);
});
test("Task scope only completes after all physical exits",()=>{
  const out=task([
    reg("parent"),reg("child","parent"),ev("parent","start"),
    ev("child","start"),ev("parent","cancel"),ev("child","cancel"),
    ev("parent","physical_exit"),ev("child","physical_exit"),
    ev("child","get_done"),ev("scope0","scope_done")
  ]);
  assert.equal(out.taskCount,2);
  assert.equal(out.physicallyExited,2);
  assert.equal(out.cancellationSignals,2);
  assert.equal(out.scopeDone,true);
  assert.equal(out.sourceTaskExecution,"NOT_ESTABLISHED");
});
test("cancel is not physical exit or completion",()=>{
  assert.throws(()=>task([
    reg("t"),ev("t","cancel"),ev("scope0","scope_done")
  ]),/physical child exits/);
  assert.throws(()=>task([
    reg("t"),ev("t","cancel"),ev("t","get_done")
  ]),/before physical exit/);
});
test("Task before-start cancellation forbids late start",()=>{
  assert.throws(()=>task([
    reg("t"),ev("t","cancel"),ev("t","start")
  ]),/start after cancellation/);
});
test("parent transfer to missing/exited Task fails",()=>{
  assert.throws(()=>task([reg("child","missing")]),/unowned/);
  assert.throws(()=>task([
    reg("parent"),ev("parent","physical_exit"),reg("child","parent")
  ]),/unowned/);
});
test("unowned, duplicate exits and terminal post-completion events fail",()=>{
  assert.throws(()=>task([ev("t","physical_exit")]),/unknown Task/);
  assert.throws(()=>task([reg("t"),ev("t","physical_exit"),
    ev("t","physical_exit")]),/duplicate physical exit/);
  assert.throws(()=>task([reg("t"),ev("t","physical_exit"),
    ev("scope0","scope_done"),ev("t","get_done")]),/after scope completion/);
});
test("duplicated Task registration and get_done fail",()=>{
  assert.throws(()=>task([reg("t"),reg("t")]),/duplicate/);
  assert.throws(()=>task([
    reg("t"),ev("t","physical_exit"),ev("t","get_done"),
    ev("t","get_done")]),/duplicate get_done/);
});
test("traces cannot carry source payload or raw host frames",()=>{
  assert.equal(auditCausalDiagnostic(diag()).classification,"STRUCTURAL_ONLY");
  assert.throws(()=>auditCausalDiagnostic(diag({payload:"secret"})),/fields/);
  assert.throws(()=>auditCausalDiagnostic(diag({stack:"java-stack"})),/fields/);
  assert.throws(()=>auditCausalDiagnostic(diag({frames:[{...frame(),url:"https://private/"}]})),/fields/);
});
test("causal frame allows known async boundaries only",()=>{
  assert.equal(auditCausalDiagnostic(diag({
    backend:"llvm",frames:[frame("await"),frame("actor-send"),frame("supervisor-control")]
  })).frames,3);
  assert.throws(()=>auditCausalDiagnostic(diag({frames:[frame("raw-pointer")]})),/boundary/);
});
test("causal frame rejects absolute paths, traversal and correlation leakage",()=>{
  assert.throws(()=>auditCausalDiagnostic(diag({
    frames:[{...frame(),file:"/tmp/private"}]})),/filename/);
  assert.throws(()=>auditCausalDiagnostic(diag({
    frames:[{...frame(),file:"../private"}]})),/filename/);
  assert.throws(()=>auditCausalDiagnostic(diag({
    frames:[{...frame(),correlation:"token-ABC/secret"}]})),/correlation/);
});
test("diagnostic truncation budget must be explicit",()=>{
  assert.throws(()=>auditCausalDiagnostic(diag({
    frames:Array(64).fill(frame()),truncated:false})),/truncation/);
  assert.equal(auditCausalDiagnostic(diag({
    frames:Array(64).fill(frame()),truncated:true})).truncated,true);
  assert.throws(()=>auditCausalDiagnostic(diag({
    frames:Array(65).fill(frame()),truncated:true})),/bounded/);
});
test("unsafe freeform error text and backend mismatch fail closed",()=>{
  assert.throws(()=>auditCausalDiagnostic(diag({errorCode:"secrets: abc"})),/error code/);
  assert.throws(()=>auditCausalDiagnostic(diag({backend:"host-jvm"})),/backend/);
});

test("foreign join cannot forge a happens-before transfer",()=>{
  assert.throws(()=>mem([
    {owner:"A",op:"spawn",child:"C"},write("C"),
    {owner:"C",op:"done"},{owner:"B",op:"join",child:"C"}
  ]),/unique original owning spawner/);
});
test("join is single-consumer even if a child is already exited",()=>{
  assert.throws(()=>mem([
    {owner:"A",op:"spawn",child:"C"},
    {owner:"C",op:"done"},
    {owner:"A",op:"join",child:"C"},
    {owner:"A",op:"join",child:"C"}
  ]),/unique original owning spawner/);
});
test("parent get_done cannot settle before owned descendants exit",()=>{
  assert.throws(()=>task([
    reg("parent"),reg("child","parent"),
    ev("parent","physical_exit"),ev("parent","get_done")
  ]),/descendant quiescence/);
  assert.equal(task([
    reg("parent"),reg("child","parent"),
    ev("parent","physical_exit"),ev("child","physical_exit"),
    ev("parent","get_done"),ev("scope0","scope_done")
  ]).scopeDone,true);
});

const wait=(owner,dependencies,over={})=>({owner,dependencies,
  mode:"ALL",state:"pending",timeout:false,external:false,...over});
const graph=(participants,waits)=>auditWaitGraph({schema:1,sourceTree:SHA,
  participants,waits});
test("observed two-owner mandatory wait cycle is potential, never proven definite",()=>{
  const x=graph(["A","B"],[wait("A",["B"]),wait("B",["A"])]);
  assert.deepEqual(x.conservativeWaitCycles,[["A","B","A"]]);
  assert.equal(x.definiteDeadlock,"NOT_PROVEN");
});
test("OR/select must not be interpreted as mandatory wait",()=>{
  const x=graph(["A","B","C"],[
    wait("A",["B","C"],{mode:"ANY"}),wait("B",["A"])
  ]);
  assert.equal(x.conservativeWaitCycles.length,0);
});
test("external producers prevent guaranteed wait-edge admission",()=>{
  assert.equal(graph(["A","B"],[
    wait("A",["B"],{external:true}),wait("B",["A"])
  ]).conservativeWaitCycles.length,0);
});
test("timeouts prevent guaranteed wait-edge admission",()=>{
  assert.equal(graph(["A","B"],[
    wait("A",["B"],{timeout:true}),wait("B",["A"])
  ]).conservativeWaitCycles.length,0);
});
test("cancellation and completed waits are not active edges",()=>{
  for(const state of ["cancelled","completed"]){
    assert.equal(graph(["A","B"],[
      wait("A",["B"],{state}),wait("B",["A"])
    ]).conservativeWaitCycles.length,0);
  }
});
test("multi-wait ALL cycle retains an observed necessary edge",()=>{
  assert.deepEqual(graph(["A","B","C"],[
    wait("A",["B","C"]),wait("B",["A"])
  ]).conservativeWaitCycles,[["A","B","A"]]);
});
test("self wait is an observed risk only, never verified deadlock",()=>{
  const x=graph(["A"],[wait("A",["A"])]);
  assert.deepEqual(x.conservativeWaitCycles,[["A","A"]]);
  assert.equal(x.definiteDeadlock,"NOT_PROVEN");
});
test("wait graph rejects duplicate, foreign and injected fields",()=>{
  assert.throws(()=>graph(["A","A"],[wait("A",["A"])]),/duplicate participant/);
  assert.throws(()=>graph(["A"],[wait("B",["A"])]),/foreign\/duplicate waiter/);
  assert.throws(()=>graph(["A"],[wait("A",["B"])]),/unknown wait dependency/);
  assert.throws(()=>graph(["A"],[wait("A",["A"],{secret:"hello"})]),/fields/);
});
test("wait graph rejects duplicate edges and unsupported completion semantics",()=>{
  assert.throws(()=>graph(["A","B"],[wait("A",["B","B"])]),/duplicate or unknown/);
  assert.throws(()=>graph(["A"],[wait("A",["A"],{mode:"ONE"})]),/completion semantics/);
});
test("graph without pending cycles reports no proven liveness",()=>{
  const x=graph(["A","B"],[wait("A",["B"])]);
  assert.equal(x.conservativeWaitCycles.length,0);
  assert.equal(x.definiteDeadlock,"NOT_PROVEN");
  assert.equal(x.sourceWaitInstrumentation,"NOT_ESTABLISHED");
});
