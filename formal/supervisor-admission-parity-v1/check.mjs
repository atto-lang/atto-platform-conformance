#!/usr/bin/env node
// Inventory/provenance gate only, not a backend or formal guest execution.
import {readFileSync} from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const backendNames = ["java", "llvm", "net", "wasm", "forge"];
// Reviewed PR/head snapshot. A 40-character hash shape alone is not source
// provenance. An updated PR must be independently inspected and both this
// checker and manifest revised before a new exact-head receipt is accepted.
const expected = Object.freeze({
  java: {pr: 2785, head: "a027e09060c5184402775451b2305bac623257f7"},
  llvm: {pr: 1697, head: "4523a1c2262b49b9aa91c9b81230021126f78477"},
  net: {pr: 485, head: "81f7f4538691beb2c69bd679777a3830765217cf"},
  wasm: {pr: 475, head: "5c8f9528e2acbebe954dad60e0965056ca0ed4bd"},
  forge: {pr: 266, head: "16340785bbebc372cf7dcdf2b574d99aac608edb"}
});
const caseNames = [
  "post_fence_data_admission", "pre_fence_inflight_accounting",
  "stale_generation_denial", "physical_release_before_restart",
  "healthy_sibling_isolation", "atomic_supervised_child_publish",
  "actor_failure_control_hooks", "compiled_guest_aot"
];
function validate(m) {
  const fail = reason => { throw new Error(reason); };
  if (m?.schema !== "attolang.supervisor_admission_parity.v1" ||
      m.classification !== "UNVERIFIED_IMPLEMENTATION_CANDIDATES")
    fail("unsupported parity evidence schema/status");
  if (!Array.isArray(m.scenarios) || m.scenarios.length !== 8 ||
      m.scenarios.some((s, i) => s.id !== "S0" + (i + 1) ||
        s.name !== caseNames[i]))
    fail("missing, extra or reordered parity scenario");
  if (!Array.isArray(m.candidates) || m.candidates.length !== 5)
    fail("five compiler backends are required");
  const seen = new Set();
  for (const candidate of m.candidates) {
    if (!backendNames.includes(candidate.backend) || seen.has(candidate.backend))
      fail("duplicate, missing or unknown backend");
    seen.add(candidate.backend);
    const repo = "ores-truffle-oreslang/oreslang-source." + candidate.backend;
    if (candidate.repository !== repo ||
        !Number.isSafeInteger(candidate.pr) || candidate.pr < 1 ||
        candidate.pr_url !== "https://github.com/" + repo + "/pull/" + candidate.pr ||
        !/^[0-9a-f]{40}$/.test(candidate.head) ||
        candidate.pr !== expected[candidate.backend]?.pr ||
        candidate.head !== expected[candidate.backend]?.head)
      fail("unreviewed PR identity or exact source HEAD");
    if (candidate.host_execution_receipt !== null ||
        candidate.compiled_guest_execution_receipt !== null ||
        candidate.physical_release_attestation !== null ||
        candidate.hosted_ci_job_steps !== null)
      fail("unauthenticated execution or release receipt");
    if (Object.keys(candidate.coverage ?? {}).length !== 8)
      fail("unknown extra or missing backend evidence scenario");
    for (let i = 1; i <= 8; i++) {
      const id = "S0" + i;
      const tag = candidate.coverage?.[id];
      if (!["AUTHORED_HOST","ACTOR_LOCAL_HOST_ONLY","SYNTHETIC_RELEASE_ONLY",
            "HOST_WORKER_ONLY","PARTIAL_HOST","FAIL_CLOSED_UNIMPLEMENTED",
            "UNIMPLEMENTED","NOT_EXECUTED"].includes(tag))
        fail("unknown/missing/unsupported evidence claim " + id);
    }
  }
  const gates = m.stages;
  const stageNames = ["host_runtime","compiled_guest","native_release",
    "formal_refinement","five_backend_parity"];
  if (!gates || Object.keys(gates).length !== stageNames.length ||
      stageNames.some(name => !Object.hasOwn(gates, name)))
    fail("unexpected or missing stage evidence field");
  if (gates.host_runtime !== "NOT_EXECUTED" ||
      gates.compiled_guest !== "NOT_EXECUTED" ||
      gates.native_release !== "NOT_CERTIFIED" ||
      gates.formal_refinement !== "NOT_CERTIFIED" ||
      gates.five_backend_parity !== "NOT_CERTIFIED")
    fail("test source is not certification evidence");
  return true;
}
validate(manifest);
const mutant = transform => {
  const changed = JSON.parse(JSON.stringify(manifest));
  transform(changed);
  try { validate(changed); }
  catch { return true; }
  throw new Error("unsafe parity provenance mutation was accepted");
};
const mutants = [
  m => { m.candidates[1].backend = "java"; },
  m => { m.scenarios.pop(); },
  m => { m.candidates[2].host_execution_receipt = "fabricated"; },
  m => { m.stages.five_backend_parity = "PASS"; },
  m => { m.candidates[3].head = "not-a-sha"; },
  m => { m.candidates[4].coverage.S06 = "PASS"; },
  m => { m.candidates[1].pr_url = "https://example.com/wrong"; },
  m => { m.candidates[0].head = "f".repeat(40); },
  m => { m.candidates[2].coverage.S09 = "PASS"; },
  m => { m.stages.compiled_guest_executes = "PASS"; }
];
for (const edit of mutants) mutant(edit);
console.log("PASS supervisor five-backend parity inventory: backends=5 cases=8 mutations=10 certification=NOT_CERTIFIED");
