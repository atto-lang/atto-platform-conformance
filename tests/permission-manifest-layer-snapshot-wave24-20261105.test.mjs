import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS, denyAllPolicy, validatePolicy, serializeManifest,
  parseManifest, evaluatePermission,
} from '../src/permission-manifest.mjs';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);
function policy(allow = [], deny = []) {
  return Object.fromEntries(PERMISSIONS.map(permission => [
    permission, {allow: [...allow], deny: [...deny]},
  ]));
}
function layers(allow = ['*'], deny = []) {
  return {
    actor: policy(allow, deny), artifact: policy(allow, deny),
    delegated: policy(allow, deny), host: policy(allow, deny),
    runtime: policy(allow, deny),
  };
}

test('canonical manifest verifies trusted artifact and freezes nested policy', () => {
  const raw = serializeManifest({
    format: 'oreslang.permissions', version: 1,
    artifact_sha256: SHA, policy: denyAllPolicy(),
  });
  const parsed = parseManifest(raw, SHA);
  assert.equal(parsed.artifact_sha256, SHA);
  assert.ok(Object.isFrozen(parsed.policy.read.allow));
  assert.ok(Object.isFrozen(parsed.policy.read.deny));
  assert.ok(Object.isFrozen(parsed.policy.read));
  assert.throws(() => parseManifest(raw, OTHER_SHA), /digest/);
});

test('canonical manifest does not re-read caller policy after serialization', () => {
  const mutable = denyAllPolicy();
  mutable.net.allow.push('endpoint');
  const raw = serializeManifest({
    format: 'oreslang.permissions', version: 1,
    artifact_sha256: SHA, policy: mutable,
  });
  mutable.net.allow.push('new-authority');
  const parsed = parseManifest(raw, SHA);
  assert.deepEqual(parsed.policy.net.allow, ['endpoint']);
});

test('a deny in any one authority layer overrides all wildcard grants', () => {
  const input = layers();
  input.delegated.read.deny.push('blocked');
  assert.equal(evaluatePermission(input, 'read', 'blocked',
    (_permission, resource, scope) => resource === scope), false);
  assert.equal(evaluatePermission(input, 'read', 'public',
    (_permission, resource, scope) => resource === scope), true);
});

test('all five authority layers must grant permission', () => {
  const input = layers();
  input.runtime.write.allow = [];
  assert.equal(evaluatePermission(input, 'write', 'resource', () => true), false);
});

test('wildcard matching does not delegate authority to matcher callback', () => {
  assert.equal(evaluatePermission(layers(), 'read', 'resource', () => {
    throw new Error('untrusted matcher unexpectedly called');
  }), true);
});

test('truthy nonboolean matcher cannot grant privileged operation', () => {
  assert.throws(() => evaluatePermission(layers(['scope']), 'net',
    'resource', () => 'true'), /boolean/);
});

test('matcher outcome is memoized across all five authority layers', () => {
  let calls = 0;
  const input = layers(['same-scope']);
  assert.equal(evaluatePermission(input, 'read', 'resource',
    () => { calls++; return true; }), true);
  assert.equal(calls, 1);
});

test('accessor and extraneous authority fields reject before use', () => {
  const input = policy();
  Object.defineProperty(input.read, 'allow', {enumerable: true, get() {
    throw new Error('accessor must not execute');
  }});
  assert.throws(() => validatePolicy(input), /own data/);
  const extra = policy();
  extra.read.admin = true;
  assert.throws(() => validatePolicy(extra), /missing or unknown/);
});

test('unpaired UTF-16 surrogate cannot cross native scope boundary', () => {
  const input = policy();
  input.read.allow.push('\ud800');
  assert.throws(() => validatePolicy(input), /invalid scope/);
});

test('missing authority layer fails closed before invoking matcher', () => {
  const input = layers();
  delete input.actor;
  assert.throws(() => evaluatePermission(input, 'read', 'resource', () => {
    throw new Error('should not evaluate incomplete authority');
  }), /missing or unknown keys/);
});
