export function verifyLedger(ledger, contract) {
  if (ledger?.schema !== "oreslang.critical-suspends.backend-evidence/1" ||
      contract?.schema !== "oreslang.critical-suspension.contract/1")
    throw Error("bad evidence contract");
  if (!Array.isArray(ledger.entries) || ledger.entries.length !== 5)
    throw Error("five backend records required");
  const expected = new Set(contract.target_backends);
  const seen = new Set();
  for (const e of ledger.entries) {
    if (!expected.has(e.backend) || seen.has(e.backend)) throw Error("duplicate or unknown backend");
    seen.add(e.backend);
    if (!e.repository.startsWith("ores-truffle-oreslang/oreslang-source."))
      throw Error("repository identity");
    if (!/^[0-9a-f]{40}$/.test(e.commit) || !/^[0-9a-f]{40}$/.test(e.tree))
      throw Error("exact-head identity");
    if (!Number.isSafeInteger(e.run_id) || e.run_id < 1 ||
        !Number.isSafeInteger(e.job_id) || e.job_id < 1)
      throw Error("missing run and job evidence");
    if (e.executed_steps !== 0 || e.execution !== "NOT_EXECUTED" ||
        e.guest_parity_verified !== false)
      throw Error("zero-step runs cannot establish parity");
  }
  return {backends:seen.size,classification:"NOT_EXECUTED"};
}
