// Source-free structural evidence gate. No compiler sources or native guest artifacts.
// Passing only makes a receipt eligible for independent API/attestation review.
export const REQUIRED_PROFILES = Object.freeze({
  java: ['jit', 'aot', 'hybrid'],
  llvm: ['native-aot'],
  wasm: ['wasm-runtime'],
  cranelift: ['jit'],
  net: ['native-aot'],
});
const BASE = 'ores-truffle-oreslang/oreslang-source.';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ids = new Map([
  ['scalar.literal-42', {kind: 'accept', stdout: '42\n'}],
  ['scalar.precedence', {kind: 'accept', stdout: '28\n'}],
  ['scalar.unary', {kind: 'accept', stdout: '-21\n'}],
  ['scalar.i64-min', {kind: 'accept', stdout: '-9223372036854775808\n'}],
  ['scalar.i64-max', {kind: 'accept', stdout: '9223372036854775807\n'}],
  ['scalar.i64-max-minus-one', {kind: 'accept', stdout: '9223372036854775806\n'}],
  ['checked-overflow.add', {kind: 'overflow'}],
  ['checked-overflow.multiply', {kind: 'overflow'}],
]);
export const REQUIRED_CASES = Object.freeze([...ids.keys()]);
const positive = v => Number.isSafeInteger(v) && v > 0;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const reject = why => {throw new Error(why);};

// IMPORTANT: A signed, complete, internally consistent forged receipt can pass.
// Trusted verification must retrieve GitHub jobs, compiler and guest outputs,
// fixture hashes, independent approvals and provenance via authoritative APIs.
export function validateFiveBackendScalarEligibility(doc) {
  if (!doc || doc.schema_version !== 1 || doc.certified !== false ||
      doc.native_verified !== false || doc.source_transfer_authorized !== false) {
    reject('non-certifying source-free evidence envelope required');
  }
  if (doc.fixture_profile !== 'scalar-checked-i64-v1' ||
      !Array.isArray(doc.fixtures) || doc.fixtures.length !== ids.size) {
    reject('exact scalar fixture coverage required');
  }
  const fixtures = new Map();
  for (const f of doc.fixtures) {
    if (!f || !ids.has(f.id) || fixtures.has(f.id) || !SHA256.test(f.source_sha256)) {
      reject('missing, duplicate or unpinned scalar fixture');
    }
    fixtures.set(f.id, f.source_sha256);
  }
  if (fixtures.size !== ids.size || !Array.isArray(doc.executions) ||
      doc.executions.length !== 7) reject('all seven five-backend mode executions required');
  const seen = new Set(), jobIds = new Set(), runs = new Set();
  for (const e of doc.executions) {
    if (!e || !Object.hasOwn(REQUIRED_PROFILES, e.backend) ||
        !REQUIRED_PROFILES[e.backend].includes(e.mode) ||
        e.repository !== BASE + e.backend) reject('backend, mode or repository mismatch');
    const key = e.backend + '/' + e.mode;
    if (seen.has(key)) reject('duplicate backend/profile credit');
    seen.add(key);
    if (!e.source || !SHA40.test(e.source.commit_sha) ||
        !SHA40.test(e.source.tree_sha) || !e.compiler ||
        !SHA40.test(e.compiler.commit_sha) || !SHA40.test(e.compiler.tree_sha) ||
        !SHA256.test(e.compiler.binary_sha256)) reject('unbound source/compiler identity');
    const r = e.run;
    if (!r || !positive(r.id) || !positive(r.attempt) ||
        r.status !== 'completed' || r.conclusion !== 'success' ||
        r.admission_failed !== false || !Array.isArray(r.jobs) ||
        r.jobs.length === 0) reject('runner admission or run identity missing');
    const runKey = e.repository + '/' + r.id + '/' + r.attempt;
    if (runs.has(runKey)) reject('run reused across mode claims');
    runs.add(runKey);
    for (const j of r.jobs) {
      if (!j || !positive(j.id) || jobIds.has(e.repository + '/' + j.id) ||
          j.run_id !== r.id || j.run_attempt !== r.attempt ||
          j.head_sha !== e.source.commit_sha ||
          !positive(j.runner_id) || !nonempty(j.runner_name) ||
          j.status !== 'completed' || j.conclusion !== 'success' ||
          !Array.isArray(j.steps) || j.steps.length === 0) {
        reject('unexecuted or mismatched job');
      }
      jobIds.add(e.repository + '/' + j.id);
      for (const [index, s] of j.steps.entries()) {
        if (!s || s.number !== index + 1 || !nonempty(s.name) ||
            s.status !== 'completed' || s.conclusion !== 'success')
          reject('unexecuted, skipped or out-of-order step');
      }
    }
    if (!Array.isArray(e.cases) || e.cases.length !== ids.size)
      reject('missing positive/overflow guest case');
    const caseIds = new Set();
    for (const c of e.cases) {
      if (!c || !ids.has(c.id) || caseIds.has(c.id) ||
          c.source_sha256 !== fixtures.get(c.id) ||
          !SHA256.test(c.stdout_sha256) || !SHA256.test(c.stderr_sha256) ||
          !Number.isSafeInteger(c.exit_code) || c.compiler_executed !== true ||
          c.guest_executed !== true || !nonempty(c.guest_command) ||
          typeof c.stdout !== 'string' || c.kind !== ids.get(c.id).kind)
        reject('unverified guest case or mismatched fixture');
      caseIds.add(c.id);
      if (c.kind === 'accept') {
        if (c.exit_code !== 0 || c.stdout !== ids.get(c.id).stdout)
          reject('wrong successful guest value');
      } else if (c.exit_code === 0 || c.stdout !== '' ||
                 c.error_category !== 'checked-i64-overflow')
        reject('overflow must fail closed without stdout');
    }
  }
  const required = Object.entries(REQUIRED_PROFILES).flatMap(
    ([backend, modes]) => modes.map(mode => backend + '/' + mode));
  if (required.some(key => !seen.has(key))) reject('missing required backend profile');
  return true; // Structural eligibility ONLY. Never certification.
}
