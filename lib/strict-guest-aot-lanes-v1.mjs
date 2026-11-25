// Source-only 16-lane release inventory checker. Never certifies artifacts or execution.
const BACKENDS = Object.freeze(['java-graalvm', 'llvm', 'net-nativeaot', 'forge']);
const PLATFORMS = Object.freeze(['linux-x64', 'linux-arm64', 'windows-x64', 'macos-arm64']);
const FORMATS = Object.freeze({ 'linux-x64':'ELF64', 'linux-arm64':'ELF64',
  'windows-x64':'PE32+', 'macos-arm64':'Mach-O64' });
const CASES = Object.freeze(['guest-return-42', 'guest-return-14',
  'checked-overflow-reject', 'unsupported-guest-reject']);
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function exact_keys(obj, keys) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).sort().join('\0') === [...keys].sort().join('\0');
}
function exact_array(value, expected) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((item, i) => item === expected[i]);
}
export function inspect_strict_aot_inventory(value) {
  if (!exact_keys(value, ['schemaVersion','id','status','policy','sourceContract',
    'signedArtifactDependency','backends','platforms','requiredCases','lanes','wasmProducts']))
    fail('invalid-inventory-fields');
  if (value.schemaVersion !== 1 || value.id !== 'strict-guest-aot-native-release-lanes-v1' ||
      value.status !== 'NOT_EXECUTED') fail('invalid-inventory-status');
  if (typeof value.policy !== 'string' || typeof value.sourceContract !== 'string' ||
      typeof value.signedArtifactDependency !== 'string' ||
      !value.policy.includes('does not attest') ||
      !value.signedArtifactDependency.includes('PR #325')) fail('invalid-inventory-policy');
  if (!exact_array(value.backends, BACKENDS) ||
      !exact_array(value.platforms, PLATFORMS) ||
      !exact_array(value.requiredCases, CASES)) fail('invalid-inventory-dimensions');
  if (!Array.isArray(value.lanes) || value.lanes.length !== 16)
    fail('invalid-native-lane-count');
  const ids = new Set();
  for (let i = 0; i < value.lanes.length; i++) {
    const lane = value.lanes[i];
    if (!exact_keys(lane, ['id','backend','platform','artifactFormat',
      'mode','status','receipt'])) fail('invalid-lane-fields');
    const backend = BACKENDS[Math.floor(i / PLATFORMS.length)];
    const platform = PLATFORMS[i % PLATFORMS.length];
    if (lane.backend !== backend || lane.platform !== platform ||
        lane.id !== backend + '-' + platform || ids.has(lane.id) ||
        lane.artifactFormat !== FORMATS[platform] ||
        lane.mode !== 'program-specific-full-guest-aot' ||
        lane.status !== 'NOT_EXECUTED' || lane.receipt !== null)
      fail('invalid-native-lane');
    ids.add(lane.id);
  }
  if (!Array.isArray(value.wasmProducts) || value.wasmProducts.length !== 2)
    fail('invalid-wasm-products');
  const idsWasm = ['portable-wasm','precompiled-wasm-host'];
  for (let i = 0; i < 2; i++) {
    const p = value.wasmProducts[i];
    if (!exact_keys(p, ['id','status','proof']) || p.id !== idsWasm[i] ||
        p.status !== 'NOT_EXECUTED' || typeof p.proof !== 'string' ||
        p.proof.length < 20) fail('invalid-wasm-product');
  }
  return Object.freeze({status:'INVENTORY_VALID_UNATTESTED',nativeLanes:16,
    verifiedNativeLanes:0, wasmProducts:2, releaseReady:false});
}
