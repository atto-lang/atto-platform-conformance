const BACKENDS=Object.freeze(["java","llvm","wasm","cranelift","net"]);
const SHA=/^[0-9a-f]{40}$/;
const RUN=/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[1-9][0-9]*$/;
const fail=msg=>{throw new Error("INVALID_PUBSUB_PORTABLE_V1_EVIDENCE: "+msg);};

export function validatePubSubEvidence(ledger) {
  if (!ledger || ledger.schema!=="oreslang.actor_pubsub.portable.evidence.v1")
    fail("schema");
  if (ledger.contract!=="contracts/v1/actor-pubsub/portable-v1.json")
    fail("contract");
  if (!Array.isArray(ledger.records) || ledger.records.length!==BACKENDS.length)
    fail("backend count");
  const found=new Set();
  let passed=0;
  for (const record of ledger.records) {
    if (!record || !BACKENDS.includes(record.backend) || found.has(record.backend))
      fail("wrong or duplicate backend");
    found.add(record.backend);
    const gates=["source_compilation","runtime_substrate","guest_execution"];
    for (const gate of gates)
      if (!["NOT_EXECUTED","PASS"].includes(record[gate]))
        fail(record.backend+" invalid "+gate);
    const succeeded=gates.every(g=>record[g]==="PASS");
    const somePass=gates.some(g=>record[g]==="PASS");
    if (somePass) {
      if (!SHA.test(record.source_sha??"") || !SHA.test(record.tree_sha??"") ||
          !RUN.test(record.run_url??"") ||
          !Number.isSafeInteger(record.executed_steps) || record.executed_steps<1)
        fail(record.backend+" missing exact SHA or nonzero GitHub Actions steps");
      if (typeof record.guest_trace!=="string" ||
          !/^evidence\/[a-zA-Z0-9._/-]+\.json$/.test(record.guest_trace) ||
          record.guest_trace.includes(".."))
        fail(record.backend+" missing bounded guest trace artifact");
    } else if (record.executed_steps!==0 || record.guest_trace!==null) {
      fail(record.backend+" unexecuted must not claim steps or guest trace");
    }
    if (record.guest_execution==="PASS" && !succeeded)
      fail(record.backend+" guest PASS requires source and runtime gates");
    if (succeeded) passed++;
  }
  const certified=passed===BACKENDS.length;
  if (ledger.parity_certified!==certified ||
      ledger.release_ready!==certified)
    fail("certification flag does not match five completed gates");
  return {ok:true,backends:BACKENDS.length,verified:passed,
    parity_certified:certified,release_ready:certified};
}
