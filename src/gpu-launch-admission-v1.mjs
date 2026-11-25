/**
 * Conservative GPU launch-contract REFERENCE MODEL, not an AttoLang compiler,
 * capability authenticator, scheduler, device driver, or proof of CUDA execution.
 * A positive result admits only the descriptor shape. Never use it to claim
 * that hardware, device allocation, effect proofs or actual kernels exist.
 */
const error = (code, detail) => {
  const e = new TypeError(`${code}: ${detail}`);
  e.code = code;
  throw e;
};
const fail = (c, why) => error(c, why);
const isRecord = x => x !== null && typeof x === 'object' &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
function fields(x, names, label) {
  if (!isRecord(x)) fail('INVALID_DESCRIPTOR', `${label} must be an own-data record`);
  const d = Object.getOwnPropertyDescriptors(x);
  const ks = Reflect.ownKeys(x);
  if (ks.length !== names.length || !names.every(k =>
      Object.hasOwn(d, k) && Object.hasOwn(d[k], 'value') && d[k].enumerable === true))
    fail('INVALID_DESCRIPTOR', `${label} has missing, extra or accessor fields`);
  return Object.fromEntries(names.map(k => [k, d[k].value]));
}
function items(x, label, max = 64) {
  if (!Array.isArray(x) || Object.getPrototypeOf(x) !== Array.prototype ||
      x.length > max || !Number.isSafeInteger(x.length))
    fail('INVALID_DESCRIPTOR', `${label} is not a bounded plain array`);
  const keys = Reflect.ownKeys(x);
  if (keys.length !== x.length + 1) fail('INVALID_DESCRIPTOR', `${label} has extra keys or holes`);
  return Array.from({length: x.length}, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(x, String(i));
    if (!d || !Object.hasOwn(d, 'value') || d.enumerable !== true)
      fail('INVALID_DESCRIPTOR', `${label} contains a hole or accessor`);
    return d.value;
  });
}
const ident = x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(x);
function uid(x, label) {
  if (!ident(x)) fail('INVALID_ID', label);
  return x;
}
function uint(x, label, minimum = 0) {
  if (!Number.isSafeInteger(x) || x < minimum)
    fail('INVALID_INTEGER', label);
  return BigInt(x);
}
function positiveTriple(x, label) {
  const a = items(x, label, 3);
  if (a.length !== 3) fail('INVALID_DIMENSIONS', label);
  return a.map((v, i) => uint(v, `${label}[${i}]`, 1));
}
const product = a => a.reduce((p, v) => p * v, 1n);
const isSubset = (required, available, code, label) => {
  for (const name of required) if (!available.includes(name)) fail(code, `${label}: ${name}`);
};
function names(x, label, allowed) {
  const a = items(x, label);
  if (a.some(n => typeof n !== 'string' || !allowed.includes(n)) || new Set(a).size !== a.length)
    fail('INVALID_FEATURE', `${label} must be unique and known`);
  return a;
}
const features = ['async_copy', 'cluster', 'cooperative_grid', 'subgroup', 'tensor'];
const scopes = ['thread', 'block', 'cluster', 'device', 'system'];
const effects = ['device.read', 'device.write', 'device.barrier', 'device.atomic'];
/** Static schema validation only. Successful results CANNOT attest physical GPU support. */
export function validate_gpu_launch_v1(input) {
  const {backend, tenant_id, device, capability, kernel, grid, block, shared_bytes, buffers} =
    fields(input, ['backend', 'tenant_id', 'device', 'capability', 'kernel',
      'grid', 'block', 'shared_bytes', 'buffers'], 'launch');
  if (backend !== 'gpu') fail('NO_CPU_FALLBACK', 'explicit GPU launch cannot target CPU');
  uid(tenant_id, 'tenant_id');
  const d = fields(device, ['id', 'tenant_id', 'max_grid', 'max_block',
    'max_threads_per_block', 'max_shared_bytes', 'features', 'atomic_scopes'], 'device');
  uid(d.id, 'device.id'); uid(d.tenant_id, 'device.tenant_id');
  if (d.tenant_id !== tenant_id) fail('TENANT_MISMATCH', 'device tenant');
  const limG = positiveTriple(d.max_grid, 'device.max_grid');
  const limB = positiveTriple(d.max_block, 'device.max_block');
  const maxBlockThreads = uint(d.max_threads_per_block, 'max_threads_per_block', 1);
  const maxShared = uint(d.max_shared_bytes, 'max_shared_bytes');
  if (maxBlockThreads > product(limB)) fail('INVALID_DEVICE_LIMITS', 'block cap exceeds dimensions');
  const devFeatures = names(d.features, 'device.features', features);
  const devScopes = names(d.atomic_scopes, 'device.atomic_scopes', scopes);
  const cap = fields(capability, ['tenant_id', 'device_id', 'gpu',
    'max_threads_per_launch', 'max_device_bytes'], 'capability');
  if (cap.tenant_id !== tenant_id || cap.device_id !== d.id)
    fail('CAPABILITY_MISMATCH', 'capability tenant/device identity');
  if (cap.gpu !== true) fail('GPU_CAPABILITY_REQUIRED', 'gpu capability is absent');
  const capThreads = uint(cap.max_threads_per_launch, 'max_threads_per_launch', 1);
  const capBytes = uint(cap.max_device_bytes, 'max_device_bytes', 1);
  const k = fields(kernel, ['name', 'effects', 'features', 'atomic_scopes',
    'uniform_barrier'], 'kernel');
  uid(k.name, 'kernel.name');
  const kEffects = names(k.effects, 'kernel.effects', effects);
  const kFeatures = names(k.features, 'kernel.features', features);
  const kScopes = names(k.atomic_scopes, 'kernel.atomic_scopes', scopes);
  if (typeof k.uniform_barrier !== 'boolean') fail('INVALID_DESCRIPTOR', 'kernel.uniform_barrier');
  isSubset(kFeatures, devFeatures, 'UNSUPPORTED_FEATURE', 'device feature');
  isSubset(kScopes, devScopes, 'UNSUPPORTED_SCOPE', 'atomic scope');
  if (kScopes.length && !kEffects.includes('device.atomic'))
    fail('INVALID_DEVICE_EFFECT', 'atomic scopes require device.atomic');
  if (kEffects.includes('device.atomic') && !kScopes.length)
    fail('INVALID_DEVICE_EFFECT', 'device.atomic requires declared scope');
  if (kScopes.includes('cluster') && !kFeatures.includes('cluster'))
    fail('UNSUPPORTED_FEATURE', 'cluster atomic needs cluster feature');
  if (kEffects.includes('device.barrier') && !k.uniform_barrier)
    fail('DIVERGENT_BARRIER', 'compiler must establish uniform barrier reachability');
  const g = positiveTriple(grid, 'grid'), b = positiveTriple(block, 'block');
  for (let i = 0; i < 3; i++) {
    if (g[i] > limG[i] || b[i] > limB[i])
      fail('LAUNCH_LIMIT', `grid/block dimension ${i}`);
  }
  const threadsPerBlock = product(b);
  if (threadsPerBlock > maxBlockThreads) fail('LAUNCH_LIMIT', 'threads per block');
  const totalThreads = product(g) * threadsPerBlock;
  if (totalThreads > capThreads) fail('LAUNCH_QUOTA', 'total logical threads');
  if (uint(shared_bytes, 'shared_bytes') > maxShared)
    fail('SHARED_MEMORY_LIMIT', 'per-block shared bytes');
  const bs = items(buffers, 'buffers');
  if (bs.length === 0) fail('EMPTY_LAUNCH', 'requires typed device buffers');
  const allocations = new Map();
  let totalResident = 0n, hasWrite = false, hasRead = false;
  for (const raw of bs) {
    const b = fields(raw, ['tenant_id', 'device_id', 'allocation_id', 'generation',
      'allocation_bytes', 'offset_bytes', 'length_bytes', 'access', 'layout',
      'element_bytes', 'fence_state'], 'buffer');
    uid(b.allocation_id, 'allocation_id');
    if (b.tenant_id !== tenant_id || b.device_id !== d.id)
      fail('BUFFER_DOMAIN', 'buffer tenant/device mismatch');
    const generation = uint(b.generation, 'generation', 1);
    const allocationBytes = uint(b.allocation_bytes, 'allocation_bytes', 1);
    const offset = uint(b.offset_bytes, 'offset_bytes');
    const length = uint(b.length_bytes, 'length_bytes', 1);
    const elementBytes = uint(b.element_bytes, 'element_bytes', 1);
    if (![1n,2n,4n,8n,16n].includes(elementBytes) ||
        offset % elementBytes !== 0n || length % elementBytes !== 0n ||
        offset + length > allocationBytes)
      fail('BUFFER_BOUNDS', 'invalid element size, alignment or range');
    if (!['aos','soa','aosoa'].includes(b.layout)) fail('BUFFER_LAYOUT', 'layout');
    if (!['read','write','read_write'].includes(b.access)) fail('BUFFER_ACCESS', 'access');
    if (b.fence_state !== 'idle') fail('IN_FLIGHT_BUFFER', 'pending loan or device fence');
    hasWrite ||= b.access !== 'read';
    hasRead ||= b.access !== 'write';
    const old = allocations.get(b.allocation_id);
    if (old) {
      if (old.generation !== generation || old.allocationBytes !== allocationBytes)
        fail('STALE_ALLOCATION', 'same allocation with inconsistent generation/capacity');
      if (old.writable || b.access !== 'read')
        fail('WRITE_ALIAS', 'overlapping or indistinguishable device allocation loans');
    } else {
      allocations.set(b.allocation_id, {generation, allocationBytes, writable:b.access !== 'read'});
      totalResident += allocationBytes;
      if (totalResident > capBytes) fail('DEVICE_QUOTA', 'resident allocation reservation');
    }
  }
  if (hasWrite && !kEffects.includes('device.write'))
    fail('INVALID_DEVICE_EFFECT', 'writable buffer without device.write');
  if (hasRead && !kEffects.includes('device.read'))
    fail('INVALID_DEVICE_EFFECT', 'readable buffer without device.read');
  return Object.freeze({admission:'STATIC_SCHEMA_ONLY', physical_gpu_verified:false,
    logical_threads:totalThreads.toString(), threads_per_block:threadsPerBlock.toString(),
    reserved_allocation_bytes:totalResident.toString(), device_id:d.id,
    buffer_bindings:bs.length});
}
