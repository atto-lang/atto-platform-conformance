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

test('verified policy rejects post-verification authority mutation', () => {
  const granted = scoped('net', ['api.example.com:443'], ['blocked.example.com:443']);
  const verified = parseManifest(serializeManifest(manifest(granted)), artifact);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.policy), true);
  assert.equal(Object.isFrozen(verified.policy.net), true);
  assert.equal(Object.isFrozen(verified.policy.net.allow), true);
  assert.equal(Object.isFrozen(verified.policy.net.deny), true);
  assert.throws(() => verified.policy.net.allow.push('*'), TypeError);
  assert.throws(() => verified.policy.net.deny.pop(), TypeError);
  assert.throws(() => { verified.policy.net.allow = ['*']; }, TypeError);
  assert.throws(() => { verified.policy.net = {allow: ['*'], deny: []}; }, TypeError);
  assert.deepEqual(verified.policy.net, {
    allow: ['api.example.com:443'], deny: ['blocked.example.com:443'],
  });
});

test('unpaired Unicode surrogates do not cross policy or resource boundaries', () => {
  for (const invalid of ['\uD800', '\uDC00', 'root\uD800', 'root\uDC00']) {
    assert.throws(() => validatePolicy(scoped('read', [invalid])));
    assert.throws(() => serializeManifest(manifest(scoped('read', [invalid]))));
  }
  const valid = scoped('read', ['path/\uD83D\uDE00']);
  assert.deepEqual(parseManifest(serializeManifest(manifest(valid)), artifact).policy.read.allow,
                   ['path/\uD83D\uDE00']);
  const all = scoped('read', ['*']);
  const layers = {host: all, artifact: all, runtime: all, actor: all, delegated: all};
  assert.throws(() => evaluatePermission(layers, 'read', '\uD800', matches));
});

test('resource matchers must return a boolean in grants and explicit denies', () => {
  const specific = scoped('net', ['api.example.com:443']);
  const layers = {host: specific, artifact: specific, runtime: specific,
                  actor: specific, delegated: specific};
  for (const invalid of ['true', {}, 1, null, undefined]) {
    assert.throws(() => evaluatePermission(
      layers, 'net', 'api.example.com:443', () => invalid));
    const denyLayers = {...layers, host: scoped('net', ['*'], ['api.example.com:443'])};
    assert.throws(() => evaluatePermission(
      denyLayers, 'net', 'api.example.com:443', () => invalid));
  }
  assert.equal(evaluatePermission(layers, 'net', 'api.example.com:443', matches), true);
});

test('all authority layers are validated and snapshotted before matcher callbacks', () => {
  const allowed = scoped('read', ['/safe']);
  const delegated = scoped('read', ['/safe'], ['/safe']);
  const layers = {host: allowed, artifact: allowed, runtime: allowed,
                  actor: allowed, delegated};
  let called = 0;
  const reentrantMatcher = (_permission, resource, scope) => {
    if (++called === 1) delegated.read.deny.length = 0;
    return resource === scope;
  };
  // The delegated deny at decision start must survive mutation from a
  // reentrant matcher invoked for an earlier authority layer.
  assert.equal(evaluatePermission(layers, 'read', '/safe', reentrantMatcher), false);
  assert.ok(called > 0);
  assert.deepEqual(delegated.read.deny, []);

  // An invalid later layer must fail before the matcher can run or observe
  // any authority, even if an earlier layer would deny the resource.
  let matcherCalled = false;
  const malformed = {...layers, host: denyAllPolicy(),
                     delegated: {read: {allow: ['*'], deny: []}}};
  assert.throws(() => evaluatePermission(
    malformed, 'read', '/safe', () => { matcherCalled = true; return true; }));
  assert.equal(matcherCalled, false);
});

test('inconsistent matchers cannot promote an overlapping explicit deny into a grant', () => {
  const scope = 'api.example.com:443';
  const overlap = scoped('net', [scope], [scope]);
  const grant = scoped('net', [scope]);
  const layers = {host: overlap, artifact: grant, runtime: grant,
                  actor: grant, delegated: grant};
  let invocations = 0;
  const flippingMatcher = () => (++invocations > 1);
  // Original behavior: the first host deny returned false; host allow
  // and all later grants returned true. No other layer had a deny,
  // so the explicitly denied host scope was incorrectly authorized.
  assert.equal(evaluatePermission(layers, 'net', scope, flippingMatcher), false);
  assert.equal(invocations, 1, 'matcher must be called once per unique scope');
});

test('one authorization uses a single match result across five layers', () => {
  const scope = '/safe/file.txt';
  const all = scoped('read', [scope]);
  const layers = {host: all, artifact: all, runtime: all,
                  actor: all, delegated: all};
  let invocations = 0;
  assert.equal(evaluatePermission(layers, 'read', scope, () => {
    invocations++;
    return invocations === 1;
  }), true);
  assert.equal(invocations, 1);
});

test('every explicit deny is matched before any positive grant', () => {
  const layers = {host: scoped('read', ['/safe'], ['/blocked']),
                  artifact: scoped('read', ['/safe']),
                  runtime: scoped('read', ['/safe']),
                  actor: scoped('read', ['/safe']),
                  delegated: scoped('read', ['/safe'], ['/other'])};
  const seen = [];
  assert.equal(evaluatePermission(layers, 'read', '/safe', (_, resource, scope) => {
    seen.push(scope);
    return resource === scope;
  }), true);
  assert.deepEqual(seen, ['/blocked', '/other', '/safe']);
});
