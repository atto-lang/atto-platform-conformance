import test from "node:test";
import assert from "node:assert/strict";
import {
  loadCompatibilityCandidate, loadCandidateInventory, validateCompatibilityCandidate
} from "../src/compatibility-release.mjs";

const manifest = loadCompatibilityCandidate();
const inventory = loadCandidateInventory();
const altered = update => {
  const next = structuredClone(manifest);
  update(next);
  return next;
};
test("pin all 52 repos while refusing to assert compatibility", () => {
  const result = validateCompatibilityCandidate(manifest, inventory);
  assert.equal(result.repositories, 52);
  assert.equal(result.intendedRelationships, 104);
  assert.equal(result.pinnedCommits, 52);
  assert.equal(result.verifiedCompatibilities, 0);
  assert.equal(result.releaseReady, false);
  assert.equal(result.result, "CANDIDATE_ONLY_NOT_COMPATIBILITY_PROOF");
  assert.equal(new Set(manifest.pins.map(p => p.commit)).size, 52);
});
test("reject unlisted repo", () =>
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[0].name = "outside-project";
  }), inventory), /unknown repository/));
test("reject missing pin", () =>
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins.pop();
  }), inventory), /pin coverage mismatch/));
test("reject duplicate or unsorted pin names", () => {
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[1].name = d.pins[0].name;
  }), inventory), /duplicate, missing, or unsorted/);
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    [d.pins[0], d.pins[1]] = [d.pins[1], d.pins[0]];
  }), inventory), /duplicate, missing, or unsorted/);
});
test("reject truncated or noncanonical Git SHAs", () => {
  for (const bad of ["abc123", "A".repeat(40), "g".repeat(40), null, 12345]) {
    assert.throws(() => validateCompatibilityCandidate(altered(d => {
      d.pins[0].commit = bad;
    }), inventory), /expected full immutable Git commit SHA/);
  }
});
test("reject floating refs and non-main branch heads", () =>
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[0].ref = "feature/unreviewed";
  }), inventory), /unexpected reference/));
test("reject invented verified evidence", () => {
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[0].compatibility = "VERIFIED";
  }), inventory), /forged evidence promotion/);
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[0].evidence = [{run: "https://github.com/example/run/1", status: "success"}];
  }), inventory), /forged evidence promotion/);
});
test("refuse release or incident gate bypass", () => {
  for (const field of ["promotionState", "securityIncident", "policy", "kind"]) {
    assert.throws(() => validateCompatibilityCandidate(altered(d => {
      d[field] = "READY";
    }), inventory), /non-promotable policy/);
  }
});
test("reject malformed metadata and unknown additional fields", () => {
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[0].environment = "production";
  }), inventory), /unexpected or missing properties/);
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.authorization = "yes";
  }), inventory), /unexpected or missing properties/);
});
test("reject catalog version or drift inconsistent with pinned inventory", () => {
  const copy = structuredClone(inventory);
  copy.repositories[0].name = "different-name";
  assert.throws(() => validateCompatibilityCandidate(manifest, copy));
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.snapshotDate = "2026-10-18";
  }), inventory), /non-promotable policy/);
});

test("reject replaced or ambiguous repository identity", () => {
  assert.throws(() => validateCompatibilityCandidate(altered(d => {
    d.pins[0].repositoryId = d.pins[1].repositoryId;
  }), inventory), /invalid or duplicated immutable GitHub repository ID/);
  for (const bad of [null, 0, "0", "1.0", "not-a-github-id"]) {
    assert.throws(() => validateCompatibilityCandidate(altered(d => {
      d.pins[0].repositoryId = bad;
    }), inventory), /invalid or duplicated immutable GitHub repository ID/);
  }
});
