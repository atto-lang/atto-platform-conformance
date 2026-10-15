/** Oreslang permission manifest v1 reference verifier: not an OS sandbox. */
import { timingSafeEqual } from 'node:crypto';

export const PERMISSIONS = Object.freeze(['read','write','net','env','run','sys','ffi','import']);
const FORMAT = 'oreslang.permissions';
const MAX_BYTES = 65536;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

// JavaScript strings can contain unpaired UTF-16 surrogates. Node encodes
// those as U+FFFD in UTF-8, so a validated scope can change its identity
// at a cross-language manifest/native API boundary.
function validUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (++i >= value.length) return false;
      const low = value.charCodeAt(i);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function exactKeys(value, names, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(label + ' must be an object');
  const keys = Object.keys(value).sort();
  if (keys.length !== names.length || names.some((name, i) => keys[i] !== name))
    throw new TypeError(label + ' has missing or unknown keys');
}
function scopes(values, name) {
  if (!Array.isArray(values) || values.length > 128)
    throw new TypeError(name + ' must be a bounded array');
  const seen = new Set();
  for (const item of values) {
    if (typeof item !== 'string' || !item || item.trim() !== item ||
        Buffer.byteLength(item, 'utf8') > 4096 || CONTROL.test(item) ||
        item.includes('\uFFFD') || !validUnicode(item))
      throw new TypeError(name + ' has an invalid scope');
    if (seen.has(item)) throw new TypeError(name + ' has a duplicate scope');
    seen.add(item);
  }
  return [...values].sort();
}
function immutablePolicy(input) {
  const policy = validatePolicy(input);
  for (const permission of PERMISSIONS) {
    Object.freeze(policy[permission].allow);
    Object.freeze(policy[permission].deny);
    Object.freeze(policy[permission]);
  }
  return Object.freeze(policy);
}

export function denyAllPolicy() {
  return Object.fromEntries(PERMISSIONS.map(p => [p, {allow: [], deny: []}]));
}
export function validatePolicy(input) {
  exactKeys(input, [...PERMISSIONS].sort(), 'policy');
  return Object.fromEntries(PERMISSIONS.map(p => {
    exactKeys(input[p], ['allow', 'deny'], p);
    return [p, {allow: scopes(input[p].allow, p + '.allow'),
                deny: scopes(input[p].deny, p + '.deny')}];
  }));
}
/**
 * The digest must be supplied independently by a trusted artifact verifier.
 * A digest in a mutable manifest is not a signature or proof of authority.
 */
export function serializeManifest(manifest) {
  exactKeys(manifest, ['artifact_sha256','format','policy','version'], 'manifest');
  if (manifest.format !== FORMAT || manifest.version !== 1 ||
      typeof manifest.artifact_sha256 !== 'string' ||
      !SHA256.test(manifest.artifact_sha256))
    throw new TypeError('unknown manifest version or artifact digest');
  const raw = JSON.stringify({
    format: FORMAT, version: 1, artifact_sha256: manifest.artifact_sha256,
    policy: validatePolicy(manifest.policy),
  });
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES)
    throw new RangeError('permission manifest exceeds 64 KiB');
  return raw;
}
export function parseManifest(raw, expectedArtifactSha256) {
  if (typeof expectedArtifactSha256 !== 'string' ||
      !SHA256.test(expectedArtifactSha256))
    throw new TypeError('trusted artifact SHA-256 is required');
  if (typeof raw !== 'string' || !raw ||
      Buffer.byteLength(raw, 'utf8') > MAX_BYTES ||
      CONTROL.test(raw) || raw.includes('\uFFFD') || !validUnicode(raw))
    throw new TypeError('invalid permission manifest representation');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new TypeError('invalid permission manifest JSON'); }
  // Exact canonical round-trip rejects duplicates, missing deny fields,
  // downgraded versions, unknown keys, whitespace and reordered keys.
  if (serializeManifest(parsed) !== raw)
    throw new TypeError('noncanonical or ambiguous permission manifest');
  if (!timingSafeEqual(Buffer.from(parsed.artifact_sha256, 'hex'),
                       Buffer.from(expectedArtifactSha256, 'hex')))
    throw new TypeError('manifest and artifact digest differ');
  return Object.freeze({
    format: FORMAT, version: 1, artifact_sha256: parsed.artifact_sha256,
    policy: immutablePolicy(parsed.policy),
  });
}
/**
 * Reference decision algebra only, NOT native enforcement. Actual resource
 * matching must be performed by a trusted, target-specific I/O backend.
 * Missing authority layers are errors; deny always overrides allow.
 */
export function evaluatePermission(layers, permission, resource, scopeMatches) {
  exactKeys(layers, ['actor','artifact','delegated','host','runtime'], 'layers');
  if (!PERMISSIONS.includes(permission) || typeof resource !== 'string' ||
      !resource || CONTROL.test(resource) || !validUnicode(resource) ||
      resource.includes('\uFFFD') || typeof scopeMatches !== 'function')
    throw new TypeError('invalid privileged operation');
  // A buggy matcher returning a truthy string or object is not proof of a
  // match. Especially for explicit denies, silently coercing the return
  // value could misapply the deny while still granting access.
  const matches = scope => {
    if (scope === '*') return true;
    const result = scopeMatches(permission, resource, scope);
    if (typeof result !== 'boolean')
      throw new TypeError('resource matcher must return a boolean');
    return result;
  };
  for (const name of ['host','artifact','runtime','actor','delegated']) {
    const rule = validatePolicy(layers[name])[permission];
    if (rule.deny.some(matches)) return false;
    if (!rule.allow.some(matches)) return false;
  }
  return true;
}
