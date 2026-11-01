import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {validatePubSubEvidence} from "../src/actor-pubsub-evidence-v1.mjs";

const ledger=JSON.parse(await readFile(
  new URL("../contracts/v1/actor-pubsub/backend-status.pending.json",import.meta.url),
  "utf8"));
const copy=()=>structuredClone(ledger);

test("all five independent backends remain NOT_EXECUTED",()=>{
  const result=validatePubSubEvidence(copy());
  assert.deepEqual(ledger.records.map(x=>x.backend),
    ["java","llvm","wasm","cranelift","net"]);
  assert.equal(result.verified,0);
  assert.equal(result.parity_certified,false);
  assert.equal(result.release_ready,false);
});

test("rejects duplicate backend or forged full-parity flag",()=>{
  const duplicate=copy();duplicate.records[4].backend="java";
  assert.throws(()=>validatePubSubEvidence(duplicate),/INVALID_PUBSUB_PORTABLE_V1_EVIDENCE/);
  const forged=copy();forged.parity_certified=true;
  assert.throws(()=>validatePubSubEvidence(forged),/INVALID_PUBSUB_PORTABLE_V1_EVIDENCE/);
});

test("rejects source/runtime claims without exact provenance and nonzero steps",()=>{
  const zero=copy();zero.records[0].runtime_substrate="PASS";
  assert.throws(()=>validatePubSubEvidence(zero),/nonzero GitHub Actions steps/);
  const fake=copy();fake.records[0].executed_steps=1;
  assert.throws(()=>validatePubSubEvidence(fake),/unexecuted/);
});

test("rejects guest PASS without source compiler and runtime gates",()=>{
  const forged=copy(),r=forged.records[0];
  r.guest_execution="PASS";
  r.source_sha="a".repeat(40);r.tree_sha="b".repeat(40);
  r.run_url="https://github.com/org/repo/actions/runs/1234";
  r.executed_steps=2;r.guest_trace="evidence/pubsup-java.json";
  assert.throws(()=>validatePubSubEvidence(forged),/guest PASS requires source/);
});

test("one fully grounded backend is not full five-backend parity",()=>{
  const partiallyVerified=copy(),r=partiallyVerified.records[0];
  r.source_compilation="PASS";
  r.runtime_substrate="PASS";
  r.guest_execution="PASS";
  r.source_sha="a".repeat(40);r.tree_sha="b".repeat(40);
  r.run_url="https://github.com/org/repo/actions/runs/1234";
  r.executed_steps=4;r.guest_trace="evidence/pubsub-java.json";
  assert.equal(validatePubSubEvidence(partiallyVerified).verified,1);
  assert.equal(validatePubSubEvidence(partiallyVerified).parity_certified,false);
});
