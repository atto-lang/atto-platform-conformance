import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile(
 new URL("../contracts/untrusted-supervisor-outbound-admission-v1.json",import.meta.url),"utf8");
const contract=JSON.parse(source);
const required=new Set([
 "direct-child-send","actor-output-path","reply-path","recovery-notice",
 "child-restart-fanout","nested-descendant-fanout","alternate-transport",
 "capacity-zero","cancel-race","quota-rotation","priority-bypass","quarantine-path"
]);
const decisions=new Set([
 "TRUSTED_QUOTA_REQUIRED","REJECT_WITHOUT_ALLOCATING","SINGLE_TERMINAL_OUTCOME",
 "REJECT_STALE_AUTHORITY","NO_TRUST_ELEVATION","REJECT_OR_BOUNDED_RUNTIME_ONLY"
]);

test("P0 supervisor bypass inventory is bounded, complete and explicitly unverified",()=>{
 assert.equal(contract.schemaVersion,1);
 assert.equal(contract.contract,"untrusted-supervisor-outbound-admission-v1");
 assert.equal(contract.status,"REFERENCE_ONLY");
 assert.deepEqual(contract.backends,{java:"PENDING",llvm:"PENDING"});
 assert.equal(contract.scenarios.length,required.size);
 const seen=new Set();
 for(const row of contract.scenarios){
  assert.match(row.id,/^[a-z0-9-]{1,64}$/);
  assert.ok(required.has(row.id),"unrecognized scenario "+row.id);
  assert.equal(seen.has(row.id),false,"duplicate "+row.id);
  seen.add(row.id);
  assert.equal(typeof row.path,"string");
  assert.ok(row.path.length>0&&row.path.length<=96);
  assert.ok(decisions.has(row.expected),"unsupported expected invariant");
 }
 assert.deepEqual(seen,required);
 assert.deepEqual(contract.promotion,{
  hostUnitTestsAloneSufficient:false,
  actualGuestExecutionRequired:true,
  exactSourceTreeAndCompilerDigestsRequired:true,
  zeroStepActionsAccepted:false,
  crossBackendParityRequiresBothExecuted:true
 });
});

test("metadata-only scenario inventory cannot be interpreted as passing an attack probe",()=>{
 assert.ok(contract.scenarios.every(row=>!Object.hasOwn(row,"passed")));
 assert.ok(contract.scenarios.every(row=>!Object.hasOwn(row,"verified")));
 assert.ok(contract.scenarios.every(row=>!Object.hasOwn(row,"releaseCertified")));
});
