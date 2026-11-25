import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifyLedger} from "../bin/verify-critical-backend-ledger.mjs";
const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
const contract = await load("../contracts/v1/critical-suspension-v1.json");
const ledger = await load("../evidence/critical-suspends-backend-evidence-20261101.json");
test("five exact backend heads remain zero-step NOT_EXECUTED", () => {
  assert.deepEqual(verifyLedger(ledger, contract), {backends:5,classification:"NOT_EXECUTED"});
});
test("failed admission cannot be mislabeled as guest parity", () => {
  for (const tamper of [{execution:"PASS"},{guest_parity_verified:true},{executed_steps:1}]) {
    const copy = structuredClone(ledger);
    Object.assign(copy.entries[0],tamper);
    assert.throws(() => verifyLedger(copy, contract), /zero-step/);
  }
});
test("missing, forged and duplicate backend identity is rejected", () => {
  for (const tamper of [{commit:"wrong"},{tree:"wrong"},{run_id:0},{job_id:0},
    {backend:"llvm"},{repository:"bad/repo"}]) {
    const copy = structuredClone(ledger);
    Object.assign(copy.entries[0],tamper);
    assert.throws(() => verifyLedger(copy, contract));
  }
});
