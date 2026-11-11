#!/usr/bin/env node
// Inventory/provenance gate only, not a backend or formal guest execution.
import {readFileSync} from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const backendNames = ["java", "llvm", "net", "wasm", "forge"];
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
        !/^[0-9a-f]{40}$/.test(candidate.head))
      fail("invalid repository / PR / exact SHA provenance");
    if (candidate.host_execution_receipt !== null ||
        candidate.compiled_guest_execution_receipt !== null ||
        candidate.physical_release_attestation !== null ||
        candidate.hosted_ci_job_steps !== null)
      fail("unauthenticated execution or release receipt");
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
  if (!gates || gates.host_runtime !== "NOT_EXECUTED" ||
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
  m => { m.candidates[1].pr_url = "https://example.com/wrong"; }
];
for (const edit of mutants) mutant(edit);
console.log("PASS supervisor five-backend parity inventory: backends=5 cases=8 mutations=7 certification=NOT_CERTIFIED");
