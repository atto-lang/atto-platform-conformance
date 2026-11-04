export const BACKENDS = Object.freeze(['java', 'llvm', 'wasm', 'net', 'forge']);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const I64_TEXT = /^-?(0|[1-9][0-9]*)$/;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function check(ok, reason) { if (!ok) throw new Error('parity receipt rejected: ' + reason); }
function checkI64Text(value, reason) {
  check(typeof value === 'string' && I64_TEXT.test(value), reason);
  const parsed = BigInt(value);
  check(parsed >= I64_MIN && parsed <= I64_MAX, reason);
}
function checkCommon(report) {
  check(BACKENDS.includes(report.backend), 'backend');
  check(SHA.test(report.head_sha ?? ''), 'head SHA');
  check(SHA.test(report.tree_sha ?? ''), 'tree SHA');
  check(typeof report.compiler === 'string' && report.compiler.length > 0 && report.compiler.length <= 256, 'compiler');
  check(DIGEST.test(report.compiler_sha256 ?? ''), 'compiler digest');
  check(Number.isSafeInteger(report.run_id) && report.run_id > 0, 'run ID');
  check(Number.isSafeInteger(report.run_attempt) && report.run_attempt > 0, 'run attempt');
  check(Number.isSafeInteger(report.executed_steps) && report.executed_steps > 0, 'executed steps');
  check(report.job_conclusion === 'success', 'job conclusion');
  check(Array.isArray(report.cases) && report.cases.length > 0 && report.cases.length <= 100, 'cases');
}
function checkCaseIdentity(c, ids) {
  check(isObject(c), 'case object');
  check(typeof c.id === 'string' && CASE_ID.test(c.id) && !ids.has(c.id), 'case ID');
  ids.add(c.id);
  check(DIGEST.test(c.source_sha256 ?? ''), 'source digest');
  check(c.kind === 'positive' || c.kind === 'negative', 'case kind');
  check(Number.isSafeInteger(c.compile_exit) && c.compile_exit >= 0, 'compile exit');
}
function validateV1(report) {
  checkCommon(report);
  const ids = new Set();
  for (const c of report.cases) {
    checkCaseIdentity(c, ids);
    if (c.kind === 'positive') {
      check(c.compile_exit === 0, 'positive compilation');
      check(c.executed === true && c.run_exit === 0, 'positive guest execution');
      check(typeof c.stdout === 'string' && c.stdout.length <= 16384, 'bounded stdout');
      check(typeof c.expected_stdout === 'string' && c.stdout === c.expected_stdout, 'stdout mismatch');
    } else {
      check(c.compile_exit !== 0 && c.executed === false, 'negative compile rejection');
      check(typeof c.diagnostic === 'string' && c.diagnostic.length > 0 && c.diagnostic.length <= 4096, 'negative diagnostic');
    }
  }
  return {
    consistent: true,
    authenticity_attested: false,
    publicly_promotable: false,
    scalar_core_eligible: false,
    schema: report.schema,
    backend: report.backend,
    case_count: ids.size
  };
}
function validateV2(report) {
  checkCommon(report);
  const ids = new Set();
  for (const c of report.cases) {
    checkCaseIdentity(c, ids);
    if (c.kind === 'positive') {
      check(c.compile_exit === 0, 'positive compilation');
      check(DIGEST.test(c.artifact_sha256 ?? ''), 'positive guest artifact digest');
      check(c.executed === true, 'positive guest execution');
      check(c.failure_stage === undefined, 'positive failure stage');
      checkI64Text(c.result_i64, 'positive i64 result');
      checkI64Text(c.expected_i64, 'expected i64 result');
      check(c.result_i64 === c.expected_i64, 'typed i64 mismatch');
      check(typeof c.result_channel === 'string' &&
        ['process-exit', 'stdout', 'wasm-export', 'native-return', 'host-call'].includes(c.result_channel),
        'result channel');
    } else {
      check(c.failure_stage === 'compile' || c.failure_stage === 'runtime', 'negative failure stage');
      check(typeof c.diagnostic === 'string' && c.diagnostic.length > 0 && c.diagnostic.length <= 4096, 'negative diagnostic');
      if (c.failure_stage === 'compile') {
        check(c.compile_exit !== 0 && c.executed === false, 'negative compile rejection');
        check(c.artifact_sha256 === undefined, 'compile rejection artifact');
        check(c.runtime_outcome === undefined, 'compile rejection runtime outcome');
      } else {
        check(c.compile_exit === 0 && c.executed === true, 'negative runtime execution');
        check(DIGEST.test(c.artifact_sha256 ?? ''), 'negative runtime artifact digest');
        check(c.runtime_outcome === 'trap' || c.runtime_outcome === 'error', 'negative runtime outcome');
      }
    }
  }
  return {
    consistent: true,
    authenticity_attested: false,
    publicly_promotable: false,
    scalar_core_eligible: true,
    schema: report.schema,
    backend: report.backend,
    case_count: ids.size
  };
}
export function validateParityReceipt(report) {
  check(isObject(report), 'object required');
  if (report.schema === 'attolang.parity-receipt/1') return validateV1(report);
  if (report.schema === 'attolang.parity-receipt/2') return validateV2(report);
  throw new Error('parity receipt rejected: schema');
}
export function validateScalarParityReceipt(report) {
  check(isObject(report), 'object required');
  check(report.schema === 'attolang.parity-receipt/2', 'scalar core requires receipt v2');
  return validateV2(report);
}
