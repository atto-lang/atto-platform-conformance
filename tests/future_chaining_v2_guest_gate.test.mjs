import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

// Tests prove *failure isolation only*. They do NOT execute an Oreslang guest.
const native = realpathSync(process.execPath);
const script = fileURLToPath(new URL('../tools/run-future-chaining-v2-guests.mjs', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const invoke = (...args) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024
});
function provenance(file, hash, directory) {
  const p = path.join(directory, 'build.json');
  writeFileSync(p, JSON.stringify({
    schemaVersion: 1, backend: 'java-graalvm',
    compilerRepository: 'ores-truffle-oreslang/oreslang-source.java',
    compilerSourceCommit: 'a'.repeat(40),
    compilerSourceTree: 'b'.repeat(40),
    compilerSha256: hash,
    buildCommand: 'untrusted synthetic test only',
    builderIdentity: 'source-free synthetic test',
    toolchain: 'test double; not GraalVM',
    buildRunUrl: 'https://github.com/example/testing/actions/runs/1'
  }));
  return p;
}

test('compiler-backed gate is explicitly opt-in and fails closed when no compiler supplied', () => {
  const r = invoke();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FAIL_CLOSED/);
  assert.doesNotMatch(r.stdout, /COMPILER_EXECUTION_OBSERVED/);
});

test('a fake script cannot impersonate a native compiler even if its digest is pinned', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-gate-test-'));
  try {
    const fake = path.join(dir, 'pretend-compiler');
    const bytes = Buffer.from('#!/bin/sh\nexit 0\n');
    writeFileSync(fake, bytes, { mode: 0o700 });
    const p = provenance(fake, digest(bytes), dir);
    const r = invoke('--compiler', fake, '--provenance', p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /native executable/);
    assert.doesNotMatch(r.stdout, /COMPILER_EXECUTION_OBSERVED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a compiler artifact digest mismatch fails before any guest invocation', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-gate-test-'));
  try {
    const p = provenance(native, '0'.repeat(64), dir);
    const r = invoke('--compiler', native, '--provenance', p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /SHA-256/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the compiler path may not be an indirection symlink', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-gate-test-'));
  try {
    const link = path.join(dir, 'linked-binary');
    symlinkSync(native, link);
    const p = provenance(link, digest(readFileSync(native)), dir);
    const r = invoke('--compiler', link, '--provenance', p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ELOOP|invalid regular file|FAIL_CLOSED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('a Java .class magic header cannot masquerade as a native compiler', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-gate-test-'));
  try {
    const file = path.join(dir, 'Fake.class');
    // Java class files and Mach-O fat binaries share CAFEBABE; the gate must
    // refuse the ambiguous magic rather than count it as native execution.
    const bytes = Buffer.from('cafebabe0000004100000000', 'hex');
    writeFileSync(file, bytes);
    const p = provenance(file, digest(bytes), dir);
    const r = invoke('--compiler', file, '--provenance', p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /native executable/);
    assert.doesNotMatch(r.stdout, /COMPILER_EXECUTION_OBSERVED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native executable must provide the exact AOT OresMain build-info handshake', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-gate-test-'));
  try {
    const p = provenance(native, digest(readFileSync(native)), dir);
    const r = invoke('--compiler', native, '--provenance', p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /compiler --build-info did not exit successfully/);
    assert.doesNotMatch(r.stdout, /COMPILER_EXECUTION_OBSERVED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unrelated real native executable cannot be promoted to guest success', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ores-future-gate-test-'));
  try {
    const p = provenance(native, digest(readFileSync(native)), dir);
    const r = invoke('--compiler', native, '--provenance', p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /compiler --build-info did not exit successfully/);
    assert.match(r.stderr, /FAIL_CLOSED/);
    assert.doesNotMatch(r.stdout, /"status": "COMPILER_EXECUTION_OBSERVED_PROVENANCE_UNATTESTED"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
