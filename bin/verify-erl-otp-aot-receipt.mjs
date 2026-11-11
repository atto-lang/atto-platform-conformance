#!/usr/bin/env node
// Structural inspection only. Untrusted JSON is NOT GitHub/runner/build attestation.
// No self-reported receipt can authorize parity promotion (even when well formed).
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MANIFEST = JSON.parse(readFileSync(new URL('../contracts/erl-otp-strict-aot-v1.json', import.meta.url), 'utf8'));
const CONTRACT = 'attolang-erlang-otp-strict-aot-v1';
const FEATURES = new Map(MANIFEST.features.map(feature => [feature.id, feature]));
const VECTORS = new Map(MANIFEST.vectors.map(vector => [vector.id, vector]));
const TARGETS = new Set(MANIFEST.backends);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const MAX_BYTES = 1024 * 1024;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (record, key) => isRecord(record) && Object.hasOwn(record, key);
const isSha40 = value => typeof value === 'string' && HEX40.test(value);
const isSha256 = value => typeof value === 'string' && HEX64.test(value);

function validRunUrl(value, runId) {
  if (typeof value !== 'string' || !Number.isSafeInteger(runId) || runId < 1) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.port === '' &&
      url.username === '' && url.password === '' && url.search === '' && url.hash === '' &&
      /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(url.pathname) &&
      url.pathname.endsWith('/actions/runs/' + runId);
  } catch { return false; }
}

function validReviewUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.port === '' &&
      url.username === '' && url.password === '' && url.search === '' &&
      /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url.pathname) &&
      /^#pullrequestreview-[1-9][0-9]*$/.test(url.hash);
  } catch { return false; }
}

export function inspectReceipt(receipt) {
  const errors = [];
  const requireField = (test, error) => { if (!test) errors.push(error); };
  if (!isRecord(receipt)) {
    return { ok: false, structurallyValid: false, verified: false, classification: 'REJECTED', errors: ['receipt must be an object'] };
  }

  requireField(receipt.contract === CONTRACT, 'contract mismatch');
  requireField(TARGETS.has(receipt.backend), 'backend not in target set');
  const feature = FEATURES.get(receipt.feature);
  const vector = VECTORS.get(receipt.fixture?.id);
  requireField(feature !== undefined, 'unknown feature');
  requireField(feature?.backends.includes(receipt.backend) === true, 'feature/backend mismatch');
  requireField(vector !== undefined, 'unknown fixture');
  requireField(vector?.feature === receipt.feature, 'feature/fixture mismatch');
  requireField(vector?.backends.includes(receipt.backend) === true, 'fixture/backend mismatch');
  requireField(receipt.status === 'VERIFIED', 'reported status is not VERIFIED');
  requireField(receipt.evidenceClass === 'compiler-guest', 'not compiler-guest evidence');

  const c = receipt.compiler;
  requireField(isRecord(c), 'compiler identity missing');
  requireField(typeof c?.repository === 'string' && REPO.test(c.repository), 'compiler repository invalid');
  requireField(isSha40(c?.headSha), 'compiler head SHA missing or invalid');
  requireField(isSha40(c?.treeSha), 'compiler tree SHA missing or invalid');
  requireField(isSha256(c?.binarySha256), 'compiler binary SHA256 missing or invalid');
  requireField(isSha256(receipt.fixture?.sha256), 'fixture digest missing or invalid');

  const e = receipt.execution;
  requireField(isRecord(e), 'execution section missing');
  requireField(Number.isSafeInteger(e?.runId) && e.runId > 0, 'workflow run ID invalid');
  requireField(Number.isSafeInteger(e?.jobId) && e.jobId > 0, 'workflow job ID invalid');
  requireField(Number.isSafeInteger(e?.jobAttempt) && e.jobAttempt > 0, 'job attempt invalid');
  requireField(Number.isSafeInteger(e?.executedSteps) && e.executedSteps > 0, 'zero or unknown executed steps');
  requireField(e?.mode === 'strict-aot', 'strict AOT mode not reported');
  requireField(validRunUrl(e?.runUrl, e?.runId), 'run URL malformed or ID mismatch');
  requireField(validReviewUrl(e?.independentReviewUrl), 'specific review URL missing or malformed');
  for (const field of ['jitUsed', 'interpreterFallbackUsed', 'runtimeGuestCompilerUsed', 'reflectionDispatchUsed']) {
    requireField(has(e, field) && e[field] === false, field + ' must be explicitly false');
  }
  requireField(e?.aotFallbackMutationRejected === true, 'no negative mutation proof');
  requireField(e?.negativeDiagnosticsPassed === true, 'negative diagnostic checks missing');

  // Rejected source cannot both yield a guest executable and prove no output artifact.
  const negative = vector?.kind === 'compile' && vector.expected?.compilation === 'reject' ||
    vector?.kind === 'aot_policy' && (vector.expected?.compilation === 'reject' || vector.expected?.admission === 'reject');
  if (negative) {
    requireField(e?.compilationOutcome === 'rejected', 'negative fixture must be rejected');
    requireField(e?.compiledGuest === false, 'negative fixture must not compile guest');
    requireField(e?.executedGuest === false, 'negative fixture must not execute guest');
    requireField(e?.outputArtifactCreated === false, 'rejected input produced artifact');
    requireField(!has(receipt, 'artifact'), 'rejected fixture must not carry an artifact');
    if (vector.kind === 'compile') {
      requireField(e?.observedDiagnosticClass === vector.expected.diagnosticClass, 'negative diagnostic class mismatch');
    }
  } else if (vector !== undefined) {
    requireField(e?.compilationOutcome === 'accepted', 'positive fixture not accepted');
    requireField(e?.compiledGuest === true, 'compiled guest not reported');
    requireField(e?.executedGuest === true, 'guest execution not reported');
    requireField(e?.outputArtifactCreated === true, 'AOT executable not reported');
    requireField(isSha256(receipt.artifact?.sha256), 'AOT artifact digest missing or invalid');
  }

  const structurallyValid = errors.length === 0;
  return {
    // Deliberate fail-closed trust boundary. External independent attestor must verify
    // GitHub run/jobs/review, source-tree identity, fixture bytes, binary and artifact.
    ok: false,
    structurallyValid,
    verified: false,
    classification: structurallyValid ? 'STRUCTURAL_ONLY_NOT_ATTESTED' : 'REJECTED',
    errors,
  };
}

// Existing caller compatibility. The return value MUST NEVER be used as a promotion receipt.
export const validateReceipt = inspectReceipt;

export function readUntrustedReceipt(pathname) {
  if (constants.O_NOFOLLOW === undefined) {
    throw new Error('no safe no-follow open support; refusing path input');
  }
  const path = resolve(pathname);
  const before = lstatSync(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES) {
    throw new Error('receipt must be single-linked regular file <=1MiB');
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > MAX_BYTES) {
      throw new Error('receipt replaced, linked or oversized during open');
    }
    const chunks = [];
    let length = 0;
    const buffer = Buffer.alloc(16 * 1024);
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      length += count;
      if (length > MAX_BYTES) throw new Error('receipt exceeds 1MiB bound');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw new Error('receipt changed during read');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
    return JSON.parse(text);
  } finally {
    closeSync(fd);
  }
}

function main() {
  if (process.argv.length !== 3) {
    console.error('usage: node bin/verify-erl-otp-aot-receipt.mjs /path/to/receipt.json');
    process.exitCode = 2;
    return;
  }
  try {
    const receipt = readUntrustedReceipt(process.argv[2]);
    const result = inspectReceipt(receipt);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('REJECTED_INVALID_RECEIPT:', error.message);
  }
  // No network/build/runner verification is possible from this self-reported JSON.
  // A structurally valid receipt still does NOT authorize CI or promotion.
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
