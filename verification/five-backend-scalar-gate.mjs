import {createHash} from 'node:crypto';
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
// Bind claimed process-output digests to exact UTF-8 bytes; a 64-hex string
// alone is not evidence integrity. Bound bytes before hashing.
const outputDigest = value => typeof value === 'string' &&
  value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= 32768
  ? createHash('sha256').update(value, 'utf8').digest('hex')
  : null;
const ids = new Map([
  ['scalar.literal-42', {kind: 'accept', value: '42'}],
  ['scalar.precedence', {kind: 'accept', value: '28'}],
  ['scalar.unary', {kind: 'accept', value: '-21'}],
  ['scalar.i64-min', {kind: 'accept', value: '-9223372036854775808'}],
  ['scalar.i64-max', {kind: 'accept', value: '9223372036854775807'}],
  ['scalar.i64-max-minus-one', {kind: 'accept', value: '9223372036854775806'}],
  ['checked-overflow.add', {kind: 'overflow'}],
  ['checked-overflow.multiply', {kind: 'overflow'}],
]);
export const REQUIRED_CASES = Object.freeze([...ids.keys()]);
// Typed runtime observations differ from CLI stdout/exit-code transports.
export const OBSERVATION_CHANNELS = Object.freeze({
  java: 'graal-guest-i64',
  llvm: 'native-wrapper-i64',
  wasm: 'wasm-export-i64',
  cranelift: 'jit-cli-stdout-i64',
  net: 'native-aot-stdout-i64',
});

export const FIXTURE_SHA256 = Object.freeze({
  "scalar.literal-42": "a471a693741ed13b31ee1a38dc362c1a4140162a635ccd815f61dec318e990b4",
  "scalar.precedence": "aa294609eb38ba63571ebc09da5fa8a7a108ec9a8c4e7156c609e7101da0615b",
  "scalar.unary": "8ac156b0468e6f8e61b25d6bb59cd2d608b57cb2c4d077776f5a0483458b138a",
  "scalar.i64-min": "8b5b69ec25fda12bd6a695c7a2ab986634bcbf37f8b129507582597e662c0b49",
  "scalar.i64-max": "80e89020eae9f56c657043d6482bd71f3e2c9aa16730438c102e9ab5834995a4",
  "scalar.i64-max-minus-one": "d27086270301951421718bcf3c82d5fe988b5dd076d43153f3aed3a6bebb7c99",
  "checked-overflow.add": "f1707d7b751858fe61bac9c13e68deca63f6dfa12305a9e51ad44d214b78b74d",
  "checked-overflow.multiply": "a391373cd6e003e6f3ca7db697fe11116c8561aba86c68e4803922a0b933eff0"
});

const positive = v => Number.isSafeInteger(v) && v > 0;
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
// Evidence labels are bounded single-line, well-formed UTF-8, never terminal controls.
const safeEvidenceLine = v => nonempty(v) && v.isWellFormed() &&
  Buffer.byteLength(v, 'utf8') <= 4096 &&
  !/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/u.test(v);
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
    if (!f || !ids.has(f.id) || fixtures.has(f.id) || !SHA256.test(f.source_sha256) ||
        f.source_sha256 !== FIXTURE_SHA256[f.id]) {
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
          !positive(j.runner_id) || !safeEvidenceLine(j.runner_name) ||
          j.status !== 'completed' || j.conclusion !== 'success' ||
          !Array.isArray(j.steps) || j.steps.length === 0) {
        reject('unexecuted or mismatched job');
      }
      jobIds.add(e.repository + '/' + j.id);
      for (const [index, s] of j.steps.entries()) {
        if (!s || s.number !== index + 1 || !safeEvidenceLine(s.name) ||
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
          c.stdout_sha256 !== outputDigest(c.stdout) ||
          c.stderr_sha256 !== outputDigest(c.stderr) ||
          (e.backend === 'wasm' ? c.exit_code !== null :
            !Number.isSafeInteger(c.exit_code)) ||
          c.observation_channel !== OBSERVATION_CHANNELS[e.backend] ||
          c.compiler_executed !== true || c.guest_executed !== true ||
          !safeEvidenceLine(c.guest_command) || typeof c.stdout !== 'string' ||
          c.kind !== ids.get(c.id).kind)
        reject('unverified guest case or mismatched fixture');
      caseIds.add(c.id);
      if (c.kind === 'accept') {
        // A successful scalar may not also claim a diagnostic or trap.
        if (c.stderr !== '' ||
            (c.trap_category !== undefined && c.trap_category !== null))
          reject('successful guest must not report diagnostic or trap');
        // Output encoding is backend-specific; normalize a typed signed-i64
        // witness, then independently verify it against real runtime bytes.
        if (c.semantic_phase !== 'guest-return' ||
            c.value_i64 !== ids.get(c.id).value ||
            c.error_category !== null ||
            (e.backend !== 'wasm' && c.exit_code !== 0))
          reject('wrong successful guest value');
        // For CLI/NativeAOT transports, stdout itself is the typed witness.
        if ((e.backend === 'net' || e.backend === 'cranelift') &&
            c.stdout !== c.value_i64 + '\n')
          reject('stdout transport does not match normalized result');
        if (e.backend === 'wasm' && c.stdout !== '')
          reject('Wasm export must not invent guest stdout');
      } else {
        // An exit failure without diagnostic could be a CLI or loader error.
        if (e.backend !== 'wasm' && !nonempty(c.stderr))
          reject('native overflow requires diagnostic');
        if (c.semantic_phase !== 'guest-overflow' || c.value_i64 !== null ||
            c.stdout !== '' || c.error_category !== 'checked-i64-overflow' ||
            (e.backend !== 'wasm' && c.exit_code === 0) ||
            (e.backend === 'wasm' && c.trap_category !== 'webassembly-runtime-error'))
          reject('overflow must fail closed without stdout');
      }
    }
  }
  const required = Object.entries(REQUIRED_PROFILES).flatMap(
    ([backend, modes]) => modes.map(mode => backend + '/' + mode));
  if (required.some(key => !seen.has(key))) reject('missing required backend profile');
  return true; // Structural eligibility ONLY. Never certification.
}
