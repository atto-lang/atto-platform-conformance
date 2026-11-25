#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

export const BACKENDS = Object.freeze(["java","llvm","wasm","cranelift","net"]);
const STATUSES = new Set(["NOT_EXECUTED","UNSUPPORTED","FAIL","PASS","EXPECTED_REJECT"]);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VALID_KINDS = new Set(["runtime","compile","fault","security","abi"]);

export function verifyActorSyncContract(contract) {
  assert.equal(contract?.schemaVersion,1,"actor-sync schemaVersion");
  assert.equal(contract.contract,"oreslang-actor-sync-v1");
  assert.deepEqual(contract.targetBackends,BACKENDS,"backend order and completeness");
  assert.equal(contract.status,"candidate-unattested","no unverified promotion");
  assert.equal(contract.languageRules?.virtualActors,"opt-in, existing spawn lifecycle preserved");
  assert.equal(contract.languageRules?.effectMethod,"suspends fnc; critical bodies never suspend");
  assert.equal(contract.languageRules?.stateWrites,"single authoritative writer fenced by durable epoch and revision");
  assert.equal(contract.acceptance?.hostOnlyTestsCountAsGuestParity,false);
  assert.equal(contract.acceptance?.zeroStepGhaCountsAsEvidence,false);
  assert.equal(contract.acceptance?.syntaxRejectionCountsAsGuestParity,false);
  assert.equal(contract.acceptance?.privateSourceTransferRequiresAuthorization,true);
  assert.equal(contract.acceptance?.runtimePassNeedsCompilerSourceTreeAndGuestReceipts,true);
  assert.equal(contract.acceptance?.parallelBackendsCannotInheritEachOthersPass,true);
  assert.equal(contract.acceptance?.nativeGuestMustExecute,true);
  assert.equal(contract.acceptance?.compilerBinarySha256,true);
  assert.equal(contract.acceptance?.observedJobSteps,true);
  assert.equal(contract.acceptance?.sourceTreesExactHead,true);
  assert.ok(Array.isArray(contract.scenarios) && contract.scenarios.length>=25,"scenario floor");
  assert.deepEqual(Object.keys(contract.implementationStatus||{}), BACKENDS, "implementation status backends");
  const ids = new Set();
  for (const s of contract.scenarios) {
    assert.match(s.id,/^AS(?:0[1-9]|1[0-9]|2[0-9])$/,"scenario id");
    assert.ok(!ids.has(s.id),"duplicate scenario: "+s.id);
    ids.add(s.id);
    assert.ok(VALID_KINDS.has(s.kind),"scenario kind "+s.id);
    assert.ok(typeof s.oracle==="string" && s.oracle.length>=12);
    assert.deepEqual(Object.keys(s.backendStatus||{}),BACKENDS,"status mapping "+s.id);
    assert.deepEqual(Object.keys(s.evidence||{}),BACKENDS,"evidence mapping "+s.id);
    for (const b of BACKENDS) {
      const st = s.backendStatus[b], proof=s.evidence[b];
      assert.ok(STATUSES.has(st),"unknown "+b+" status in "+s.id);
      if (st==="NOT_EXECUTED" || st==="UNSUPPORTED") {
        assert.equal(proof,null,"unexecuted/unsupported cannot carry forged execution receipt");
        continue;
      }
      if (st==="PASS" || st==="EXPECTED_REJECT") {
        assert.ok(proof && typeof proof==="object", "missing guest evidence "+b+"/"+s.id);
        assert.equal(proof.kind,"native-oreslang-guest");
        assert.match(proof.sourceCommitSha||"",SHA40);
        assert.match(proof.sourceTreeSha||"",SHA40);
        assert.match(proof.compilerSha256||"",SHA256);
        assert.match(proof.runtimeSha256||"",SHA256);
        assert.ok(Number.isInteger(proof.executedSteps) && proof.executedSteps>0,"zero-step receipt");
        assert.ok(typeof proof.rawLogUrl==="string" && /^https:\/\//.test(proof.rawLogUrl),"raw step log required");
        assert.ok(typeof proof.observedOracle==="string" && proof.observedOracle.length>0);
        assert.ok(proof.pinnedFixtureSha256 && SHA256.test(proof.pinnedFixtureSha256));
      } else if (proof!==null) {
        assert.equal(proof.kind,"native-oreslang-guest","failed host tests cannot count as guest");
      }
      if (st==="EXPECTED_REJECT") assert.ok(["compile","security","abi"].includes(s.kind),
        "positive execution case cannot pass merely by rejecting syntax");
    }
  }
  for(let i=1;i<=25;i++) assert.ok(ids.has("AS"+String(i).padStart(2,"0")),"missing AS case "+i);
  const as24=contract.scenarios.find(s=>s.id==="AS24");
  const as25=contract.scenarios.find(s=>s.id==="AS25");
  assert.equal(as24.kind,"runtime","AS24 must execute source");
  assert.equal(as24.oracle,
    "identical AttoLang .atto guest source executes across five backends; transitional .ores tests alone do not establish .atto parity",
    "AS24 AttoLang extension parity contract changed");
  assert.equal(as25.kind,"fault","AS25 is a durable restart/fence scenario");
  assert.equal(as25.oracle,
    "new actor epoch poisons durable replica cursor across process restart; reads and old/new deltas reject until authenticated full snapshot resync",
    "AS25 maximum epoch and recovery security contract changed");
  assert.equal(contract.implementationStatus.cranelift.actorGuest,"UNSUPPORTED",
    "Cranelift scalar-only source stage must not claim guest actors");
  return {contract:contract.contract,scenarioCount:ids.size,backendCount:BACKENDS.length,
    verifiedGuestPasses:contract.scenarios.reduce((n,s)=>n+BACKENDS.filter(b=>s.backendStatus[b]==="PASS").length,0)};
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const source = readFileSync(new URL("../contracts/actor-sync-v1.json",import.meta.url),"utf8");
  const result = verifyActorSyncContract(JSON.parse(source));
  process.stdout.write("ACTOR_SYNC_CONTRACT_INVENTORY_ONLY "+JSON.stringify(result)+"\n");
}
