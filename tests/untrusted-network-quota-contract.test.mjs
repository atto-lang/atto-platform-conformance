import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../fixtures/untrusted-network-quota/v1.json", import.meta.url), "utf8"));
const required = new Map([
  [
    "http-ten-in-flight",
    "admit"
  ],
  [
    "http-eleventh-in-flight",
    "too-many-in-flight"
  ],
  [
    "http-ten-starts-per-second",
    "bounded-rate"
  ],
  [
    "http-burst-exhausted",
    "rate-limited"
  ],
  [
    "http-cancel-and-timeout",
    "release-once"
  ],
  [
    "tcp-ten-open",
    "admit"
  ],
  [
    "tcp-eleventh-open",
    "too-many-connections"
  ],
  [
    "tcp-connect-failure",
    "release-once"
  ],
  [
    "tcp-rapid-reconnect",
    "bounded-starts"
  ],
  [
    "http2-and-keepalive",
    "same-egress-gate"
  ],
  [
    "redirect-and-dns",
    "capability-denied"
  ],
  [
    "restart-and-spawn",
    "stable-lineage-quota"
  ],
  [
    "guest-control-mutation",
    "capability-denied"
  ],
  [
    "shutdown-race",
    "release-once"
  ],
  [
    "delayed-cancel-no-token-refund",
    "no-refund-of-published-start-token"
  ],
  [
    "revocation-prevents-commit",
    "deny-new-commit-and-release-slot"
  ],
  [
    "hierarchical-internal-rollback",
    "rollback-unpublished-only"
  ],
  [
    "revoked-hierarchy-all-or-nothing",
    "deny-all-commit"
  ],
  [
    "java-direct-network-entry-denied",
    "broker-required"
  ],
  [
    "http-caller-cancel-does-not-own-host-io",
    "host-owned-completion"
  ],
  [
    "tcp-actual-socket-closure",
    "physical-close-before-release"
  ],
  [
    "monotonic-clock-representation-wrap",
    "bounded-refill"
  ],
  [
    "actor-context-broker-authentication",
    "runtime-provenance-required"
  ],
  [
    "broker-ticket-cap-and-replay",
    "bounded-one-shot-ticket"
  ],
  [
    "no-guest-future-callback-on-host",
    "no-guest-callback-on-host"
  ],
  [
    "actor-termination-cached-ticket",
    "revoked-no-result"
  ],
  [
    "actor-termination-queued-dispatch",
    "no-post-revocation-dispatch"
  ],
  [
    "host-cleanup-capacity-exhausted",
    "bounded-fail-closed"
  ],
  [
    "host-cleanup-retry-exhaustion",
    "bounded-retry-and-capacity-retention"
  ]
]);

function checkContract(doc) {
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.status, "proposal-contract-only-no-backend-execution");
  assert.equal(doc.scope, "supervisor-authorized-untrusted-network-egress");
  assert.deepEqual(doc.defaults, {
    httpMaxInFlight: 10,
    httpRequestStartsPerSecond: 10,
    httpStartBurst: 2,
    tcpMaxActiveConnections: 10,
    tcpConnectionStartsPerSecond: 10,
    tcpStartBurst: 2,
    refundPublishedStartTokens: false
  });
  assert.deepEqual(doc.confirmedBackends, []);
  assert.deepEqual(doc.pendingBackends, ["java-graalvm", "llvm", "wasm", "forge", ".net"]);
  assert.equal(doc.cases.length, required.size);
  const seen = new Set();
  for (const c of doc.cases) {
    assert.equal(typeof c.id, "string");
    assert.ok(required.has(c.id), "unexpected case " + c.id);
    assert.ok(!seen.has(c.id), "duplicate case " + c.id);
    seen.add(c.id);
    assert.equal(c.expected, required.get(c.id));
    assert.ok(typeof c.description === "string" && c.description.length > 50);
    assert.equal(c.backendEvidence, "pending");
    assert.equal(Object.prototype.hasOwnProperty.call(c, "verified"), false);
  }
  assert.deepEqual([...seen].sort(), [...required.keys()].sort());
}

test("host-only egress quotas have a pinned, unverified adversarial contract", () => checkContract(manifest));

test("fail closed if a vector is dropped, renamed, or falsely verified", () => {
  const missing = structuredClone(manifest);
  missing.cases.pop();
  assert.throws(() => checkContract(missing));
  const duplicate = structuredClone(manifest);
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => checkContract(duplicate));
  const premature = structuredClone(manifest);
  premature.confirmedBackends.push("java-graalvm");
  assert.throws(() => checkContract(premature));
  const falseVerdict = structuredClone(manifest);
  falseVerdict.cases[0].backendEvidence = "verified";
  assert.throws(() => checkContract(falseVerdict));
});
