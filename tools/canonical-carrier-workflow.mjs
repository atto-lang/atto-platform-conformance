// Strict source-free Actions canary bytes. No checkout, external action, secrets or source input.
// This is runner-capacity proof only, never private-source transfer authorization.
import { createHash } from 'node:crypto';

export const CANARY_PATH = '.github/workflows/source-free-canary.yml';
export const CANARY_JOB = 'source-free-check';
export const CANARY_STEP = 'ADMISSION_PROOF';
export const CANARY_SOURCE = [
  'name: Atto source-free carrier capacity',
  'on:',
  '  push:',
  '    branches:',
  "      - 'ci/atto-capacity-*'",
  'permissions:',
  '  contents: read',
  'jobs:',
  '  source-free-check:',
  '    runs-on: ubuntu-24.04',
  '    timeout-minutes: 3',
  '    steps:',
  '      - name: ADMISSION_PROOF',
  '        shell: bash',
  '        run: |',
  '          set -euo pipefail',
  "          printf '%s\\n' 'ATTO_SOURCE_FREE_ADMISSION_PROOF'",
  '',
].join('\n');

export function gitBlobSha(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

export const CANARY_BLOB_SHA = gitBlobSha(CANARY_SOURCE);

export class CanaryPolicyError extends Error {
  constructor(message) { super(message); this.name = 'CanaryPolicyError'; }
}
function check(condition, message) { if (!condition) throw new CanaryPolicyError(message); }

export function verifyCanonicalCarrierWorkflow(workflow, approvedBlobSha) {
  check(workflow && typeof workflow === 'object', 'missing workflow API record');
  check(workflow.type === 'file', 'workflow API record is not a file');
  check(workflow.path === CANARY_PATH, 'unexpected workflow path');
  check(workflow.encoding === 'base64' && typeof workflow.content === 'string',
    'workflow file contents unavailable');
  check(typeof approvedBlobSha === 'string' && /^[0-9a-f]{40}$/.test(approvedBlobSha),
    'invalid approved workflow Git blob');
  const encoded = workflow.content.replace(/\s/g, '');
  check(encoded.length > 0 && encoded.length <= 16384 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
    'invalid workflow content base64');
  const bytes = Buffer.from(encoded, 'base64');
  check(bytes.toString('base64') === encoded, 'noncanonical workflow base64');
  check(bytes.equals(Buffer.from(CANARY_SOURCE, 'utf8')),
    'workflow content differs from the audited source-free canary');
  const computed = gitBlobSha(bytes);
  check(computed === CANARY_BLOB_SHA, 'canonical workflow template digest changed');
  check(workflow.sha === computed && approvedBlobSha === computed,
    'workflow Git blob does not match independent approval');
  return Object.freeze({path: CANARY_PATH, blob_sha: computed, source_free: true,
    note: 'This only verifies canary bytes, not permission to copy private code.'});
}
