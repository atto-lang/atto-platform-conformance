// Evidence classification only; never certifies provenance or compiler parity.
export const STATUSES = Object.freeze(["PASS_EXECUTED", "FAIL_EXECUTED", "NOT_EXECUTED", "UNOBSERVED", "UNSUPPORTED"]);
const SHA = /^[0-9a-f]{40}$/;
const BACKENDS = new Set(["java", "llvm", "net", "wasm", "js"]);
const FIXTURE = /^MEM-(00[1-9]|01[0-9]|020)$/;

export function classifyActorMemoryEvidence(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw Error("invalid evidence record");
  if (!BACKENDS.has(record.backend) || !FIXTURE.test(record.fixture_id)) throw Error("invalid backend or fixture");
  if (!SHA.test(record.source_sha ?? "")) throw Error("invalid exact source SHA");
  if (record.supported === false) return "UNSUPPORTED";
  if (record.synthetic === true || record.source_binary_link_attested !== true) return "UNOBSERVED";
  if (record.steps_observed !== true) return "UNOBSERVED";
  if (!Array.isArray(record.steps) || record.steps.some(s => typeof s !== "string" || !s.trim())) throw Error("invalid steps");
  if (record.steps.length > 100) throw Error("too many steps");
  if (record.steps.length === 0) return "NOT_EXECUTED";
  if (record.generated_guest_executed !== true) return "NOT_EXECUTED";
  if (record.steps.length < 2) return "UNOBSERVED";
  if (record.steps.some(s => s.length > 256)) throw Error("step name too long");
  if (!record.steps.some(s => /compile|build/i.test(s)) || !record.steps.some(s => /execute|run guest/i.test(s))) return "UNOBSERVED";
  if (typeof record.compiler_command !== "string" || !record.compiler_command.trim() ||
      typeof record.guest_command !== "string" || !record.guest_command.trim() ||
      typeof record.workflow_url !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(record.workflow_url) ||
      !Number.isSafeInteger(record.job_id) || record.job_id <= 0) return "UNOBSERVED";
  if (!Number.isSafeInteger(record.exit_code)) return "UNOBSERVED";
  if (record.assertions_passed !== true && record.assertions_passed !== false) return "UNOBSERVED";
  return record.exit_code === 0 && record.assertions_passed === true ? "PASS_EXECUTED" : "FAIL_EXECUTED";
}
