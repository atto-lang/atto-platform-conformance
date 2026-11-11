#!/usr/bin/env node
// Structural admission only. A self-reported JSON receipt is NOT an independent CI attestation.
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_CONTRACT = 'attolang-erlang-otp-strict-aot-v1';
const TARGETS = new Set(['java', 'llvm', 'net', 'wasm', 'forge']);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(actions\/runs\/\d+|pull\/\d+(?:#.+)?)$/;

export function validateReceipt(r) {
  const errors = [];
  const requireValue = (condition, message) => { if (!condition) errors.push(message); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return { ok: false, classification: 'NOT_ATTESTED', errors: ['receipt must be an object'] };
  }
  requireValue(r.contract === EXPECTED_CONTRACT, 'contract mismatch');
  requireValue(TARGETS.has(r.backend), 'backend must be a strict-AOT target');
  requireValue(typeof r.feature === 'string' && /^[a-z][a-z0-9_]*$/.test(r.feature), 'feature ID invalid');
  requireValue(r.status === 'VERIFIED', 'not verified');
  requireValue(r.evidenceClass === 'compiler-guest', 'host-only/source-only evidence rejected');
  const c = r.compiler || {};
  requireValue(typeof c.repository === 'string' && /^[-\w.]+\/[-\w.]+$/.test(c.repository), 'compiler repository missing');
  requireValue(HEX40.test(c.headSha ?? ''), 'exact head SHA missing');
  requireValue(HEX40.test(c.treeSha ?? ''), 'exact tree SHA missing');
  requireValue(HEX64.test(c.binarySha256 ?? ''), 'compiler binary SHA256 missing');
  const f = r.fixture || {};
  requireValue(typeof f.id === 'string' && f.id.length > 0, 'fixture ID missing');
  requireValue(HEX64.test(f.sha256 ?? ''), 'fixture hash missing');
  requireValue(HEX64.test(r.artifact?.sha256 ?? ''), 'AOT artifact hash missing');
  const e = r.execution || {};
  requireValue(Number.isSafeInteger(e.runId) && e.runId > 0, 'workflow run ID missing');
  requireValue(Number.isSafeInteger(e.jobId) && e.jobId > 0, 'job ID missing');
  requireValue(Number.isSafeInteger(e.jobAttempt) && e.jobAttempt > 0, 'job attempt binding missing');
  requireValue(Number.isSafeInteger(e.executedSteps) && e.executedSteps > 0, 'no executed steps');
  requireValue(e.compiledGuest === true, 'guest compilation unproven');
  requireValue(e.executedGuest === true, 'guest execution unproven');
  requireValue(e.mode === 'strict-aot', 'strict AOT mode unproven');
  for (const key of ['jitUsed', 'interpreterFallbackUsed', 'runtimeGuestCompilerUsed', 'reflectionDispatchUsed']) {
    requireValue(e[key] === false, key + ' not explicitly false');
  }
  requireValue(e.aotFallbackMutationRejected === true, 'fallback mutation test not passed');
  requireValue(e.negativeDiagnosticsPassed === true, 'negative guest tests not passed');
  requireValue(typeof e.runUrl === 'string' && URL.test(e.runUrl) && e.runUrl.endsWith('/actions/runs/' + e.runId), 'run URL/ID mismatch');
  requireValue(typeof e.independentReviewUrl === 'string' && URL.test(e.independentReviewUrl) && e.independentReviewUrl.includes('/pull/'), 'independent review URL absent');
  return { ok: errors.length === 0, classification: 'STRUCTURAL_ONLY_NOT_INDEPENDENTLY_ATTESTED', errors };
}

function main() {
  if (process.argv.length !== 3) {
    console.error('usage: node bin/verify-erl-otp-aot-receipt.mjs /path/to/receipt.json');
    process.exitCode = 2;
    return;
  }
  let receipt;
  try {
    const path = resolve(process.argv[2]);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('receipt must be a regular <=1MiB file');
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error('REJECTED_INVALID_RECEIPT:', error.message);
    process.exitCode = 1;
    return;
  }
  const result = validateReceipt(receipt);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  // A green schema check is deliberately not a proof of provenance or parity.
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
