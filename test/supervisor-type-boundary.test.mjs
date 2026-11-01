import test from "node:test";
import assert from "node:assert/strict";
import {readSupervisorTypeContract, validateSupervisorTypeContract} from "../bin/validate-supervisor-type-contract.mjs";

const clone = value => structuredClone(value);
test("static supervisor type contract enumerates all five backends without guest claims", () => {
  const actual = validateSupervisorTypeContract(readSupervisorTypeContract());
  assert.deepEqual(actual, {cases:16, backends:5, status:"static-fixture-contract-only"});
});
test("parity claims fail closed on fabricated guest execution", () => {
  const input = readSupervisorTypeContract();
  for (const backend of input.backends) {
    const mutant = clone(input);
    mutant.backendGate[backend].guestSourceParity = true;
    assert.throws(() => validateSupervisorTypeContract(mutant), /guest execution must remain denied/);
  }
});
test("unverified or missing backend cannot silently become supported", () => {
  const original = readSupervisorTypeContract();
  for (const mutate of [
    x=>x.backends.pop(),
    x=>x.cases.pop(),
    x=>x.cases[4].id=x.cases[3].id,
    x=>x.cases[0].javaParser="reject",
    x=>x.cases[12].javaParser="accept",
    x=>x.requiredEvidence.pop(),
    x=>x.guestSupervisorExecution="verified",
    x=>x.evidencePRs.wasm="",
    x=>x.backendGate.net.normalCompiler="accept"
  ]) {
    const mutant=clone(original);
    mutate(mutant);
    assert.throws(() => validateSupervisorTypeContract(mutant));
  }
});
