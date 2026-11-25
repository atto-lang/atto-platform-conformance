/**
 * AttoLang GPU G2/G3 evidence admission, NOT a hardware/device attestation.
 * `expected` MUST come from an independent, authenticated source-of-truth:
 * the PR head/tree, fixture manifest, runner-job lookup, compiler artifact,
 * and device-event collector. Never derive `expected` from `receipt`.
 *
 * A successful structural check remains UNATTESTED. This function cannot
 * prove the authenticity of GitHub responses, device events or JSON objects.
 * Both inputs should be fresh parsed JSON (not live Proxy objects).
 */
const sha1 = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
const sha256 = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const id = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/+-]{0,127}$/.test(s);
const positive = n => Number.isSafeInteger(n) && n > 0;
const finiteNonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const requiredPhases = Object.freeze([
  'source_checkout', 'guest_compile', 'guest_execute', 'device_event', 'numeric_oracle'
]);
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
function array(value, label, minimum = 1, limit = 256) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < minimum || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1)
    fail('GPU-EVIDENCE-001', `${label} must be a bounded, dense array`);
  return Array.from({length: value.length}, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value')) fail('GPU-EVIDENCE-001', `${label} hole/accessor`);
    return d.value;
  });
}
function refSha(value, name) { if (!sha1(value)) fail('GPU-EVIDENCE-002', name); return value; }
function ident(value, name) { if (!id(value)) fail('GPU-EVIDENCE-001', name); return value; }
function pinned(actual, expected, code, name) {
  if (actual !== expected) fail(code, `${name} differs from independently pinned value`);
}
/**
 * Validate a candidate evidence envelope.  No authorization or physical-GPU
 * support decision may be inferred from its return value.
 */
export function validateGpuExecutionEvidenceV1(receipt, expected) {
  const ex = record(expected, [
    'head_sha', 'tree_sha', 'fixture_blob_sha', 'backend',
    'run_id', 'run_attempt', 'job_id', 'artifact_sha256',
    'kernel_name', 'tenant_id', 'device_vendor', 'device_id',
    'queue_generation', 'allocation_generation', 'submission_id',
    'oracle_artifact_sha256', 'output_samples', 'maximum_absolute_tolerance'
  ], 'expected');
  refSha(ex.head_sha, 'expected.head_sha');
  refSha(ex.tree_sha, 'expected.tree_sha');
  refSha(ex.fixture_blob_sha, 'expected.fixture_blob_sha');
  if (!['java','llvm','net','wasm','forge','cranelift'].includes(ex.backend) ||
      !positive(ex.run_id) || !positive(ex.run_attempt) || !positive(ex.job_id) ||
      !sha256(ex.artifact_sha256) || !sha256(ex.oracle_artifact_sha256) ||
      !id(ex.kernel_name) || !id(ex.tenant_id) || !id(ex.device_vendor) ||
      !id(ex.device_id) || !positive(ex.queue_generation) ||
      !positive(ex.allocation_generation) || !id(ex.submission_id) ||
      !positive(ex.output_samples) || !finiteNonnegative(ex.maximum_absolute_tolerance))
    fail('GPU-EVIDENCE-001','invalid independently pinned execution policy');

  const r = record(receipt, ['source','run','compiler','guest','device','numerics'], 'receipt');
  const source = record(r.source, ['head_sha','tree_sha','fixture_blob_sha'], 'source');
  for (const key of ['head_sha','tree_sha','fixture_blob_sha']) {
    refSha(source[key], `source.${key}`);
    pinned(source[key], ex[key], 'GPU-EVIDENCE-002', key);
  }
  const run = record(r.run, ['run_id','run_attempt','job_id','status','conclusion','steps'], 'run');
  if (!positive(run.run_id) || !positive(run.run_attempt) || !positive(run.job_id) ||
      run.status !== 'completed' || run.conclusion !== 'success')
    fail('GPU-EVIDENCE-003','CI job did not complete successfully');
  for (const key of ['run_id','run_attempt','job_id'])
    pinned(run[key], ex[key], 'GPU-EVIDENCE-003', key);
  const steps = array(run.steps, 'steps', requiredPhases.length);
  const seen = new Set();
  const order = [];
  for (const raw of steps) {
    const step = record(raw, ['name','status','conclusion'], 'step');
    ident(step.name, 'step name');
    if (seen.has(step.name)) fail('GPU-EVIDENCE-003','duplicate CI step name');
    seen.add(step.name);
    if (step.status !== 'completed' || step.conclusion !== 'success')
      fail('GPU-EVIDENCE-003',`CI step ${step.name} was not executed successfully`);
    if (requiredPhases.includes(step.name)) order.push(step.name);
  }
  if (order.length !== requiredPhases.length ||
      order.some((phase,i) => phase !== requiredPhases[i]))
    fail('GPU-EVIDENCE-003','missing or out-of-order GPU evidence phases');

  const compiler = record(r.compiler, ['backend','compiled_guest','artifact_sha256','source_language'], 'compiler');
  if (compiler.backend !== ex.backend || compiler.compiled_guest !== true ||
      compiler.source_language !== 'atto' || !sha256(compiler.artifact_sha256))
    fail('GPU-EVIDENCE-004','no backend-specific .atto compiled guest artifact');
  pinned(compiler.artifact_sha256, ex.artifact_sha256, 'GPU-EVIDENCE-004', 'artifact_sha256');
  const guest = record(r.guest, ['executed','kernel_name','exit_code'], 'guest');
  if (guest.executed !== true || !ident(guest.kernel_name,'kernel_name') || guest.exit_code !== 0)
    fail('GPU-EVIDENCE-005','compiled guest did not execute successfully');
  pinned(guest.kernel_name, ex.kernel_name, 'GPU-EVIDENCE-005', 'kernel_name');

  const device = record(r.device, [
    'kind','tenant_id','vendor','device_id','queue_generation',
    'allocation_generation','submission_id','fence_state','event_observed'
  ], 'device');
  if (device.kind !== 'physical_gpu' || !ident(device.tenant_id,'device.tenant_id') ||
      !ident(device.vendor,'device.vendor') || !ident(device.device_id,'device.device_id') ||
      !positive(device.queue_generation) || !positive(device.allocation_generation) ||
      !ident(device.submission_id,'device.submission_id') || device.fence_state !== 'completed' ||
      device.event_observed !== true)
    fail('GPU-EVIDENCE-006','missing observed physical-device execution / completion');
  for (const [key, from] of [
    ['tenant_id','tenant_id'], ['vendor','device_vendor'], ['device_id','device_id'],
    ['queue_generation','queue_generation'], ['allocation_generation','allocation_generation'],
    ['submission_id','submission_id']
  ]) pinned(device[key], ex[from], 'GPU-EVIDENCE-006', key);

  const numerics = record(r.numerics, [
    'oracle','oracle_artifact_sha256','samples','max_absolute_error','tolerance'
  ], 'numerics');
  if (numerics.oracle !== 'independent_cpu' || !sha256(numerics.oracle_artifact_sha256) ||
      !positive(numerics.samples) || !finiteNonnegative(numerics.max_absolute_error) ||
      !finiteNonnegative(numerics.tolerance) || numerics.max_absolute_error > numerics.tolerance ||
      numerics.tolerance > ex.maximum_absolute_tolerance)
    fail('GPU-EVIDENCE-007','missing finite independently bounded numerical agreement');
  pinned(numerics.samples, ex.output_samples, 'GPU-EVIDENCE-007', 'output_samples');
  pinned(numerics.oracle_artifact_sha256, ex.oracle_artifact_sha256,
      'GPU-EVIDENCE-007', 'oracle_artifact_sha256');

  return Object.freeze({
    classification:'PHYSICAL_GPU_CANDIDATE_UNATTESTED',
    compilerBackend:ex.backend, headSha:ex.head_sha, treeSha:ex.tree_sha,
    caveat:'Structural admission only; authenticate CI, compiler, oracle and physical-device provenance independently.'
  });
}
