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
