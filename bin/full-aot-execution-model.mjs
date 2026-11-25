import { createHash } from 'node:crypto';

const HEX40 = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CASE_PREFIX = 'fixtures/full-aot/';

export function gitBlobSha(bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1')
    .update(Buffer.from('blob ' + payload.length + '\0'))
    .update(payload).digest('hex');
}

export function validateContract(manifest) {
  if (manifest?.schema !== 'atto.full-aot-executable-gates.v1' ||
      manifest.version !== 1 || manifest.status !== 'NOT_EXECUTED_ALL_BACKENDS') {
    throw new Error('invalid or promoted full-AOT contract status/schema');
  }
  const profiles = manifest.profiles;
  if (!profiles || typeof profiles !== 'object' ||
      Object.keys(profiles).length !== 6 ||
      !Object.hasOwn(profiles, 'rust-source-wasm')) {
    throw new Error('expected exactly six declared AOT profile types');
  }
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile || profile.status !== 'not_executed' || profile.aot_source_lowering !== true) {
      throw new Error('source registry cannot self-certify profile ' + name);
    }
    if (name === 'rust-source-wasm') {
      if (profile.full_native_aot !== false || profile.runtime_engine_jit !== 'engine-dependent') {
        throw new Error('browser Wasm may use an engine JIT; cannot claim native AOT');
      }
    } else if (profile.full_native_aot !== true || profile.runtime_engine_jit !== 'forbidden') {
      throw new Error(name + ': native AOT requires no runtime JIT dependency');
    }
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 9) {
    throw new Error('expected four guest and five rejection fixtures');
  }
  const seen = new Set();
  const paths = new Set();
  let positives = 0, negatives = 0;
  for (const c of manifest.cases) {
    if (!c || !ID.test(c.id) || !ID.test(c.feature_id) ||
        seen.has(c.id) || paths.has(c.fixture)) {
      throw new Error('invalid/duplicate AOT case or fixture');
    }
    seen.add(c.id);
    paths.add(c.fixture);
    if (c.status !== 'not_executed') throw new Error('source case cannot self-certify');
    if (!HEX40.test(c.git_blob_sha) || typeof c.fixture !== 'string' ||
        !c.fixture.startsWith(CASE_PREFIX) ||
        c.fixture.includes('..') || c.fixture.includes('\\') ||
        !c.fixture.endsWith('.atto')) {
      throw new Error('non-canonical or unpinned AOT fixture');
    }
    if (c.kind === 'compiled_guest') {
      if (!c.fixture.startsWith(CASE_PREFIX + 'positive/') ||
          !/^-?\d+$/.test(c.expected_main_i64 ?? '') ||
          c.must_have_zero_imports !== true) {
        throw new Error('compiled guest needs exact i64 and no-import expectation');
      }
      const expected = BigInt(c.expected_main_i64);
      if (expected < -(1n << 63n) || expected >= (1n << 63n)) {
        throw new Error('expected result exceeds i64');
      }
      positives++;
    } else if (c.kind === 'no_artifact') {
      if (!c.fixture.startsWith(CASE_PREFIX + 'negative/') ||
          Object.hasOwn(c, 'expected_main_i64')) {
        throw new Error('rejection fixture cannot carry an executable result');
      }
      negatives++;
    } else {
      throw new Error('unknown AOT case execution kind');
    }
  }
  if (positives !== 4 || negatives !== 5 ||
      !manifest.required_evidence?.includes('guest_executed') ||
      !manifest.required_evidence?.includes('compiler_source_tree_sha') ||
      !manifest.required_evidence?.includes('guest_module_sha256') ||
      manifest.unsupported_policy !== 'fail_closed_not_executed_no_certification') {
    throw new Error('missing mandatory execution/provenance gates');
  }
  return manifest.cases;
}
