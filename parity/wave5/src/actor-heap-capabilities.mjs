import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKENDS = ['java', 'llvm', 'net', 'forge', 'wasm'];
const LEVELS = ['host-reference', 'host-runtime', 'compiled-scalar', 'compiled-general'];
const RECLAMATION = ['gc-dependent', 'deterministic-native', 'deterministic-capacity-reuse'];
const AOT = ['not-certified', 'partial-native-subsets', 'full-aot'];
const ZERO = ['none', 'compiled-scalar-only', 'guest-general'];
const REQUIREMENTS = Object.freeze([
  "all ordinary mutable guest allocations are compiler-lowered into actor-owned domains",
  "persistent state survives turns and legal carrier migration while scratch cannot cross suspension",
  "foreign actor, stale generation and stolen carrier authority are rejected",
  "actor retirement is race-safe, retryable and does not refund physically pinned native bytes",
  "cycles do not require cross-actor circular ownership or a process-global guest tracing collector",
  "exact-head backend tests execute with visible runner steps and artifact/source provenance",
  "native backends prove full AOT with no guest interpreter or JIT fallback"
]);

const fail = message => { throw new Error('actor-heap-promotion: ' + message); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function shape(value, keys, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where + ' must be object');
  const actual = Object.keys(value);
  for (const key of keys) if (!own(value, key)) fail(where + ' missing ' + key);
  for (const key of actual) if (!keys.includes(key)) fail(where + ' unknown ' + key);
}

function deterministic(mode) {
  return mode === 'deterministic-native' || mode === 'deterministic-capacity-reuse';
}

export function validateActorHeapCapabilities(doc) {
  shape(doc, [
    'schemaVersion', 'status', 'certifiedSemanticActorHeapParity',
    'certifiedZeroGcFullAotParity', 'levels', 'reclamationModes',
    'backends', 'promotionRequirements'
  ], 'root');

  if (doc.schemaVersion !== 1) fail('unsupported schema');
  if (doc.status !== 'audited-candidate-not-certified') fail('status may not promote itself');
  if (JSON.stringify(doc.levels) !== JSON.stringify(LEVELS)) fail('allocation level inventory changed');
  if (JSON.stringify(doc.reclamationModes) !== JSON.stringify(RECLAMATION)) fail('reclamation inventory changed');
  if (!Array.isArray(doc.backends) || doc.backends.length !== BACKENDS.length) fail('backend inventory changed');
  if (JSON.stringify(doc.promotionRequirements) !== JSON.stringify(REQUIREMENTS)) fail('promotion requirements missing, reordered or weakened');

  for (let index = 0; index < BACKENDS.length; ++index) {
    const entry = doc.backends[index];
    shape(entry, [
      'backend', 'allocationLevel', 'reclamation', 'aotLevel', 'zeroGcClaim',
      'hostBoundary', 'generalGuestHeap', 'refs', 'verified'
    ], 'backend[' + index + ']');

    if (entry.backend !== BACKENDS[index]) fail('backend order/identity changed');
    if (!LEVELS.includes(entry.allocationLevel)) fail(entry.backend + ' invalid allocation level');
    if (!RECLAMATION.includes(entry.reclamation)) fail(entry.backend + ' invalid reclamation');
    if (!AOT.includes(entry.aotLevel)) fail(entry.backend + ' invalid AOT level');
    if (!ZERO.includes(entry.zeroGcClaim)) fail(entry.backend + ' invalid zero-GC claim');
    if (typeof entry.hostBoundary !== 'string' || entry.hostBoundary.length < 8) fail(entry.backend + ' host boundary missing');
    if (typeof entry.generalGuestHeap !== 'boolean' || typeof entry.verified !== 'boolean') fail(entry.backend + ' booleans invalid');
    if (!Array.isArray(entry.refs) || entry.refs.length === 0 ||
        entry.refs.some(ref => typeof ref !== 'string' || !/^[a-z]+#[1-9][0-9]*$/.test(ref))) {
      fail(entry.backend + ' evidence refs invalid');
    }

    const level = LEVELS.indexOf(entry.allocationLevel);
    if (entry.generalGuestHeap !== (entry.allocationLevel === 'compiled-general')) {
      fail(entry.backend + ' general guest heap must mean compiled-general');
    }
    if (entry.zeroGcClaim === 'compiled-scalar-only') {
      if (level < LEVELS.indexOf('compiled-scalar') || !deterministic(entry.reclamation)) {
        fail(entry.backend + ' scalar zero-GC claim lacks compiled deterministic storage');
      }
    }
    if (entry.zeroGcClaim === 'guest-general') {
      if (!entry.generalGuestHeap || !deterministic(entry.reclamation) || entry.aotLevel !== 'full-aot') {
        fail(entry.backend + ' general zero-GC claim requires compiled-general deterministic full AOT');
      }
    }
    if (entry.aotLevel === 'full-aot' && level < LEVELS.indexOf('compiled-scalar')) {
      fail(entry.backend + ' full AOT cannot be inferred from a host arena');
    }
    if (entry.verified && (
        entry.allocationLevel === 'compiled-general' ||
        entry.aotLevel === 'full-aot' ||
        entry.zeroGcClaim === 'guest-general')) {
      fail(entry.backend + ' candidate row may not self-certify general/full-AOT claims');
    }
  }

  const semanticReady = doc.backends.every(entry =>
    entry.verified && entry.generalGuestHeap && deterministic(entry.reclamation));
  const zeroGcAotReady = semanticReady && doc.backends.every(entry =>
    entry.aotLevel === 'full-aot' && entry.zeroGcClaim === 'guest-general');

  if (doc.certifiedSemanticActorHeapParity !== semanticReady) {
    fail('semantic parity flag does not match evidence');
  }
  if (doc.certifiedZeroGcFullAotParity !== zeroGcAotReady) {
    fail('zero-GC/full-AOT flag does not match evidence');
  }
  // This is only a candidate ledger. Self-attested rows cannot authorize a
  // release claim; that requires separately verified exact-head run artifacts.
  if (semanticReady || zeroGcAotReady) {
    fail('candidate may not self-certify; require independent executable artifact evidence');
  }

  return {
    semanticReady,
    zeroGcAotReady,
    backendLevels: Object.fromEntries(doc.backends.map(entry => [entry.backend, entry.allocationLevel]))
  };
}

export async function loadActorHeapCapabilities() {
  const path = resolve(root, 'actor-heap-capabilities.json');
  const doc = JSON.parse(await readFile(path, 'utf8'));
  validateActorHeapCapabilities(doc);
  return doc;
}
