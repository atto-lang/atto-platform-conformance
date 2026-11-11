import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const contract = JSON.parse(readFileSync(new URL("../contracts/http-actor-concurrency-lifecycle-v1.json", import.meta.url), "utf8"));
const backends = ["java", "llvm", "wasm", "forge", "net"];
const required = Array.from({length:11}, (_, i) => "HA" + String(i+1).padStart(2,"0"));

test("target is exactly five source backends plus the REST demo", () => {
  assert.deepEqual(Object.keys(contract.scope.sourceRepositories).sort(), [...backends].sort());
  for (const backend of backends) {
    assert.equal(contract.scope.sourceRepositories[backend], "ores-truffle-oreslang/oreslang-source." + backend);
  }
  assert.equal(contract.scope.restDemo, "ores-truffle-oreslang/oreslang-demo-restful-server");
});
test("serial alias and explicit metadata retain the one-by-one contract", () => {
  assert.match(contract.sourceContract.serialAlias, /define serial http actor/);
  assert.match(contract.sourceContract.explicitOneOne, /requestConcurrency = 1/);
  assert.match(contract.sourceContract.explicitOneOne, /messageConcurrency = 1/);
  assert.deepEqual(contract.sourceContract.normalizedMetadata, {transport:"HTTP",requestConcurrency:1,messageConcurrency:1});
  assert.match(contract.sourceContract.semantics.actorExecution, /at most one physical guest turn/);
  assert.match(contract.sourceContract.semantics.gracefulDrain, /Seal new HTTP request admissions/);
  assert.match(contract.sourceContract.semantics.forcedStop, /Seal both request and message admission/);
  assert.match(contract.sourceContract.semantics.dispatchHandoff, /non-reusable dispatch-handoff lease/);
  assert.match(contract.sourceContract.semantics.listenerCarrierBarrier,
    /all exchange-completion Future callbacks returned/);
  assert.match(contract.sourceContract.semantics.listenerCarrierBarrier,
    /bounded explicit timeout/);
  assert.match(contract.sourceContract.semantics.forceCloseArbitration,
    /single winning owner/);
});
test("exact mandatory compiler, ownership, shutdown and E2E case inventory", () => {
  assert.deepEqual(contract.cases.map(x=>x.id), required);
  assert.equal(new Set(contract.cases.map(x=>x.name)).size, required.length);
  // A generic letters-only regexp incorrectly rejects the required
  // guest-e2e cases, silently blocking acceptance once CI actually runs.
  // Enumerate semantic evidence classes rather than accepting arbitrary tags.
  const allowedKinds = new Set([
    "compiler", "compiler-negative", "guest-runtime", "guest-security", "guest-e2e"
  ]);
  assert.ok(contract.cases.every(x=>x.oracle.length > 55 && allowedKinds.has(x.kind)));
  assert.ok(contract.cases.some(x=>x.name==="shutdown-physical-exit"));
  assert.ok(contract.cases.some(x=>x.name==="nonserial-denial"));
  assert.ok(contract.cases.some(x=>x.name==="aot-provenance"));
});
test("no source/host-only evidence self-certifies any backend", () => {
  assert.equal(contract.status, "NOT_CERTIFIED");
  for (const backend of backends) {
    const entry=contract.backendEvidence[backend];
    assert.ok(entry);
    for (const k of ["compilerProducedHttpActorGuest","httpLoopbackGuestExecution","physicalShutdownGuestExecution","fullAotGuestExecution"]) {
      assert.equal(entry[k],"NOT_VERIFIED");
    }
    assert.equal(entry.evidence,null);
  }
  assert.equal(contract.demoEvidence.compiledSourceHttpActor,"NOT_VERIFIED");
  assert.equal(contract.demoEvidence.stepfulRealHttpExecutionAtExactHead,"NOT_VERIFIED");
  assert.equal(contract.demoEvidence.hostRouteChecks,"SEPARATE_HOST_ONLY_EVIDENCE");
});
test("promotion gate rejects zero-step, synthetic, historical and host-only receipts", () => {
  const gate=contract.promotionGate;
  for (const [key,value] of Object.entries(gate)) {
    assert.equal(value, !key.startsWith("allow"),key);
  }
});

test("canonical .atto fixture SHA-1 Git blobs and Java resources are pinned", () => {
  const fixtures=contract.sourceContract.canonicalFixtures;
  assert.deepEqual(Object.keys(fixtures).sort(),
    ["serialOneOne","explicitOneOne","unsupportedThreeFour"].sort());
  const texts={};
  for(const [name,entry] of Object.entries(fixtures)) {
    assert.match(entry.path,/^fixtures\/http-actor-v1\/[a-z0-9-]+\.atto$/);
    assert.equal(entry.javaResource,
      entry.path.replace(/^fixtures\//,"src/test/resources/"));
    assert.match(entry.gitBlobSha,/^[0-9a-f]{40}$/);
    const source=readFileSync(new URL("../"+entry.path,import.meta.url),"utf8");
    const gitBlob=createHash("sha1")
      .update("blob "+Buffer.byteLength(source,"utf8")+"\0")
      .update(source,"utf8").digest("hex");
    assert.equal(gitBlob,entry.gitBlobSha,"fixture drift for "+name);
    assert.match(source,/define pub (serial )?http actor Endpoint as/);
    assert.match(source,/receive\(ActorMail<int> mail\): void/);
    assert.ok(!source.includes(".ores"),"new guest fixtures must use AttoLang");
    texts[name]=source;
  }
  assert.ok(!texts.serialOneOne.includes("requestConcurrency"));
  assert.match(texts.explicitOneOne,/requestConcurrency = 1;/);
  assert.match(texts.explicitOneOne,/messageConcurrency = 1;/);
  assert.match(texts.unsupportedThreeFour,/requestConcurrency = 3;/);
  assert.match(texts.unsupportedThreeFour,/messageConcurrency = 4;/);
  // This is a *file integrity* gate, not a compiler/runtime receipt.
  assert.equal(contract.backendEvidence.java.compilerProducedHttpActorGuest,"NOT_VERIFIED");
});
