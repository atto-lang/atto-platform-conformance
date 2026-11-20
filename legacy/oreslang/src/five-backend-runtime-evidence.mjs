// Structural gate for five Oreslang backend runtime observations.
// This is NOT CI provenance authentication or a substitute for running real guests.
import {createHash} from 'node:crypto';

export const BACKENDS = Object.freeze(['java', 'llvm', 'wasm', 'net', 'forge']);
export const CANONICAL_SOURCE = 'pub fnc main(): int { return 40 + 2; }\n';
export const SOURCE_SHA256 = createHash('sha256').update(CANONICAL_SOURCE).digest('hex');
export const SOURCE_GIT_BLOB = createHash('sha1')
  .update('blob ' + Buffer.byteLength(CANONICAL_SOURCE) + '\0').update(CANONICAL_SOURCE).digest('hex');
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPO_NAMES = Object.freeze(Object.fromEntries(BACKENDS.map(name =>
  [name, 'ores-truffle-oreslang/oreslang-source.' + name])));
const PROFILES = Object.freeze({
  java: new Set(['jvm', 'native-image', 'hybrid']),
  llvm: new Set(['native']),
  wasm: new Set(['core-wasm']),
  net: new Set(['windows-native-aot']),
  forge: new Set(['interpreter', 'native']),
});
const fail = (msg) => { throw new Error('untrusted five-backend evidence: ' + msg); };
const assert = (ok,msg) => { if (!ok) fail(msg); };
const exactFields = (v, fields, label) => {
  assert(v && typeof v === 'object' && !Array.isArray(v), label + ' must be object');
  assert(Object.keys(v).sort().join(',') === [...fields].sort().join(','), label + ' unexpected/missing fields');
};
const safeString = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200 && !s.includes('\0');

function validateProcess(p, label) {
  exactFields(p, ['argv', 'exit_code', 'signal', 'timed_out', 'truncated'], label);
  assert(Array.isArray(p.argv) && p.argv.length && p.argv.length <= 32 &&
    p.argv.every(safeString) && /^(?:\/|[A-Za-z]:\\)/.test(p.argv[0]), label + ': executable path must be absolute');
  assert(Number.isInteger(p.exit_code) && p.exit_code >= 0 && p.exit_code <= 255,
    label + ': exit code invalid');
  assert(p.signal === null && p.timed_out === false && p.truncated === false,
    label + ': crash/timeout/truncation');
}

function validateBackend(b) {
  const label = 'backend ' + (b?.backend ?? '(missing)');
  exactFields(b, ['backend','repository','profile','source_commit','source_tree',
    'fixture_git_blob','compiler_sha256','guest_artifact_sha256','compile',
    'guest','observation','ci'], label);
  assert(BACKENDS.includes(b.backend), label + ': unknown backend');
  assert(b.repository === REPO_NAMES[b.backend], label + ': incorrect repository');
  assert(PROFILES[b.backend].has(b.profile), label + ': unsupported target profile');
  assert(SHA40.test(b.source_commit) && SHA40.test(b.source_tree), label + ': missing exact source/tree');
  assert(b.fixture_git_blob === SOURCE_GIT_BLOB, label + ': fixture differs from canonical bytes');
  assert(SHA256.test(b.compiler_sha256) && SHA256.test(b.guest_artifact_sha256),
    label + ': missing binary digests');
  validateProcess(b.compile, label + ' compile');
  validateProcess(b.guest, label + ' guest');
  assert(b.compile.exit_code === 0, label + ': compiler failed');
  // Source acceptance alone is never evidence of guest execution.
  assert(b.guest.argv[0] !== b.compile.argv[0] || b.guest.argv.join('\0') !== b.compile.argv.join('\0'),
    label + ': compiler check substituted for guest execution');
  exactFields(b.observation, ['type','value','source_sha256','guest_executed'], label + ' observation');
  assert(b.observation.type === 'int' && b.observation.value === '42' &&
    b.observation.source_sha256 === SOURCE_SHA256 && b.observation.guest_executed === true,
    label + ': no matching typed guest result');
  // A native main() can exit 42; stdout/JSON-based runners may exit 0.
  assert([0,42].includes(b.guest.exit_code), label + ': guest execution failed');
  exactFields(b.ci, ['workflow_run_id','job_id','runner_id','steps_executed','head_sha'], label + ' CI');
  for (const field of ['workflow_run_id','job_id','runner_id','steps_executed']) {
    assert(Number.isSafeInteger(b.ci[field]) && b.ci[field] > 0,
      label + ': missing executed CI ' + field);
  }
  assert(b.ci.head_sha === b.source_commit, label + ': workflow HEAD mismatch');
  return {backend:b.backend, profile:b.profile, source_commit:b.source_commit, source_tree:b.source_tree};
}

/**
 * Pure structural validation: inputs are untrusted even if every check passes.
 * CI run IDs, runner execution, hashes and output must be independently obtained
 * and authenticated against GitHub + build artifacts before any parity claim.
 */
export function validateFiveBackendRuntimeEvidence(report) {
  exactFields(report, ['schema_version','feature','fixture','backends'], 'report');
  assert(report.schema_version === 1 && report.feature === 'scalar-add-i64-v1', 'wrong report version/feature');
  exactFields(report.fixture, ['source','sha256','git_blob'], 'fixture');
  assert(report.fixture.source === CANONICAL_SOURCE &&
    report.fixture.sha256 === SOURCE_SHA256 && report.fixture.git_blob === SOURCE_GIT_BLOB,
    'fixture drift');
  assert(Array.isArray(report.backends) && report.backends.length === BACKENDS.length,
    'exactly five backend observations required');
  const observed = new Set();
  const backends = report.backends.map(b => {
    const result = validateBackend(b);
    assert(!observed.has(result.backend), 'duplicate backend ' + result.backend);
    observed.add(result.backend);
    return result;
  });
  assert(BACKENDS.every(x => observed.has(x)), 'missing backend');
  return {
    structurally_valid: true,
    feature: report.feature,
    fixture_git_blob: SOURCE_GIT_BLOB,
    backend_count: backends.length,
    covered_backends: BACKENDS,
    // A self-authored report never elevates itself into an attestation.
    ci_provenance_authenticated: false,
    guest_execution_authenticated: false,
    five_backend_parity_certified: false,
    required_next_gate: 'INDEPENDENT_EXACT_HEAD_CI_AND_GUEST_ATTESTATION',
  };
}
