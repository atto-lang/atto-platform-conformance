import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateIssueIntake, validateExternalBoundaries} from "../src/external-admission.mjs";

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const issues = readJson("../integration/ores-cross-org-100-issues-2026-10-18.json");
const external = readJson("../integration/external-contract-boundaries.v1.json");
const registry = readJson("../integration/repositories.json");
const copy = value => structuredClone(value);

test("100 actual issue URLs have distinct in-scope, non-executable intake status", () => {
  const result = validateIssueIntake(issues);
  assert.deepEqual(result, {issues: 100, repositories: 37, organizations: 2});
});
test("a changed issue URL, duplicate, closed/stale claim or evidence promotion must not pass", () => {
  const mismatched = copy(issues); mismatched.issues[0].url += "/fake";
  assert.throws(() => validateIssueIntake(mismatched), /malformed/);
  const duplicate = copy(issues); duplicate.issues[1].url = duplicate.issues[0].url;
  assert.throws(() => validateIssueIntake(duplicate));
  const claim = copy(issues); claim.issues[0].admission = "verified";
  assert.throws(() => validateIssueIntake(claim), /falsely attested/);
  const run = copy(issues); run.issues[0].execution = "passed";
  assert.throws(() => validateIssueIntake(run), /falsely attested/);
  const outsider = copy(issues); outsider.issues[0].repository = "ORESoftware/api-docs";
  assert.throws(() => validateIssueIntake(outsider), /malformed/);
});
test("all named external seams remain blocked until independent evidence is reviewed", () => {
  const result = validateExternalBoundaries(external, registry);
  assert.deepEqual(result, {boundaries: 12, authorities: 5, status: "blocked"});
});
test("peer TypeSpec/JSON Schema authorities cannot be replaced by generated witnesses", () => {
  const tamper = copy(external); tamper.peerAuthorities[1] = "TypeSpec generated JSON Schema";
  assert.throws(() => validateExternalBoundaries(tamper, registry), /peer authority/);
  const witness = copy(external); witness.derivativeWitnesses[0] = "canonical JSON Schema";
  assert.throws(() => validateExternalBoundaries(witness, registry), /peer authority/);
});
test("reject forged source, workflow, receipt, authorizations, duplicates and unknown repos", () => {
  const cases = [
    x => {x.edges[0].admission = "verified";},
    x => {x.edges[0].sourceCommit = "0".repeat(40);},
    x => {x.edges[0].executedWorkflow = "https://github.com/fake/run/1";},
    x => {x.edges[0].tjsvReceipt = "green";},
    x => {x.edges[0].compilerRuntimeReceipt = "green";},
    x => {x.edges[0].consumer = "random-org/foreign-repo";},
    x => {x.edges[0].authority = "attacker/schema";},
    x => {x.edges[0].boundary = "../bad";},
    x => {x.edges[1] = {...x.edges[0]};},
    x => {x.edges.reverse();},
  ];
  for (const mutate of cases) {
    const tamper = copy(external); mutate(tamper);
    assert.throws(() => validateExternalBoundaries(tamper, registry));
  }
});
