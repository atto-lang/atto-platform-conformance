/**
 * AttoLang GPU G2/G3 evidence admission, not a device attestation.
 * Inputs MUST arrive from independently authenticated CI, compiler, runner,
 * and device-event collectors. No self-asserted JSON can prove physical GPU use.
 * Never promote host-only checks, zero-step jobs, or an unobserved fence.
 */
const sha = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
const id = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/+-]{0,127}$/.test(s);
const positive = n => Number.isSafeInteger(n) && n > 0;
const fail = (code, message) => { const e = new TypeError(`${code}: ${message}`); e.code = code; throw e; };
function record(value, keys, label) {
  if (!value || typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    fail('GPU-EVIDENCE-001', `${label} must be a plain record`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || keys.some(k =>
      !Object.hasOwn(descriptors, k) || !Object.hasOwn(descriptors[k], 'value')))
    fail('GPU-EVIDENCE-001', `${label} missing/extra/accessor field`);
  return Object.fromEntries(keys.map(k => [k, descriptors[k].value]));
}
function array(value, label, limit = 256) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < 1 || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1)
    fail('GPU-EVIDENCE-001', `${label} must be a bounded, dense array`);
  return Array.from({length: value.length}, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value')) fail('GPU-EVIDENCE-001', `${label} hole/accessor`);
    return d.value;
  });
}
function refSha(value, name) { if (!sha(value)) fail('GPU-EVIDENCE-002', name); return value; }
function ident(value, name) { if (!id(value)) fail('GPU-EVIDENCE-001', name); return value; }
/**
 * expected must come from the immutable PR head and fixture manifest, not
 * from the candidate receipt. Structural admission is NOT physical proof.
 */
export function validateGpuExecutionEvidenceV1(receipt, expected) {
  const ex = record(expected, ['head_sha','tree_sha','fixture_blob_sha','backend'], 'expected');
  refSha(ex.head_sha, 'expected.head_sha');
  refSha(ex.tree_sha, 'expected.tree_sha');
  refSha(ex.fixture_blob_sha, 'expected.fixture_blob_sha');
  if (!['java','llvm','net','wasm','forge','cranelift'].includes(ex.backend))
    fail('GPU-EVIDENCE-001','unsupported backend');
  const r = record(receipt, ['source','run','compiler','guest','device','numerics'], 'receipt');
  const source = record(r.source, ['head_sha','tree_sha','fixture_blob_sha'], 'source');
  for (const key of ['head_sha','tree_sha','fixture_blob_sha']) {
    refSha(source[key], `source.${key}`);
    if (source[key] !== ex[key]) fail('GPU-EVIDENCE-002', `${key} mismatch`);
  }
  const run = record(r.run, ['run_id','run_attempt','job_id','steps'], 'run');
  if (!positive(run.run_id) || !positive(run.run_attempt) || !positive(run.job_id))
    fail('GPU-EVIDENCE-003','missing CI run / attempt / job identity');
  const steps = array(run.steps, 'steps');
  if (!steps.some(raw => {
    const step = record(raw, ['name','status','conclusion'], 'step');
    ident(step.name, 'step name');
    if (!['completed','in_progress','queued'].includes(step.status) ||
        !['success','failure','cancelled',null].includes(step.conclusion))
      fail('GPU-EVIDENCE-003','invalid step status');
    return step.status === 'completed' && step.conclusion === 'success';
  })) fail('GPU-EVIDENCE-003','no executed successful CI step');
  const compiler = record(r.compiler, ['backend','compiled_guest','artifact_sha256','source_language'], 'compiler');
  if (compiler.backend !== ex.backend || compiler.compiled_guest !== true ||
      compiler.source_language !== 'atto' || typeof compiler.artifact_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(compiler.artifact_sha256))
    fail('GPU-EVIDENCE-004','no exact backend .atto guest compilation artifact');
  const guest = record(r.guest, ['executed','kernel_name','exit_code'], 'guest');
  if (guest.executed !== true || !ident(guest.kernel_name,'kernel_name') || guest.exit_code !== 0)
    fail('GPU-EVIDENCE-005','compiled guest did not execute successfully');
  const device = record(r.device, ['kind','vendor','device_id','queue_generation','submission_id','fence_state','event_observed'], 'device');
  if (device.kind !== 'physical_gpu' || !ident(device.vendor,'vendor') ||
      !ident(device.device_id,'device_id') || !positive(device.queue_generation) ||
      !ident(device.submission_id,'submission_id') || device.fence_state !== 'completed' ||
      device.event_observed !== true)
    fail('GPU-EVIDENCE-006','missing observed physical-device execution / completion');
  const numerics = record(r.numerics, ['oracle','samples','max_absolute_error','tolerance'], 'numerics');
  if (numerics.oracle !== 'independent_cpu' || !positive(numerics.samples) ||
      typeof numerics.max_absolute_error !== 'number' || !Number.isFinite(numerics.max_absolute_error) ||
      typeof numerics.tolerance !== 'number' || !Number.isFinite(numerics.tolerance) ||
      numerics.max_absolute_error < 0 || numerics.tolerance < 0 ||
      numerics.max_absolute_error > numerics.tolerance)
    fail('GPU-EVIDENCE-007','missing independent finite numerical agreement');
  return Object.freeze({classification:'PHYSICAL_GPU_CANDIDATE_UNATTESTED',
    compilerBackend:ex.backend,headSha:ex.head_sha,treeSha:ex.tree_sha,
    caveat:'Structural admission only; authenticate CI, compiler and physical-device source independently.'});
}
