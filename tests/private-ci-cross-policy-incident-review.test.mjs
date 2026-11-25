import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This is an OFFLINE review-only shape test, NOT an exporter or a policy grant.
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const report = read("../docs/security/private-ci-cross-policy-incident-review-v1.json");
const existing = read("../docs/security/private-ci-incident-disposition-review-v1.json");
const llvmGates = [22, 77, 127, 212, 222];
const conformanceGates = [22, 77, 127, 171, 172, 198, 200, 252];
const expected = [
  [22, 5832921751], [77, 5904679716], [127, 5935338521],
  [171, 6042555082], [172, 6042602777],
  [198, 6070465058], [200, 6071264936],
  [212, 6087989978], [222, 6092501448], [252, 6129229261],
];
const union = [...new Set([...llvmGates, ...conformanceGates])].sort((a, b) => a - b);
function validate(r, c = existing) {
  if (r.schema !== "oreslang-private-ci-cross-policy-incident-review-v1" ||
      r.classification !== "NON_AUTHORIZING_REVIEW_ONLY" ||
      r.source_transfer_authorized !== false)
    throw Error("cross-policy review must never authorize transfer");
  if (r.incident_repository !== "ores-truffle-oreslang/oreslang-platform-conformance")
    throw Error("unexpected issue authority");
  if (JSON.stringify(r.independent_reviewer) !==
      JSON.stringify({ login: "ORESoftware", user_id: 11139560 }))
    throw Error("independent reviewer identity drift");
  if (JSON.stringify(r.sources.llvm.incident_numbers) !== JSON.stringify(llvmGates))
    throw Error("LLVM five-gate evidence drift");
  if (JSON.stringify(r.sources.conformance.incident_numbers) !==
      JSON.stringify(conformanceGates))
    throw Error("conformance eight-gate evidence drift");
  if (JSON.stringify(c.incidents.map(x => [x.number, x.issue_id])) !==
      JSON.stringify(expected.filter(x => conformanceGates.includes(x[0]))))
    throw Error("existing eight-gate registry mismatch");
  if (JSON.stringify(r.incidents.map(x => [x.number, x.issue_id])) !==
      JSON.stringify(expected))
    throw Error("cross-policy incident identity drift");
  if (JSON.stringify(r.incidents.map(x => x.number)) !== JSON.stringify(union))
    throw Error("missing cross-policy union member");
  for (const row of r.incidents) {
    const gates = [
      ...(llvmGates.includes(row.number) ? ["llvm"] : []),
      ...(conformanceGates.includes(row.number) ? ["conformance"] : []),
    ];
    if (JSON.stringify(row.gates) !== JSON.stringify(gates) ||
        row.observed_state !== "open" || row.review_status !== "hold")
      throw Error("incident readiness must fail closed");
  }
  if (r.closure_requires.state !== "closed" ||
      r.closure_requires.state_reason !== "completed" ||
      r.closure_requires.closed_by_login !== "ORESoftware" ||
      r.closure_requires.closed_by_user_id !== 11139560 ||
      r.closure_requires.independent_incident_specific_disposition !== true ||
      r.closure_requires.protected_source_main_review !== true)
    throw Error("independent closure contract weakened");
  if (!Array.isArray(r.unmet_external_gates) || r.unmet_external_gates.length < 6)
    throw Error("approval prerequisites omitted");
  return true;
}
const clone = () => structuredClone(report);

test("ten-incident union is exact, metadata-only, and holds every entry", () => {
  assert.equal(union.length, 10);
  assert.equal(validate(report), true);
  assert.equal(report.incidents.filter(x => x.gates.length === 2).length, 3);
  assert.deepEqual(report.incidents.filter(x => x.gates.length === 1 && x.gates[0] === "llvm")
    .map(x => x.number), [212, 222]);
});
test("independent existing eight-incident registry stays HOLD", () => {
  assert.ok(existing.incidents.every(x => x.status === "hold"));
  assert.equal(existing.source_transfer_authorized, false);
});
for (const [label, mutation] of [
  ["export authorizing", r => { r.source_transfer_authorized = true; }],
  ["authorization status mutated", r => { r.classification = "APPROVED"; }],
  ["missing #212", r => { r.incidents = r.incidents.filter(x => x.number !== 212); }],
  ["missing #222", r => { r.sources.llvm.incident_numbers.pop(); }],
  ["missing #252", r => { r.incidents.pop(); }],
  ["forged issue id", r => { r.incidents[0].issue_id = 1; }],
  ["duplicate issue", r => { r.incidents[9] = r.incidents[8]; }],
  ["marked closed without evidence", r => { r.incidents[0].observed_state = "closed"; }],
  ["unreviewed issue readiness", r => { r.incidents[0].review_status = "approved"; }],
  ["reviewer impersonation", r => { r.independent_reviewer.user_id = 1; }],
  ["unprotected closure", r => { r.closure_requires.protected_source_main_review = false; }],
  ["wrong gate membership", r => { r.incidents[7].gates = ["conformance"]; }],
  ["omitted prerequisites", r => { r.unmet_external_gates = []; }],
]) {
  test("fail closed: " + label, () => {
    const altered = clone();
    mutation(altered);
    assert.throws(() => validate(altered));
  });
}
