// SOURCE-FREE admission reference only. The host descriptor is a hypothetical
// trusted supervisor input, NOT a guest-supplied JSON certificate or OS proof.
const BACKENDS = new Set(['java','llvm','wasm','net','forge']);
const MODES = new Set(['aot','jit','interpreted']);
const FORMATS = new Set(['wasm','truffle','cil','native']);
const LIMITS = ['guestMemoryBytes','hostMemoryBytes','actorCount','mailboxBytes','wallTimeMs'];
const HEX_SHA = /^[0-9a-f]{64}$/;

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`INVALID_${label}`);
}
function exactKeys(value, keys, label) {
  requireRecord(value,label);
  if (Object.keys(value).length !== keys.length ||
      Object.keys(value).some(k=>!keys.includes(k))) throw new Error(`INVALID_${label}_FIELDS`);
}
function positiveLimits(value, label) {
  exactKeys(value,LIMITS,label);
  for (const k of LIMITS) if (!Number.isSafeInteger(value[k]) || value[k] <= 0)
    throw new Error(`INVALID_${label}_${k}`);
}
function stringSet(values,label) {
  if (!Array.isArray(values) || values.some(x=>typeof x !== 'string' || !x.length) ||
      new Set(values).size !== values.length) throw new Error(`INVALID_${label}`);
}
function ensure(yes,code) { if (!yes) throw new Error(code); }

/**
 * Evaluate a hypothetical host's untrusted actor profile. Never use returned
 * admission for live authorization: the source-free model cannot authenticate
 * descriptor fields, OS controls, guest code, or compiler provenance.
 */
export function assessUntrustedExecution(request, host) {
  exactKeys(request,['backend','trust','mode','guestFormat','imageSha256','capabilities','quotas'],'REQUEST');
  exactKeys(host,['backend','hostKind','supportedModes','supportedFormats','verifiedImageSha256',
    'trustedSupervisor','perTenantVmIsolate','isolateTermination','osProcessSandbox',
    'preemption','guestHeapQuota','hostHeapQuota','mailboxQuota','capabilityBroker',
    'allowedCapabilities','limits','jitWxEnforced','boundedJitCompilation','wasmJitEngine'],'HOST');
  ensure(BACKENDS.has(request.backend),'UNKNOWN_BACKEND');
  ensure(request.trust === 'untrusted','NOT_UNTRUSTED_PROFILE');
  ensure(MODES.has(request.mode),'UNKNOWN_COMPILATION_MODE');
  ensure(FORMATS.has(request.guestFormat),'UNKNOWN_GUEST_FORMAT');
  ensure(HEX_SHA.test(request.imageSha256),'INVALID_IMAGE_SHA256');
  stringSet(request.capabilities,'REQUEST_CAPABILITIES');
  positiveLimits(request.quotas,'REQUEST_QUOTAS');
  ensure(host.backend === request.backend,'BACKEND_MISMATCH');
  ensure(['native-aot','managed-jit','native','graal'].includes(host.hostKind),'UNKNOWN_HOST_KIND');
  stringSet(host.supportedModes,'HOST_MODES');
  stringSet(host.supportedFormats,'HOST_FORMATS');
  stringSet(host.allowedCapabilities,'HOST_CAPABILITIES');
  positiveLimits(host.limits,'HOST_LIMITS');
  ensure(typeof host.osProcessSandbox === 'boolean','INVALID_HOST_OS_PROCESS_SANDBOX');
  ensure(host.trustedSupervisor === true,'AUTHENTICATED_SUPERVISOR_REQUIRED');
  ensure(host.verifiedImageSha256 === request.imageSha256,'UNVERIFIED_IMAGE');
  // Tenants share one process (tenant-isolation v2). Only code from a trusted
  // producer can be confined to a per-tenant isolate there.
  if (request.guestFormat === 'native') throw new Error('UNTRUSTED_NATIVE_CODE_REFUSED');
  if (request.guestFormat === 'cil') throw new Error('UNTRUSTED_CIL_REFUSED');
  ensure(host.supportedModes.includes(request.mode),'UNSUPPORTED_COMPILATION_MODE');
  ensure(host.supportedFormats.includes(request.guestFormat),'UNSUPPORTED_GUEST_FORMAT');
  // A process sandbox is optional defense in depth; it neither replaces nor
  // is required by the per-tenant isolate.
  ensure(host.perTenantVmIsolate === true,'VM_ISOLATE_REQUIRED');
  ensure(host.isolateTermination === true,'ISOLATE_TERMINATION_REQUIRED');
  // Killing the whole process would end every tenant, so it is not a
  // preemption mechanism for one tenant.
  ensure(['fuel','epoch','bounded-safepoints','carrier-interrupt'].includes(host.preemption),'PREEMPTION_REQUIRED');
  ensure(host.guestHeapQuota === true && host.hostHeapQuota === true && host.mailboxQuota === true,
    'RESOURCE_ENFORCEMENT_REQUIRED');
  ensure(host.capabilityBroker === true,'CAPABILITY_BROKER_REQUIRED');
  for (const capability of request.capabilities)
    ensure(host.allowedCapabilities.includes(capability),'CAPABILITY_DENIED');
  for (const key of LIMITS) ensure(request.quotas[key] <= host.limits[key],'RESOURCE_QUOTA_EXCEEDED');
  // Truffle guests are confined by a Graal isolate and stopped at safepoints.
  if (request.guestFormat === 'truffle') {
    ensure(host.hostKind === 'graal','TRUFFLE_REQUIRES_GRAAL_ISOLATE');
    ensure(host.preemption === 'bounded-safepoints','TRUFFLE_SAFEPOINTS_REQUIRED');
  }
  if (request.mode === 'jit') {
    ensure(host.jitWxEnforced === true && host.boundedJitCompilation === true,'JIT_GOVERNANCE_REQUIRED');
    // A NativeAOT process MAY embed a separately governed Wasm JIT.
    if (request.guestFormat === 'wasm' && host.hostKind === 'native-aot')
      ensure(host.wasmJitEngine === true,'WASM_JIT_ENGINE_REQUIRED');
  }
  return Object.freeze({status:'SOURCE_FREE_MODEL_ADMISSIBLE',admissibleInModel:true,
    productionCertified:false,backend:request.backend,mode:request.mode,trust:request.trust});
}
