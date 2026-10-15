/** Oreslang permission manifest v1 reference verifier: not an OS sandbox. */
import { timingSafeEqual } from 'node:crypto';

export const PERMISSIONS = Object.freeze(['read','write','net','env','run','sys','ffi','import']);
const FORMAT = 'oreslang.permissions';
const MAX_BYTES = 65536;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

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
        item.includes('\uFFFD'))
      throw new TypeError(name + ' has an invalid scope');
    if (seen.has(item)) throw new TypeError(name + ' has a duplicate scope');
    seen.add(item);
  }
  return [...values].sort();
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
      CONTROL.test(raw) || raw.includes('\uFFFD'))
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
    policy: validatePolicy(parsed.policy),
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
      !resource || CONTROL.test(resource) || typeof scopeMatches !== 'function')
    throw new TypeError('invalid privileged operation');
  for (const name of ['host','artifact','runtime','actor','delegated']) {
    const rule = validatePolicy(layers[name])[permission];
    if (rule.deny.some(scope => scope === '*' || scopeMatches(permission, resource, scope)))
      return false;
    if (!rule.allow.some(scope => scope === '*' || scopeMatches(permission, resource, scope)))
      return false;
  }
  return true;
}
