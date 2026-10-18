import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateExternalOresAudit } from "../src/external-ores-integration-audit.mjs";

const campaign = JSON.parse(readFileSync(new URL("../integration/external-ores-100-issues.json", import.meta.url), "utf8"));
const copy = () => structuredClone(campaign);

test("100 distinct open-at-snapshot issues across six orgs and 20+ repositories", () => {
  const result = validateExternalOresAudit(campaign);
  assert.equal(result.status, "metadata-only");
  assert.equal(result.issues, 100);
  assert.equal(result.organizations, 6);
  assert.ok(result.repositories >= 20);
  assert.equal(result.upstreams, 6);
  assert.ok(result.boundaries >= 8);
});

test("reject duplicate, invented or completed issues", () => {
  const x = copy();
  x.issues[1].url = x.issues[0].url;
  assert.throws(() => validateExternalOresAudit(x), /issue URL mismatch or duplicate/);
  const y = copy();
  y.issues[0].status = "verified";
  assert.throws(() => validateExternalOresAudit(y), /artificially completed issue/);
  const z = copy();
  z.issues[0].repository = "ORESoftware/api-docs";
  assert.throws(() => validateExternalOresAudit(z), /outside approved ores-\* organizations/);
});

test("reject relaxing private-source, zero-step CI, and provenance rules", () => {
  for (const [key, value] of [
    ["privateSourceToPublicCarrier", "allowed"],
    ["releaseOnZeroStepCI", "allowed"],
    ["requireImmutablePin", false],
    ["requireRuntimeEvidence", false],
  ]) {
    const x = copy();
    x.securityPolicy[key] = value;
    assert.throws(() => validateExternalOresAudit(x), /fail-closed provenance/);
  }
});

test("reject false authority hierarchy, invented attestations, missing upstream and unbound dependencies", () => {
  const x = copy();
  x.authorityPolicy.precedence = "typespec";
  assert.throws(() => validateExternalOresAudit(x), /independent peers/);
  const y = copy();
  y.upstreams[0].evidence = "passed";
  assert.throws(() => validateExternalOresAudit(y), /falsely attested/);
  const z = copy();
  z.upstreams.pop();
  assert.throws(() => validateExternalOresAudit(z), /upstream list/);
  const q = copy();
  q.boundaries[0].upstream = "ORESoftware/unknown";
  assert.throws(() => validateExternalOresAudit(q), /invalid edge/);
});

test("reject missing upstream blockers and regression in wave allocation", () => {
  const x = copy();
  x.upstreams[0].blocker = null;
  assert.throws(() => validateExternalOresAudit(x), /unresolved upstream gate/);
  const y = copy();
  y.issues[0].wave = 4;
  assert.throws(() => validateExternalOresAudit(y), /wave distribution drift/);
});

test("reject capacity-as-approval and private-carrier bypasses before promotion", () => {
  for (const [key, badValue] of [
    ["privateSourceToUnapprovedPrivateCarrier", "allowed"],
    ["allowRunnerCapacityAsCopyAuthorization", true],
    ["requireProtectedSourceMain", false],
    ["requireReviewedExactSourceTree", false],
    ["requireApprovedPrivateDestination", false],
    ["requireExecutedCompilerSteps", false],
  ]) {
    const malicious = copy();
    malicious.securityPolicy[key] = badValue;
    assert.throws(() => validateExternalOresAudit(malicious), /fail-closed provenance/);
    const omitted = copy();
    delete omitted.securityPolicy[key];
    assert.throws(() => validateExternalOresAudit(omitted), /fail-closed provenance/);
  }
});

test("malicious inventory strings cannot escape into error logs", () => {
  const badUrl = copy();
  badUrl.issues[2].url = "https://example.test/secret/DO_NOT_PRINT\\u001b[31m";
  assert.throws(
    () => validateExternalOresAudit(badUrl),
    error => error.message.includes("ordinal 3") &&
      !error.message.includes("DO_NOT_PRINT") &&
      !error.message.includes("\\u001b"),
  );
  const duplicatedEdge = copy();
  duplicatedEdge.boundaries[1] = structuredClone(duplicatedEdge.boundaries[0]);
  assert.throws(
    () => validateExternalOresAudit(duplicatedEdge),
    error => error.message.includes("duplicate boundary") &&
      !error.message.includes(duplicatedEdge.boundaries[0].consumer),
  );
});

test("runner capacity does not imply real compiler attestation", () => {
  const result = validateExternalOresAudit(campaign);
  assert.equal(result.status, "metadata-only");
  for (const upstream of campaign.upstreams) {
    assert.equal(upstream.evidence, "not-attested");
  }
  assert.equal(campaign.securityPolicy.allowRunnerCapacityAsCopyAuthorization, false);
  assert.equal(campaign.securityPolicy.requireExecutedCompilerSteps, true);
});

test("closed audit inventory rejects invented compiler or CI attestation fields", () => {
  for (const mutate of [
    x => { x.nativeCompilerPassed = true; },
    x => { x.securityPolicy.extraReviewPassed = true; },
    x => { x.authorityPolicy.generatedCompiler = "passed"; },
    x => { x.upstreams[0].runtimeEvidence = "green"; },
    x => { x.boundaries[0].realTransportAdmission = true; },
    x => { x.issues[0].verified = true; },
  ]) {
    const forged = copy();
    mutate(forged);
    assert.throws(() => validateExternalOresAudit(forged),
      /unexpected or missing audit inventory field/);
  }
});
