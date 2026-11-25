// Host-only adversarial tests. These do not execute an Oreslang compiler or guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, link, symlink, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, basename} from 'node:path';
import {
  SOURCE_CASES, validateCaseInventory, validateInvocation,
  compilerArtifactPaths, classifyCompilerResult, promoteCaseOutcome,
  isolatedCompilerEnvironment, runSourceAdmission
} from '../src/actor-ownership-source-gate-v1.mjs';

const declaredSha = 'd'.repeat(40);
const llvmNegative = SOURCE_CASES.find(c => c.id === 'AO03_AFTER_STOP');
const positive = SOURCE_CASES.find(c => c.id === 'AO01_SOURCE_ORDER');
const javaCandidate = SOURCE_CASES.find(c => c.id === 'OW01_MOVE_AFTER_TAKE');

async function withFakeCompiler(program, run) {
  const dir = await mkdtemp(join(tmpdir(), 'ores-adversarial-'));
  const entry = join(dir, 'synthetic-compiler.mjs');
  try {
    await writeFile(entry, program, {mode: 0o600});
    return await run({dir, entry, argv: [process.execPath, entry, '{file}']});
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

test('inventory rejects ambiguous source cases, duplicate backend selectors and unpinned fixtures', () => {
  for (const c of [
    {...positive, id: 'AO01_INVALID', backends: ['llvm', 'llvm']},
    {...positive, id: 'AO01_INVALID', expect: 'reject'},
    {...positive, id: 'AO01_INVALID', candidate: true},
    {...positive, id: 'AO01_INVALID', file: '../unsafe.ores'},
    {...positive, id: 'AO01_INVALID', originBlob: '00'},
    {...positive, id: 'AO01_INVALID', originBlob: undefined},
    {...positive, id: 'AO01_INVALID', backends: ['java', 'wasm']},
    {...positive, id: 'AO01_INVALID', diagnostic: 'unexpected'}
  ]) assert.throws(() => validateCaseInventory([c]), /invalid/);
  assert.throws(() => validateCaseInventory([]), /invalid/);
  assert.throws(() => validateCaseInventory(Array.from({length: 81}, (_, i) => ({...positive, id: 'CASE_' + i, file: 'case-' + i + '.ores'}))), /invalid/);
});

test('source SHA and standalone snapshot placeholder are mandatory', () => {
  for (const argv of [
    [], ['/abs/compiler', '--out={file}', '{file}'],
    ['/abs/compiler', '{file}', '{file}'],
    ['/abs/compiler', '{file}\0evil'],
    ['/abs/compiler', 7, '{file}'],
    ['/abs/compiler', '{file}', null]
  ]) assert.throws(() => validateInvocation(argv, declaredSha));
  for (const sha of [undefined, '', 'D'.repeat(40), 'f'.repeat(39), 'g'.repeat(40)]) {
    assert.throws(() => validateInvocation(['/abs/compiler', '{file}'], sha));
  }
});

test('direct untracked shell, environment and interpreter wrappers are denied', () => {
  for (const argv of [
    ['/bin/sh', '-c', 'cat "$1"', '{file}'],
    ['/usr/bin/bash', '-c', 'echo fake', '{file}'],
    ['/usr/bin/env', 'python3', '/tmp/fake.py', '{file}'],
    ['/usr/bin/python3.12', '/tmp/fake.py', '{file}'],
    ['/usr/bin/perl', '/tmp/fake.pl', '{file}'],
    ['/usr/bin/ruby', '/tmp/fake.rb', '{file}'],
    ['/usr/bin/npx', '/tmp/compiler', '{file}']
  ]) assert.throws(() => compilerArtifactPaths(argv), /indirect launcher/);
});

test('an alias to a shell is checked by resolved executable identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ores-shell-alias-'));
  try {
    const alias = join(dir, 'looks-like-compiler');
    await symlink('/bin/sh', alias);
    await assert.rejects(
      runSourceAdmission({backend: 'llvm', argv: [alias, '-c', 'exit 0', '{file}'], sourceSha: declaredSha}),
      /indirect launcher/
    );
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('an alias to Node still requires a directly pinned script', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ores-node-alias-'));
  try {
    const alias = join(dir, 'looks-like-compiler');
    await symlink(process.execPath, alias);
    await assert.rejects(
      runSourceAdmission({backend: 'llvm', argv: [alias, '{file}'], sourceSha: declaredSha}),
      /Node compiler must name a directly pinned absolute script/
    );
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('artifact inventory refuses ambiguous paths and missing filesystem identity', () => {
  const compiler = ['/opt/native/ores-compiler', '{file}'];
  for (const artifacts of [
    ['/tmp/a', '/tmp/a'], ['relative/dep'], ['/tmp/abc\0x'],
    ['/tmp/{file}'], Array(17).fill('/tmp/dep')
  ]) assert.throws(() => compilerArtifactPaths(compiler, artifacts));
  assert.deepEqual(compilerArtifactPaths(compiler, ['/abs/dep.so']), ['/abs/dep.so']);
});

test('hard-linked supporting artifacts are rejected before spawning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ores-hardlink-'));
  try {
    const original = join(dir, 'payload.dat');
    const alias = join(dir, 'payload-alias.dat');
    await writeFile(original, 'immutable-looking payload');
    await link(original, alias);
    let called = false;
    await assert.rejects(runSourceAdmission({
      backend: 'llvm', argv: ['/usr/bin/true', '{file}'], artifacts: [alias],
      sourceSha: declaredSha, spawn: () => { called = true; throw Error('should not execute'); }
    }), /unsafe\/nonregular\/oversized file/);
    assert.equal(called, false);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('semantic rejections require the first primary stderr diagnostic, not a later matching note', () => {
  const right = 'error: actor message sent after stop';
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: '', stderr: 'error: parse failure\n' + right}), 'DIAGNOSTIC_MISMATCH');
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: right, stderr: ''}), 'UNEXPECTED_COMPILER_RESULT');
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: '', stderr: 'note: ' + right}), 'UNEXPECTED_COMPILER_RESULT');
  assert.equal(classifyCompilerResult(llvmNegative, {status: 0, stdout: '', stderr: right}), 'UNEXPECTED_COMPILER_RESULT');
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: '', stderr: right + '\ninternal compiler error'}), 'COMPILER_CRASH');
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: '', stderr: right, signal: 'SIGKILL'}), 'EXECUTION_FAILED');
  assert.equal(classifyCompilerResult(llvmNegative, {status: null, stdout: '', stderr: right}), 'EXECUTION_FAILED');
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: '', stderr: right + 'z'.repeat(256 * 1024)}), 'OUTPUT_TOO_LARGE');
});

test('synthetic stderr success never becomes source provenance or guest certification', () => {
  assert.equal(classifyCompilerResult(llvmNegative, {status: 1, stdout: '', stderr: 'error: actor message sent after stop'}), 'SOURCE_REJECTED_AS_EXPECTED');
  assert.equal(promoteCaseOutcome(javaCandidate, 'SOURCE_REJECTED_AS_EXPECTED'), 'CANDIDATE_UNRATIFIED');
  assert.equal(promoteCaseOutcome(javaCandidate, 'EXECUTION_FAILED'), 'EXECUTION_FAILED');
  assert.equal(classifyCompilerResult(positive, {status: 0, stdout: 'guest passed', stderr: ''}), 'SOURCE_ACCEPTED');
});

test('compiler sandbox environment has no inherited credentials or preload hooks', () => {
  const env = isolatedCompilerEnvironment('/tmp/ours');
  assert.ok(Object.isFrozen(env));
  assert.equal(env.HOME, env.TMPDIR);
  assert.equal(env.TMPDIR, env.TEMP);
  for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'AWS_ACCESS_KEY_ID', 'NODE_OPTIONS', 'JAVA_TOOL_OPTIONS', 'LD_PRELOAD', 'CLASSPATH', 'PATH']) {
    assert.equal(Object.hasOwn(env, key), false, key);
  }
});

test('real synthetic Node compiler stdout-spoofing cannot pass LLVM admission', async () => {
  const program = [
    "const file = process.argv.at(-1);",
    "if (file.endsWith('actor-send-after-stop.ores')) {",
    "  console.log('error: actor message sent after stop');",
    '  process.exit(1);',
    '}',
    'process.exit(0);'
  ].join('\n');
  await withFakeCompiler(program, async ({argv}) => {
    const result = await runSourceAdmission({backend: 'llvm', argv, sourceSha: declaredSha});
    assert.equal(result.ok, false);
    assert.deepEqual(result.results.map(r => r.status),
      ['SOURCE_ACCEPTED', 'UNEXPECTED_COMPILER_RESULT', 'SOURCE_ACCEPTED']);
    assert.equal(result.certificationEligible, false);
    assert.equal(result.provenanceVerified, false);
    assert.equal(result.guestExecuted, false);
    assert.equal(result.runtimeTraceVerified, false);
    assert.equal(result.physicalIsolationVerified, false);
  });
});

test('real subprocess termination is an execution failure, never an expected negative', async () => {
  const program = [
    "if (process.argv.at(-1).endsWith('actor-send-after-stop.ores')) process.kill(process.pid, 'SIGTERM');",
    'else process.exit(0);'
  ].join('\n');
  await withFakeCompiler(program, async ({argv}) => {
    const result = await runSourceAdmission({backend: 'llvm', argv, sourceSha: declaredSha});
    assert.equal(result.ok, false);
    assert.equal(result.results.find(r => r.id === 'AO03_AFTER_STOP').status, 'EXECUTION_FAILED');
    assert.equal(result.provenanceVerified, false);
  });
});

test('real subprocess modifying its pinned script invalidates the first observation and stops', async () => {
  const program = [
    "import {appendFileSync} from 'node:fs';",
    "appendFileSync(process.argv[1], '\\n// self-modified');",
    'process.exit(0);'
  ].join('\n');
  await withFakeCompiler(program, async ({argv}) => {
    const result = await runSourceAdmission({backend: 'llvm', argv, sourceSha: declaredSha});
    assert.equal(result.ok, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].status, 'COMPILER_ARTIFACT_CHANGED');
    assert.equal(result.provenanceVerified, false);
  });
});

test('scratch files are removed after a source-only synthetic result', async () => {
  const dirs = [];
  const result = await runSourceAdmission({backend: 'llvm', argv: ['/usr/bin/true', '{file}'], sourceSha: declaredSha,
    spawn: (_, args, options) => {
      dirs.push(options.cwd);
      assert.ok(args.at(-1).startsWith(options.cwd));
      const fail = basename(args.at(-1)) === 'actor-send-after-stop.ores';
      return {status: fail ? 1 : 0, stdout: '', stderr: fail ? 'error: actor message sent after stop' : ''};
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.certificationEligible, false);
  assert.equal(result.provenanceVerified, false);
  assert.equal(dirs.length, 3);
  assert.equal(new Set(dirs).size, 3);
  for (const dir of dirs) await assert.rejects(stat(dir), {code: 'ENOENT'});
});
