import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  PERMISSIONS, denyAllPolicy, validatePolicy, serializeManifest,
  parseManifest, evaluatePermission,
} from '../src/permission-manifest.mjs';

const artifact = 'f'.repeat(64);
function manifest(policy = denyAllPolicy()) {
  return {format: 'oreslang.permissions', version: 1, artifact_sha256: artifact, policy};
}
function scoped(permission, allow, deny = []) {
  const policy = denyAllPolicy();
  policy[permission] = {allow, deny};
  return policy;
}
const matches = (_permission, resource, scope) => resource === scope;

test('explicit deny-all policy and canonical v1 round-trip', () => {
  const raw = serializeManifest(manifest());
  const restored = parseManifest(raw, artifact);
  assert.equal(serializeManifest(restored), raw);
  assert.equal(PERMISSIONS.length, 8);
  for (const key of PERMISSIONS) assert.deepEqual(restored.policy[key], {allow: [], deny: []});
});
test('missing, incorrect or malformed independently verified artifact digest is rejected', () => {
  const raw = serializeManifest(manifest());
  for (const digest of [undefined, '', 'g'.repeat(64), '0'.repeat(64)])
    assert.throws(() => parseManifest(raw, digest));
});
test('reject missing, truncated, duplicate, downgraded and noncanonical manifest data', () => {
  const raw = serializeManifest(manifest());
  const variants = [
    '', raw.slice(0, -1), raw + '\n', ' ' + raw,
    raw.replace('"version":1', '"version":0'),
    raw.replace('"version":1', '"version":2'),
    raw.replace('"format":"oreslang.permissions"', '"format":"unknown"'),
    raw.replace('"version":1', '"version":1,"version":1'),
    raw.replace('"deny":[]', '"deny":[],"deny":[]'),
    raw.replace('"read":', '"extra":{},"read":'),
    raw.replace('"read":', '"READ":{},"read":'),
    raw.replace('"allow":[],"deny":[]', '"allow":[]'),
    raw.replace('"artifact_sha256":', '"unused":null,"artifact_sha256":'),
  ];
  for (const value of variants) assert.throws(() => parseManifest(value, artifact));
});
test('scopes reject duplicates, control bytes, blanks, oversize values and unknown fields', () => {
  for (const invalid of [
    ['', '/tmp'], ['a', 'a'], [' trailing '], ['\u0000'], ['\uFFFD'],
    ['x'.repeat(4097)], Array.from({length: 129}, (_, i) => 'resource_' + i),
  ]) assert.throws(() => validatePolicy(scoped('read', invalid)));
  assert.throws(() => validatePolicy({...denyAllPolicy(),
    net: {allow: ['*'], deny: [], unexpected: true}}));
  assert.throws(() => serializeManifest({...manifest(), surprise: true}));
});
test('deny overrides unrestricted allow at each of five authority layers', () => {
  const allowed = scoped('env', ['*']);
  const layers = {host: allowed, artifact: allowed, runtime: allowed,
                  actor: allowed, delegated: allowed};
  assert.equal(evaluatePermission(layers, 'env', 'PUBLIC_KEY', matches), true);
  for (const name of Object.keys(layers)) {
    const altered = {...layers, [name]: scoped('env', ['*'], ['PUBLIC_KEY'])};
    assert.equal(evaluatePermission(altered, 'env', 'PUBLIC_KEY', matches), false);
    assert.equal(evaluatePermission(altered, 'env', 'PUBLIC_OTHER', matches), true);
  }
  assert.equal(evaluatePermission({...layers, actor: denyAllPolicy()},
                                   'env', 'PUBLIC_KEY', matches), false);
});
test('missing layer, matcher, resource or unknown permission cannot silently grant', () => {
  const all = scoped('net', ['*']);
  const layers = {host: all, artifact: all, runtime: all, actor: all, delegated: all};
  for (const name of Object.keys(layers)) {
    const changed = {...layers};
    delete changed[name];
    assert.throws(() => evaluatePermission(changed, 'net', 'example.com:443', matches));
  }
  assert.throws(() => evaluatePermission(layers, 'unknown', 'foo', matches));
  assert.throws(() => evaluatePermission(layers, 'net', '', matches));
  assert.throws(() => evaluatePermission(layers, 'net', 'example.com:443'));
});
test('runtime request cannot expand artifact ceiling or delegated child authority', () => {
  const all = scoped('read', ['*']);
  const ceiling = scoped('read', ['/safe']);
  const layers = {host: all, artifact: ceiling, runtime: all,
                  actor: all, delegated: all};
  assert.equal(evaluatePermission(layers, 'read', '/safe', matches), true);
  assert.equal(evaluatePermission(layers, 'read', '/unsafe', matches), false);
  assert.equal(evaluatePermission({...layers, runtime: denyAllPolicy()},
                                   'read', '/safe', matches), false);
  assert.equal(evaluatePermission({...layers, delegated: denyAllPolicy()},
                                   'read', '/safe', matches), false);
});
