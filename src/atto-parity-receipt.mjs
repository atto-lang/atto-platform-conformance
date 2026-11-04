export const BACKENDS = Object.freeze(['java', 'llvm', 'wasm', 'net', 'forge']);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function check(ok, reason) { if (!ok) throw new Error('parity receipt rejected: ' + reason); }
export function validateParityReceipt(report) {
  check(isObject(report), 'object required');
  check(report.schema === 'attolang.parity-receipt/1', 'schema');
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
  const ids = new Set();
  for (const c of report.cases) {
    check(isObject(c), 'case object');
    check(typeof c.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(c.id) && !ids.has(c.id), 'case ID');
    ids.add(c.id);
    check(DIGEST.test(c.source_sha256 ?? ''), 'source digest');
    check(c.kind === 'positive' || c.kind === 'negative', 'case kind');
    check(Number.isSafeInteger(c.compile_exit) && c.compile_exit >= 0, 'compile exit');
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
  return { consistent: true, authenticity_attested: false, publicly_promotable: false, backend: report.backend, case_count: ids.size };
}
