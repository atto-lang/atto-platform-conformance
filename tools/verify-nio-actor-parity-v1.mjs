// Source-free evidence classifier for NIO/actor five-backend parity.
// JSON is untrusted input. A metadata-only result is NEVER a certification.
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BACKENDS = ['java', 'llvm', 'wasm', 'cranelift', 'net'];
const OWNERS = Object.fromEntries(BACKENDS.map(backend => [backend,
  'ores-truffle-oreslang/oreslang-source.' + backend]));
const REQUIRED = [
  'nio_ready_once', 'nio_cancel_before_ready', 'nio_cancel_after_ready',
  'nio_close_pending', 'nio_stale_generation', 'nio_descriptor_reuse_aba',
  'nio_deadline_completion_race', 'nio_partial_read', 'nio_partial_write',
  'nio_backpressure_bounded', 'nio_permission_denied_before_open',
  'nio_no_guest_on_reactor', 'actor_same_actor_single_flight',
  'actor_two_actor_physical_overlap', 'actor_mailbox_retirement',
  'actor_control_progress_under_saturation'
];
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype &&
  Object.keys(x).every(k => own(Object.getOwnPropertyDescriptor(x,k),'value'));
const positive = n => Number.isSafeInteger(n) && n > 0;
const unverified = reason => ({classification:'UNVERIFIED',reason});

export function assessNioActorEvidence(e, pin) {
  if (!obj(e) || !obj(pin) || !BACKENDS.includes(pin.backend) ||
      pin.repository !== OWNERS[pin.backend] ||
      !SHA.test(pin.head_sha ?? '') || !SHA.test(pin.tree_sha ?? '') ||
      !Array.isArray(pin.required_vectors) ||
      pin.required_vectors.length !== REQUIRED.length ||
      new Set(pin.required_vectors).size !== REQUIRED.length ||
      REQUIRED.some(v => !pin.required_vectors.includes(v)))
    return unverified('invalid independently trusted backend/head/tree/vector pins');
  if (e.backend !== pin.backend || e.repository !== pin.repository ||
      e.head_sha !== pin.head_sha || e.tree_sha !== pin.tree_sha)
    return unverified('backend or immutable source identity mismatch');
  if (!obj(e.run) || !positive(e.run.id) || !positive(e.run.attempt) ||
      e.run.head_sha !== pin.head_sha || e.run.repository !== pin.repository)
    return unverified('workflow run does not bind to exact source head');
  if (!Array.isArray(e.jobs) || e.jobs.length === 0 || e.jobs.length > 64 ||
      !e.jobs.every(obj)) return unverified('invalid job inventory');
  if (e.jobs.some(j => !Array.isArray(j.steps) || j.steps.length > 256 ||
      !j.steps.every(obj))) return unverified('invalid step inventory');
  // Check runner admission BEFORE interpreting any job failure as a test failure.
  if (e.jobs.some(j => !positive(j.runner_id) ||
      typeof j.runner_name !== 'string' || !j.runner_name.trim() ||
      !j.steps.some(s => s.status === 'completed' &&
        !/^(Set up job|Complete job|Post )/.test(s.name ?? ''))))
    return {classification:'ADMISSION_FAILURE',reason:'unassigned runner or zero executed steps'};
  if (e.scope === 'source-free')
    return {classification:'SOURCE_FREE_ONLY',reason:'source-free checks cannot certify guest runtime parity'};
  if (e.scope !== 'private-source-compiler-runtime')
    return unverified('unrecognized evidence scope');
  if (e.site !== 'source-org') {
    // Private-source alternatives need separately authenticated destination approvals.
    // A caller-provided JSON flag is not sufficient authorization.
    return unverified('alternative-org private-source evidence requires independent allowlist verification');
  }
  if (!obj(e.review) || e.review.reviewer !== 'ORESoftware' ||
      e.review.author === e.review.reviewer ||
      e.review.head_sha !== pin.head_sha || e.review.state !== 'APPROVED' ||
      !positive(e.review.review_id))
    return unverified('missing independent exact-head ORESoftware approval');
  // Schema-2 security policy: @ORESoftware and @the1mills are both
  // operator-controlled and cannot satisfy independent SECURITY approval.
  if (!obj(e.security_review) || !positive(e.security_review.review_id) ||
      e.security_review.head_sha !== pin.head_sha ||
      e.security_review.state !== 'APPROVED' ||
      typeof e.security_review.reviewer !== 'string' ||
      !e.security_review.reviewer.trim() ||
      ['ORESoftware','the1mills'].includes(e.security_review.reviewer) ||
      e.security_review.reviewer === e.review.author ||
      e.security_review.reviewer === e.review.reviewer)
    return unverified('missing independently authenticated schema-2 security review');
  if (!obj(e.run) || e.run.status !== 'completed' || e.run.conclusion !== 'success')
    return unverified('workflow not successful');
  const ids = new Set();
  for (const job of e.jobs) {
    if (!positive(job.id) || ids.has(job.id) ||
        job.run_id !== e.run.id || job.attempt !== e.run.attempt ||
        job.status !== 'completed' || job.conclusion !== 'success')
      return unverified('job identity, attempt, or status mismatch');
    ids.add(job.id);
    const nums = new Set();
    for (const step of job.steps) {
      if (!positive(step.number) || nums.has(step.number) ||
          typeof step.name !== 'string' ||
          step.status !== 'completed' || step.conclusion !== 'success')
        return unverified('unexecuted, duplicate, or unsuccessful step');
      nums.add(step.number);
    }
  }
  const steps = e.jobs.flatMap(j => j.steps.map(s => s.name));
  for (const name of ['Compile Oreslang guest source', 'Execute compiled Oreslang guest'])
    if (steps.filter(s => s === name).length !== 1)
      return unverified('missing or duplicate executed step: ' + name);
  if (!obj(e.compiler) || !SHA.test(e.compiler.commit ?? '') ||
      !obj(e.artifact) || !DIGEST.test(e.artifact.sha256 ?? '') ||
      e.artifact.source_sha !== pin.head_sha)
    return unverified('compiler identity or compiled artifact digest unavailable');
  if (!Array.isArray(e.vectors) || e.vectors.length !== REQUIRED.length ||
      !e.vectors.every(obj)) return unverified('incomplete guest vector inventory');
  const seen = new Set();
  for (const v of e.vectors) {
    if (!REQUIRED.includes(v.id) || seen.has(v.id) ||
        !['pass','fail','unsupported'].includes(v.outcome) ||
        v.guest_executed !== true || !positive(v.job_id) || !ids.has(v.job_id))
      return unverified('invalid, duplicate, or unexecuted vector');
    seen.add(v.id);
    if (v.outcome === 'unsupported' && (typeof v.reason !== 'string' || !v.reason.trim()))
      return unverified('unsupported vector lacks explicit reason');
  }
  if (e.backend === 'wasm' && e.host === 'browser' &&
      e.raw_tcp === 'supported')
    return unverified('browser WASM raw TCP claim requires unavailable host capability');
  if (e.vectors.some(v => v.outcome === 'fail'))
    return {classification:'EXECUTED_TEST_FAILURE',reason:'guest vector failed with runner evidence'};
  if (e.vectors.some(v => v.outcome === 'unsupported'))
    return {classification:'PARTIAL_SUPPORT_REVIEW_REQUIRED',reason:'explicitly unsupported vectors'};
  // A JSON envelope alone cannot authenticate API provenance, actual logs,
  // source compiler binary, or independent reviewer identity.
  return {classification:'EXECUTION_REVIEW_REQUIRED',reason:'verify authoritative GitHub API, runner logs and artifact bytes independently'};
}

export const nioActorBackends = Object.freeze([...BACKENDS]);
export const nioActorRequiredVectors = Object.freeze([...REQUIRED]);
