import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  PERMISSIONS, denyAllPolicy, serializeManifest, parseManifest, evaluatePermission,
} from '../src/permission-manifest.mjs';

const sha = 'a'.repeat(64);
const matchExact = (_permission, resource, scope) => resource === scope;

function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
}

function policyFor(permission, resource, allow, deny) {
  const policy = denyAllPolicy();
  policy[permission] = {
    allow: allow ? [resource] : [],
    deny: deny ? [resource] : [],
  };
  return policy;
}

test('seeded 512-case authority lattice preserves deny override and monotonicity', () => {
  const next = rng(20261015);
  for (let i = 0; i < 512; i++) {
    const permission = PERMISSIONS[next() % PERMISSIONS.length];
    const resource = 'resource_' + i;
    const names = ['host', 'artifact', 'runtime', 'actor', 'delegated'];
    const allows = names.map(() => (next() & 1) !== 0);
    const denies = names.map(() => (next() & 7) === 0);
    const layers = Object.fromEntries(names.map((name, index) => [
      name, policyFor(permission, resource, allows[index], denies[index]),
    ]));
    const expected = allows.every(Boolean) && !denies.some(Boolean);
    assert.equal(evaluatePermission(layers, permission, resource, matchExact),
                 expected, 'iteration ' + i);
    for (const name of names) {
      const attenuated = {
        ...layers,
        [name]: policyFor(permission, resource, false, true),
      };
      assert.equal(evaluatePermission(attenuated, permission, resource, matchExact), false,
                   'attenuation unexpectedly expanded permission at ' + name);
    }
  }
});

test('seeded 128-case artifact manifest round-trips preserve exact grant sets', () => {
  const next = rng(19770927);
  for (let i = 0; i < 128; i++) {
    const policy = denyAllPolicy();
    for (const permission of PERMISSIONS) {
      const allows = [];
      const denies = [];
      if ((next() & 1) !== 0) allows.push('target_' + i);
      if ((next() & 3) === 0) denies.push('target_' + i);
      policy[permission] = {allow: allows, deny: denies};
    }
    const raw = serializeManifest({
      format: 'oreslang.permissions', version: 1, artifact_sha256: sha, policy,
    });
    const decoded = parseManifest(raw, sha);
    assert.equal(serializeManifest(decoded), raw);
    for (const permission of PERMISSIONS) {
      assert.deepEqual(decoded.policy[permission].allow, policy[permission].allow);
      assert.deepEqual(decoded.policy[permission].deny, policy[permission].deny);
      assert.equal(Object.isFrozen(decoded.policy[permission]), true);
    }
  }
});

test('maximum-scope budget never bypasses total manifest byte cap', () => {
  const policy = denyAllPolicy();
  const largeScopes = Array.from({length: 20}, (_, i) =>
    String(i).padStart(4, '0') + 'z'.repeat(4090));
  policy.net = {allow: largeScopes, deny: []};
  assert.throws(() => serializeManifest({
    format: 'oreslang.permissions', version: 1, artifact_sha256: sha, policy,
  }), RangeError);
});
