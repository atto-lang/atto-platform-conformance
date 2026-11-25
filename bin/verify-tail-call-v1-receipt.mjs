#!/usr/bin/env node
/**
 * Structural audit of candidate CI receipts. Passing does not attest their
 * authenticity: GitHub App issuer, exact head/tree and job API must be
 * checked independently before promotion, merge, or parity claims.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const hex40 = /^[0-9a-f]{40}$/;
const hex64 = /^[0-9a-f]{64}$/;
const backendNames = ['java', 'llvm', 'net', 'wasm', 'forge'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const positive = n => Number.isSafeInteger(n) && n > 0;

export function verifyTailCallReceipt(receipt, manifest, expectedHead, fixtureHashes) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, 'tail-calls-v1');
  assert.deepEqual(manifest.backends, backendNames);
  assert.match(expectedHead, hex40);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.contractId, manifest.id);
  assert.ok(backendNames.includes(receipt.backend), 'unknown backend');
  assert.equal(receipt.headSha, expectedHead, 'head SHA not independently pinned');
  assert.match(receipt.compilerSha256, hex64);
  assert.equal(receipt.evidenceClass, 'compiler-backed-guest');
  assert.ok(positive(receipt.runId) && positive(receipt.runAttempt) &&
            positive(receipt.jobId), 'invalid run/job/attempt identity');
  assert.ok(positive(receipt.runnerId), 'runner was never assigned');
  assert.ok(Array.isArray(receipt.steps) && receipt.steps.length >= 2,
            'zero-step or missing-step job is NOT_EXECUTED');
  assert.ok(receipt.steps.every(s => s && typeof s.name === 'string' &&
            s.name.length > 0 && s.status === 'completed' &&
            s.conclusion === 'success'), 'incomplete or failed job steps');
  assert.ok(receipt.steps.some(s => /compile|build/i.test(s.name)) &&
            receipt.steps.some(s => /guest|run|execute/i.test(s.name)),
            'no compiler-backed guest execution steps');
  assert.ok(Array.isArray(receipt.cases), 'missing case receipts');
  assert.equal(receipt.cases.length, manifest.cases.length,
               'partial fixture coverage is not complete parity');
  const byId = new Map();
  for (const row of receipt.cases) {
    assert.ok(row && typeof row.id === 'string' && !byId.has(row.id),
              'duplicate or invalid receipt case');
    byId.set(row.id, row);
  }
  for (const entry of manifest.cases) {
    const row = byId.get(entry.id);
    assert.ok(row, 'missing receipt for ' + entry.id);
    assert.match(row.fixtureSha256, hex64);
    assert.equal(row.fixtureSha256, fixtureHashes[entry.id],
                 'fixture hash mismatch for ' + entry.id);
    assert.match(row.compilerSha256, hex64);
    assert.equal(row.compilerSha256, receipt.compilerSha256,
                 'mixed compiler executable identities');
    if (entry.compile === 'reject') {
      assert.equal(row.compile, 'rejected');
      assert.equal(row.guest, 'not-run');
      assert.equal(row.diagnosticClass, entry.diagnosticClass);
      assert.equal(row.stdout, undefined);
      assert.equal(row.executableSha256, undefined);
    } else if (entry.runtime === 'reject') {
      assert.equal(row.compile, 'accepted');
      assert.equal(row.guest, 'rejected');
      assert.equal(row.diagnosticClass, entry.diagnosticClass);
      assert.match(row.executableSha256, hex64);
      assert.equal(row.stdout, undefined);
    } else {
      assert.equal(row.compile, 'accepted');
      assert.equal(row.guest, 'passed');
      assert.match(row.executableSha256, hex64);
      assert.equal(row.stdout, entry.stdout);
      if (entry.tailDepth !== undefined) {
        assert.ok(positive(row.stackPeakBytes) &&
                  positive(row.stackBoundBytes) &&
                  row.stackPeakBytes <= row.stackBoundBytes,
                  'missing bounded native/guest stack proof');
        assert.ok(row.executedTailDepth >= entry.tailDepth &&
                  Number.isSafeInteger(row.executedTailDepth),
                  'deep tail fixture never actually exercised');
      }
    }
  }
  // Never mark a receipt trusted from self-reported JSON alone. Caller must
  // fetch issuer-bound GitHub job+step evidence and independently bind it.
  return Object.freeze({ status: 'STRUCTURE_ONLY_UNTRUSTED', backend: receipt.backend,
                         headSha: expectedHead, cases: manifest.cases.length });
}

export async function loadCanonicalFixtures(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'contracts/tail-calls-v1.json'), 'utf8'));
  const hashes = Object.create(null);
  for (const entry of manifest.cases) {
    assert.match(entry.path, /^fixtures\/tail-calls-v1\/[a-z0-9-]+\.(?:atto|ores)$/);
    const path = resolve(root, entry.path);
    assert.ok(path.startsWith(root + sep));
    assert.equal(await realpath(path), path, 'source-fixture symlink forbidden');
    hashes[entry.id] = hash(await readFile(path));
  }
  return { manifest, hashes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4,
      'usage: node verify-tail-call-v1-receipt.mjs receipt.json pinned-head-sha');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const receipt = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
    const { manifest, hashes } = await loadCanonicalFixtures(root);
    const result = verifyTailCallReceipt(receipt, manifest, process.argv[3], hashes);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error('TAIL_RECEIPT_REJECTED: ' + error.message);
    process.exitCode = 1;
  }
}
