import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = JSON.parse(readFileSync(
  new URL("../docs/security/private-ci-incident-disposition-review-v1.json", import.meta.url),
  "utf8",
));
const packet = readFileSync(
  new URL("../docs/security/PRIVATE_CI_EIGHT_INCIDENT_DISPOSITION_REVIEW.md", import.meta.url),
  "utf8",
);
const claimgraphPacket = readFileSync(
  new URL("../docs/security/P0_PRIVATE_CARRIER_CLASSIFICATION_198_200_2026-10-30.md", import.meta.url),
  "utf8",
);
const hnptPacket = readFileSync(
  new URL("../docs/security/P0_PRIVATE_CARRIER_CLASSIFICATION_252_2026-10-31.md", import.meta.url),
  "utf8",
);

const expected = [
  { number: 22, issue_id: 5832921751, status: "hold" },
  { number: 77, issue_id: 5904679716, status: "hold" },
  { number: 127, issue_id: 5935338521, status: "hold" },
  { number: 171, issue_id: 6042555082, status: "hold" },
  { number: 172, issue_id: 6042602777, status: "hold" },
  { number: 198, issue_id: 6070465058, status: "hold" },
  { number: 200, issue_id: 6071264936, status: "hold" },
  { number: 252, issue_id: 6129229261, status: "hold" },
];

test("eight-incident registry is exact and non-authorizing", () => {
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
    expected,
  );
  assert.equal(new Set(registry.incidents.map((entry) => entry.number)).size, expected.length);
  assert.ok(registry.incidents.every((entry) => entry.status === "hold"));
  assert.ok(registry.incidents.every((entry) => typeof entry.packet === "string" && entry.packet.length > 0));
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
  assert.match(packet, /All eight incidents remain `hold`/);
  assert.match(packet, /No source transfer is authorized/);
  for (const number of expected.map(({ number }) => number)) {
    assert.match(packet, new RegExp("#" + number));
  }
  assert.match(packet, /PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#<NUMBER>/);
  assert.match(packet, /fresh GitHub-hosted capacity proof/);
});

test("ClaimGraph packet binds both incidents without authorizing transfer", () => {
  assert.match(claimgraphPacket, /#198/);
  assert.match(claimgraphPacket, /6070465058/);
  assert.match(claimgraphPacket, /#200/);
  assert.match(claimgraphPacket, /6071264936/);
  assert.match(claimgraphPacket, /ClaimGraph-test\/claimgraph-e2e/);
  assert.match(claimgraphPacket, /1350751074/);
  assert.match(claimgraphPacket, /No source transfer is authorized/);
});

test("hnpt-e2e packet binds incident 252 and immutable carrier identity", () => {
  assert.match(hnptPacket, /#252/);
  assert.match(hnptPacket, /6129229261/);
  assert.match(hnptPacket, /honeypot-r-us-test\/hnpt-e2e/);
  assert.match(hnptPacket, /1346492776/);
  assert.match(hnptPacket, /8d63d6200cffa93a1731129f533e9ed7f2d9ed3b/);
  assert.match(hnptPacket, /48a9789fa49a59ea6bd398fb46a60dbd3680b4b7/);
  assert.match(hnptPacket, /PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#252/);
  assert.match(hnptPacket, /No source transfer is authorized/);
});
