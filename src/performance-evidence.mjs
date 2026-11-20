import {isProxy} from 'node:util/types';
// Validation of performance report SHAPE, not authentication of the producer.
// Neither hash strings nor a self-reported PASS prove a benchmark actually ran.
const BACKENDS = Object.freeze({
  software: new Set(['java', 'llvm', 'wasm']),
  fpga: new Set(['fpga']),
  asic: new Set(['asic']),
});
const STATUSES = new Set(['UNCONFIGURED','UNSUPPORTED','FAIL','NOT_VECTORIZED',
  'SIMULATED_ONLY','SYNTH_ONLY','PLACE_ROUTE_VERIFIED','MEASURED']);
const METRICS = Object.freeze({
  latency: {unit: 'ns', family: 'software', min: 0},
  throughput: {unit: 'ops/s', family: 'software', min: 0},
  allocation: {unit: 'bytes/op', family: 'software', min: 0},
  build_time: {unit: 'ms', family: 'software', min: 0},
  image_size: {unit: 'bytes', family: 'software', min: 0},
  ii: {unit: 'cycles', family: 'fpga', min: 1, integer: true},
  fmax: {unit: 'MHz', family: 'fpga', min: 0},
  lut: {unit: 'count', family: 'fpga', min: 0, integer: true},
  ff: {unit: 'count', family: 'fpga', min: 0, integer: true},
  bram: {unit: 'count', family: 'fpga', min: 0, integer: true},
  dsp: {unit: 'count', family: 'fpga', min: 0, integer: true},
  area: {unit: 'um2', family: 'asic', min: 0},
  slack: {unit: 'ns', family: 'asic'},
  critical_path: {unit: 'ns', family: 'asic', min: 0},
  power: {unit: 'mW', family: 'asic', min: 0},
});
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const safeHash = (value, pattern) => typeof value === 'string' && pattern.test(value) && !/^0+$/.test(value);
const fail = (why) => { throw new Error('untrusted performance evidence: ' + why); };
const check = (ok, why) => { if (!ok) fail(why); };
const object = (v, keys, label) => {
  check(!isProxy(v) && v !== null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v)===Object.prototype || Object.getPrototypeOf(v)===null),
    label + ' must be plain data object');
  const descriptors=Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(descriptors).length===keys.length &&
    keys.every(k=>Object.hasOwn(descriptors,k) &&
      Object.hasOwn(descriptors[k],'value')),
    label + ' unexpected/missing/accessor fields');
};
const denseArray = (v, max, label) => {
  check(!isProxy(v) && Array.isArray(v) && Object.getPrototypeOf(v)===Array.prototype &&
    v.length<=max, label+' must be bounded plain array');
  const d=Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(d).length===v.length+1 &&
    Array.from({length:v.length},(_,i)=>d[String(i)])
      .every(item=>item && Object.hasOwn(item,'value')),
    label+' must be dense own-data array');
};
const bounded = (v, max=200) => typeof v === 'string' && v.length > 0 &&
  v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
// Evidence locators are identifiers, not URLs or filesystem capabilities.
// A downstream authenticator may resolve these paths only under its own
// trusted artifact root, using no-follow descriptor-based operations.
const safeLocator = (v) => bounded(v,512) &&
  !v.includes('\\') && !v.includes('%') &&
  !v.includes(':') && !v.startsWith('/') &&
  v.split('/').every(p => p.length>0 && p!=='.' && p!=='..' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p));
const measured = (status) => ['MEASURED','SYNTH_ONLY','PLACE_ROUTE_VERIFIED','SIMULATED_ONLY'].includes(status);

export function validatePerformanceEvidence(r) {
  object(r, ['schemaVersion','status','family','backend','mode','sourceSha','compilerSha256',
    'fixtureSha256','toolchain','environment','kind','unit','samples','correctness','evidence'], 'report');
  check(r.schemaVersion === 1, 'unsupported schema version');
  check(Object.hasOwn(BACKENDS, r.family) && BACKENDS[r.family].has(r.backend),
    'invalid family/backend pair');
  check(STATUSES.has(r.status), 'invalid or unrecognized claim/status');
  check(bounded(r.mode, 80), 'mode must be bounded');
  check(typeof r.kind === 'string' && Object.hasOwn(METRICS, r.kind), 'unknown metric');
  const metric=METRICS[r.kind];
  check(metric.family === r.family && metric.unit === r.unit, 'invalid metric family/units');
  check(['UNVERIFIED','PASS','FAIL'].includes(r.correctness), 'invalid correctness');
  object(r.toolchain, ['name','version'], 'toolchain');
  object(r.environment, ['target','cpu','clockPolicy'], 'environment');
  for(const [key,value] of Object.entries(r.toolchain))
    check(bounded(value,120), 'invalid toolchain.' + key);
  for(const [key,value] of Object.entries(r.environment))
    check(bounded(value,160), 'invalid environment.' + key);
  denseArray(r.samples,10000,'samples');
  for (const sample of r.samples) {
    check(typeof sample === 'number' && Number.isFinite(sample), 'sample must be finite number');
    if (metric.min !== undefined) check(sample >= metric.min, 'sample below valid range');
    if (metric.integer) check(Number.isSafeInteger(sample), 'metric requires exact integer sample');
  }
  denseArray(r.evidence,32,'evidence');
  for (const e of r.evidence) {
    object(e,['stage','sha256','locator'],'evidence item');
    check(['compile','test','simulation','synthesis','place-route','board','power-model',
      'correctness','benchmark'].includes(e.stage), 'invalid evidence stage');
    check(safeHash(e.sha256,SHA256) && safeLocator(e.locator), 'invalid evidence reference');
  }
  // Even a structurally complete report is NOT independent proof of execution.
  // The checks here prevent trivial false-green claims, not fabricated digests.
  if (measured(r.status)) {
    check(safeHash(r.sourceSha,SHA40) && safeHash(r.compilerSha256,SHA256) &&
      safeHash(r.fixtureSha256,SHA256), 'measured report missing exact hashes');
    check(r.correctness === 'PASS', 'measured report missing successful correctness gate');
    check(r.samples.length >= (r.status === 'MEASURED' ? 5 : 1),
      'insufficient independent observations');
    check(r.evidence.length > 0, 'measured report missing evidence references');
    check(r.toolchain.version !== 'unconfigured' && r.environment.target !== 'unknown' &&
      r.environment.cpu !== 'unknown' && r.environment.clockPolicy !== 'unknown',
      'measured report has unknown toolchain or environment');
    const stages = new Set(r.evidence.map(e => e.stage));
    check(stages.has('correctness'), 'missing correctness artifact reference');
    // Do not confuse modeled hardware numbers with measurements. For now,
    // ASIC reports cannot say MEASURED: a fabricated silicon / lab-test
    // provenance stage is not part of this evidence schema.
    if (r.status === 'MEASURED') {
      check(r.family !== 'asic', 'ASIC measured silicon admission is not implemented');
      if (r.family === 'software')
        check(stages.has('benchmark'), 'software measurement requires benchmark artifact');
      if (r.family === 'fpga')
        check(stages.has('place-route') && stages.has('board') &&
          stages.has('benchmark'), 'FPGA measurement needs P&R, board and benchmark artifacts');
    }
    if (r.status === 'PLACE_ROUTE_VERIFIED') check(r.family === 'fpga' &&
      stages.has('place-route'), 'place-route evidence required for FPGA');
    if (r.status === 'SYNTH_ONLY') check(r.family !== 'software' &&
      stages.has('synthesis'), 'synthesis evidence required for hardware');
    if (r.status === 'SIMULATED_ONLY') check(r.family !== 'software' &&
      stages.has('simulation'), 'simulation evidence required for hardware');
    if (r.family === 'asic' && r.kind === 'power')
      check(stages.has('power-model'), 'ASIC power requires power-model evidence (switching/library model)');
  } else {
    check(r.samples.length === 0 && r.evidence.length === 0,
      'unverified/failed status cannot report promoted measurements');
    check(r.correctness !== 'PASS', 'unsupported/failed status cannot claim correctness PASS');
  }
  return Object.freeze({structurally_valid:true, status:r.status, family:r.family,
    backend:r.backend, metric:r.kind, sample_count:r.samples.length,
    provenance_authenticated:false, benchmark_execution_authenticated:false,
    performance_claim_certified:false,
    required_next_gate:'INDEPENDENT_TOOLCHAIN_SOURCE_AND_RAW_ARTIFACT_ATTESTATION'});
}
