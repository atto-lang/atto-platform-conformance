// Reference-only semantics for the 134 shared pure Atto std policy vectors.
// This is not backend compiler execution and must never create a PASS receipt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const contract = JSON.parse(readFileSync(
  new URL("../contracts/atto-std-pure-policy-parity-v1.json", import.meta.url), "utf8"));
const ascii = x => (x >= 65 && x <= 90) || (x >= 97 && x <= 122);
const reference = {
  path: {
    is_separator: (x,w) => x === 47 || (w && x === 92),
    is_ascii_letter: ascii,
    is_safe_scalar: (x,w) => x >= 32 && x !== 127 && x <= 1114111 &&
      !(x >= 55296 && x <= 57343) && x !== 47 && !(w && x === 92) &&
      (!w || ascii(x) || (x>=48 && x<=57) || x===46 || x===45 || x===95),
    component_kind: (n,a,b) => n<1 || n>255 ? -1 :
      n===1 && a===46 ? 1 : n===2 && a===46 && b===46 ? 2 : 0,
    advance_relative_depth: (depth,kind) =>
      depth<0 || depth>256 ? -1 :
      kind===1 ? depth : kind===2 ? depth>0 ? depth-1 : -1 :
      kind===0 && depth<256 ? depth+1 : -1,
    is_windows_drive_prefix: (a,b) => ascii(a) && b===58,
    relative_join_budget_admissible: (a,b,n,m) => a>=1 && a<=4096 &&
      b>=1 && b<=4096 && n>=0 && n<=256 && m>=0 && m<=256 &&
      a<=4095-b && n<=256-m,
    extension_offset_admissible: (len,i) => len>=3 && len<=255 && i>=1 && i<len-1
  },
  sync: {
    mutex_take_admissible: (held,closed,n) => !held && !closed && n===0,
    mutex_enqueue_admissible: (closed,n,cap) => !closed && n>=0 && cap>=1 && n<cap,
    read_take_admissible: (readers,writer,pending,limit) =>
      !writer && pending===0 && readers>=0 && limit>=1 && readers<limit,
    write_take_admissible: (readers,writer) => readers===0 && !writer,
    sem_take_admissible: (avail,requested,cap,closed) =>
      !closed && cap>=1 && avail>=0 && avail<=cap &&
      requested>=1 && requested<=avail,
    sem_return_admissible: (avail,released,cap,_closed) =>
      cap>=1 && avail>=0 && avail<=cap && released>=1 && released<=cap-avail,
    barrier_last_arrival: (arrived,parties,broken) =>
      !broken && parties>=1 && parties<=65536 && arrived===parties-1,
    barrier_arrival_admissible: (arrived,parties,broken) =>
      !broken && parties>=1 && parties<=65536 && arrived>=0 && arrived<parties,
    mutex_release_receipt_admissible: (held,owner,caller,epoch,receipt,consumed) =>
      held && !consumed && owner>0 && owner===caller && epoch>=0 &&
      receipt>=0 && epoch===receipt,
    rw_upgrade_admissible: (readers,writer,pending,hasLease) =>
      hasLease && !writer && readers===1 && pending===0,
    next_epoch_admissible: (now,next) => now>=0 && now<2147483647 &&
      next===now+1
  },
  telemetry: {
    traceparent_v00_fields_valid: (version,hi,lo,parent,flags) =>
      version===0 && (hi!==0 || lo!==0) && parent!==0 && flags>=0 && flags<=255,
    sampled_flag: flags => flags>=0 && flags<=255 && flags%2===1,
    sampling_decision: (policy,parent) => policy===1 ? 1 : policy===2 ? 2 :
      policy===3 && parent ? 2 : 0,
    decision_is_recording: x => x===1 || x===2,
    decision_is_sampled: x => x===2,
    span_window_valid: (start,end) => start>=0 && end>=start,
    dormant_probe_admissible: (ceiling,requested,authorized) =>
      authorized && ceiling>=1 && ceiling<=3 && requested>=1 && requested<=ceiling,
    queue_admissible: (queued,cap,bytes,available) => cap>=1 && cap<=65536 &&
      queued>=0 && queued<cap && bytes>=0 && available>=0 && bytes<=available,
    drop_increment: count => count<0 ? -1 : count>=2147483647 ?
      2147483647 : count+1
  }
};
const expectedTargets = ["atto","cranelift","forge","hdl","java","js",
  "llvm","net","realtime","rs","wasm"];
function verifyContract(doc) {
  assert.equal(doc.schema,"atto-std-pure-policy-parity-v1");
  assert.equal(doc.status,"CANDIDATE_ONLY; NOT_EXECUTED via native guest");
  assert.deepEqual(Object.keys(doc.api).sort(),Object.keys(reference).sort());
  assert.equal(Object.values(doc.api).reduce((n,x) => n+Object.keys(x).length,0),28);
  for(const [module, fns] of Object.entries(reference))
    assert.deepEqual(Object.keys(doc.api[module]).sort(),Object.keys(fns).sort());
  assert.equal(doc.vectors.length,134);
  assert.deepEqual(doc.backends.map(x => x.backend).sort(),expectedTargets);
  for(const backend of doc.backends) {
    assert.equal(backend.guest, "NOT_EXECUTED",
      "a source-only contract cannot self-attest native execution");
    assert.ok(["candidate-implementation-in-draft","not-audited"].includes(
      backend.source_status),"recognized source state only");
  }
  const used=new Set();
  for(const [i, v] of doc.vectors.entries()){
    assert.equal(v.id,"STD-"+String(i+1).padStart(3,"0"));
    assert.equal(used.has(v.id),false,"duplicate vector ID");
    used.add(v.id);
    const signature=doc.api[v.module]?.[v.fn];
    assert.ok(signature,"unknown function "+v.id);
    assert.equal(signature.length,v.args.length+1,v.id+" arity");
    for(let n=0;n<v.args.length;n++){
      assert.equal(typeof v.args[n],signature[n]==="bool"?"boolean":"number",
        v.id+" argument");
      if(signature[n]==="int")
        assert.ok(Number.isSafeInteger(v.args[n]),v.id+" integer precision");
    }
    assert.equal(typeof v.expected,signature.at(-1)==="bool"?"boolean":"number",
      v.id+" expected type");
    const result=reference[v.module][v.fn](...v.args);
    assert.equal(v.expected,result,v.id+" reference semantics");
  }
  assert.equal(doc.evidence_rules.source_only,"NOT_EXECUTED");
  assert.equal(doc.evidence_rules.independent_library_sources,true);
  return used.size;
}
test("contract references all 28 signatures and 134 independently checked cases",()=>{
  assert.equal(verifyContract(contract),134);
  console.log("ATTO_STD_CONTRACT_MODEL_ONLY|vectors=134|APIs=28|guest=NOT_EXECUTED");
});
test("mutation checks reject false parity/evidence",()=>{
  const clone=()=>structuredClone(contract);
  let x=clone();x.vectors[0].expected=!x.vectors[0].expected;
  assert.throws(()=>verifyContract(x),"incorrect reference result");
  x=clone();x.vectors[1].id=x.vectors[0].id;
  assert.throws(()=>verifyContract(x),"duplicate identifier");
  x=clone();x.backends[0].guest="PASS";
  assert.throws(()=>verifyContract(x),"unsigned self-reported PASS");
  x=clone();x.backends.pop();
  assert.throws(()=>verifyContract(x),"missing backend");
  x=clone();x.vectors[0].fn="unreviewed_method";
  assert.throws(()=>verifyContract(x),"unknown API");
});
