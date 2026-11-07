// Source-only artifact bytes validation. NEVER runner or guest attestation.
import {createHash, timingSafeEqual} from 'node:crypto';

const die = code => { throw Error(code); };
const own = (o, key) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) die('E_OBJECT');
  const d = Object.getOwnPropertyDescriptor(o, key);
  if (!d || !Object.hasOwn(d, 'value')) die('E_FIELD:' + key);
  return d.value;
};
const bounded = (input, max, key) => {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 ||
      input.byteLength > max) die('E_BYTES:' + key);
  return input;
};
const hex = (value, length) => typeof value === 'string' &&
  new RegExp('^[0-9a-f]{' + length + '}$').test(value);
const digest = data => createHash('sha256').update(data).digest('hex');
const equalHash = (actual, claimed) => hex(claimed, 64) &&
  timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(claimed, 'hex'));
const integerEquals = (actual, expected) => Number.isSafeInteger(expected) &&
  expected > 0 && (actual === expected || (typeof actual === 'string' &&
  /^[1-9][0-9]*$/.test(actual) && Number(actual) === expected));

function verifyTap(bytes, expected, label) {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const lines = text.split(/\r?\n/);
  if (lines.some(line => /^not ok(?:\s|$)/.test(line))) die('E_TAP_FAILURE:' + label);
  const plans = lines.filter(line => /^1\.\.[0-9]+$/.test(line));
  if (plans.length !== 1 || plans[0] !== '1..' + expected)
    die('E_TAP_PLAN:' + label);
  const cases = lines.filter(line => /^ok(?:\s|$)/.test(line));
  if (cases.length !== expected || !cases.every((line, index) =>
      line.startsWith('ok ' + (index + 1) + ' - ')))
    die('E_TAP_CASES:' + label);
  for (const [key, count] of Object.entries({tests: expected, pass: expected,
    fail: 0, skipped: 0, cancelled: 0, todo: 0})) {
    const matches = lines.filter(line => line.startsWith('# ' + key + ' '));
    if (matches.length !== 1 || matches[0] !== '# ' + key + ' ' + count)
      die('E_TAP_SUMMARY:' + label + ':' + key);
  }
}

export function verifySourceOnlyArtifactBytes({receiptBytes, baseTapBytes,
  correlationTapBytes, artifactTapBytes, expected}) {
  const receiptRaw = bounded(receiptBytes, 65536, 'receipt');
  const base = bounded(baseTapBytes, 1048576, 'base-tap');
  const correlation = bounded(correlationTapBytes, 1048576, 'correlation-tap');
  const artifact = bounded(artifactTapBytes, 1048576, 'artifact-test-tap');
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(receiptRaw));
  } catch { die('E_RECEIPT_JSON'); }
  const known = new Set(['classification', 'hosted_api_independent_job_step_correlation',
    'repo', 'head', 'tree', 'run_id', 'run_attempt', 'job', 'tap_sha256',
    'test_count', 'correlation_test_count', 'correlation_tap_sha256',
    'artifact_bytes_test_count', 'artifact_bytes_tap_sha256', 'not_proven']);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      Object.keys(receipt).some(key => !known.has(key))) die('E_RECEIPT_FIELDS');
  if (own(receipt, 'classification') !== 'SOURCE_ONLY_NODE_TEST_EXECUTED_NOT_GUEST_PARITY' ||
      own(receipt, 'hosted_api_independent_job_step_correlation') !== 'NOT_PERFORMED')
    die('E_RECEIPT_CLASS');
  if (own(receipt, 'repo') !== own(expected, 'repo') ||
      own(receipt, 'head') !== own(expected, 'headSha') ||
      own(receipt, 'tree') !== own(expected, 'treeSha') ||
      !hex(own(receipt, 'head'), 40) || !hex(own(receipt, 'tree'), 40) ||
      !integerEquals(own(receipt, 'run_id'), own(expected, 'runId')) ||
      !integerEquals(own(receipt, 'run_attempt'), own(expected, 'attempt')) ||
      own(receipt, 'job') !== own(expected, 'jobName')) die('E_RECEIPT_IDENTITY');
  const baseCount = own(expected, 'baseCount');
  const correlationCount = own(expected, 'correlationCount');
  const artifactCount = own(expected, 'artifactCount');
  if (!Number.isSafeInteger(baseCount) || baseCount < 1 || baseCount > 10000 ||
      !Number.isSafeInteger(correlationCount) || correlationCount < 1 ||
      correlationCount > 10000 || !Number.isSafeInteger(artifactCount) ||
      artifactCount < 1 || artifactCount > 10000 ||
      own(receipt, 'artifact_bytes_test_count') !== artifactCount ||
      own(receipt, 'test_count') !== baseCount ||
      own(receipt, 'correlation_test_count') !== correlationCount)
    die('E_TEST_INVENTORY');
  const excluded = own(receipt, 'not_proven');
  const mandatory = ['native compilation', 'guest execution', 'backend parity', 'merge approval'];
  if (!Array.isArray(excluded) || excluded.length !== mandatory.length ||
      !mandatory.every((name, i) => excluded[i] === name)) die('E_NON_PROMOTION');
  verifyTap(base, baseCount, 'base');
  verifyTap(correlation, correlationCount, 'correlation');
  verifyTap(artifact, artifactCount, 'artifact');
  const baseHash = digest(base), correlationHash = digest(correlation),
        artifactHash = digest(artifact);
  if (!equalHash(baseHash, own(receipt, 'tap_sha256')) ||
      !equalHash(correlationHash, own(receipt, 'correlation_tap_sha256')) ||
      !equalHash(artifactHash, own(receipt, 'artifact_bytes_tap_sha256')))
    die('E_ARTIFACT_DIGEST');
  return Object.freeze({
    classification: 'SOURCE_ONLY_ARTIFACT_BYTES_CONSISTENT_NOT_ATTESTED',
    evidence: 'DOWNLOADED_BYTES_REQUIRE_INDEPENDENT_GITHUB_ORIGIN_PROOF',
    sourceHead: own(receipt, 'head'), sourceTree: own(receipt, 'tree'),
    baseTestCount: baseCount, correlationTestCount: correlationCount,
    artifactTestCount: artifactCount,
    baseTapSha256: baseHash, correlationTapSha256: correlationHash,
    artifactTapSha256: artifactHash,
    hostedRunnerVerified: false, guestExecutionProven: false, mergeAuthorized: false
  });
}
