import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = JSON.parse(readFileSync(
  new URL("../docs/security/private-ci-incident-disposition-review-v1.json", import.meta.url),
  "utf8",
));
const packet = readFileSync(
  new URL("../docs/security/PRIVATE_CI_FIVE_INCIDENT_DISPOSITION_REVIEW.md", import.meta.url),
  "utf8",
);

test("five-incident registry is exact and non-authorizing", () => {
  assert.equal(registry.schema, "oreslang-private-ci-incident-disposition-review-v1");
  assert.equal(registry.status, "NON_AUTHORIZING_REVIEW_ONLY");
  assert.equal(registry.incident_repository, "ores-truffle-oreslang/oreslang-platform-conformance");
  assert.equal(registry.incident_repository_id, 1413795502);
  assert.deepEqual(registry.independent_reviewer, { login: "ORESoftware", user_id: 11139560 });
  assert.equal(registry.source_transfer_authorized, false);
  assert.equal(
    registry.resolution_marker_template,
    "PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#{issue}",
  );
  assert.deepEqual(
    registry.incidents.map(({ number, issue_id, status }) => ({ number, issue_id, status })),
    [
      { number: 22, issue_id: 5832921751, status: "hold" },
      { number: 77, issue_id: 5904679716, status: "hold" },
      { number: 127, issue_id: 5935338521, status: "hold" },
      { number: 171, issue_id: 6042555082, status: "hold" },
      { number: 172, issue_id: 6042602777, status: "hold" },
    ],
  );
  assert.ok(registry.incidents.every((entry) => entry.status === "hold"));
});

test("closure contract requires same independent identity and protected registry update", () => {
  assert.deepEqual(registry.closure_contract, {
    issue_state: "closed",
    state_reason: "completed",
    closed_by_login: "ORESoftware",
    closed_by_user_id: 11139560,
    pinned_exact_resolution_comment_required: true,
    registry_must_be_updated_on_protected_source_main: true,
  });
  assert.equal(registry.required_independent_disposition_fields.length, 9);
});

test("review packet cannot be mistaken for transfer authorization", () => {
  assert.match(packet, /NON-AUTHORIZING \/ REVIEW ONLY/);
  assert.match(packet, /All five incidents remain `hold`/);
  assert.match(packet, /No source transfer is authorized/);
  for (const number of [22, 77, 127, 171, 172]) {
    assert.match(packet, new RegExp("#" + number));
  }
  assert.match(packet, /PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#<NUMBER>/);
  assert.match(packet, /protected source `main`/);
});
