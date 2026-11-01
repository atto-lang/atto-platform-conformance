// Host-only admission integrity regressions. No Oreslang compiler/guest is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, chmod, symlink, link, rm, stat} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, basename} from 'node:path';
import {runSourceAdmission, classifyCompilerResult, SOURCE_CASES} from '../src/actor-ownership-source-gate-v1.mjs';

const sourceSha = 'e'.repeat(40);
const negative = SOURCE_CASES.find(x => x.id === 'AO03_AFTER_STOP');
const successful = (args) => {
  const reject = basename(args.at(-1)) === 'actor-send-after-stop.ores';
  return {status: reject ? 1 : 0, stdout: '', stderr: reject ? 'error: actor message sent after stop' : ''};
};
async function scratchRun(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ores-source-integrity-'));
  try { return await fn(dir); } finally { await rm(dir, {recursive:true, force:true}); }
}
async function rejectsPreSpawn(argv, pattern) {
  let calls = 0;
  await assert.rejects(runSourceAdmission({
    backend: 'llvm', argv, sourceSha,
    spawn: () => { calls++; return {status:0, stdout:'', stderr:''}; }
  }), pattern);
  assert.equal(calls, 0, 'invalid compiler launch must never spawn');
}

test('executable shebang wrapper is denied before any compiler invocation', async () => {
  await scratchRun(async dir => {
    const wrapper = join(dir, 'native-looking-compiler');
    await writeFile(wrapper, '#!/bin/sh\nexit 0\n', {mode:0o700});
    await rejectsPreSpawn([wrapper, '{file}'], /shebang compiler launcher/);
  });
});

test('symlink alias cannot conceal executable shebang wrapper', async () => {
  await scratchRun(async dir => {
    const wrapper = join(dir, 'shell-wrapper');
    const alias = join(dir, 'compiler-bin');
    await writeFile(wrapper, '#!/usr/bin/env node\nprocess.exit(0)\n', {mode:0o700});
    await symlink(wrapper, alias);
    await rejectsPreSpawn([alias, '{file}'], /shebang compiler launcher/);
  });
});

test('native launcher with non-shebang bytes still permits the recorded source-only mock', async () => {
  await scratchRun(async dir => {
    const nativeLike = join(dir, 'synthetic-opaque-binary');
    await writeFile(nativeLike, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), {mode:0o700});
    const receipt = await runSourceAdmission({
      backend:'llvm', argv:[nativeLike, '{file}'], sourceSha, spawn:(_,args)=>successful(args)
    });
    assert.equal(receipt.ok, true);
    assert.equal(receipt.certificationEligible, false);
    assert.equal(receipt.provenanceVerified, false);
    assert.equal(receipt.guestExecuted, false);
    assert.equal(receipt.results.length, 3);
  });
});

test('mutation of the primary compiler executable revokes a positive result', async () => {
  await scratchRun(async dir => {
    const executable = join(dir, 'synthetic-compiler');
    await writeFile(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x31]), {mode:0o700});
    let calls = 0;
    const receipt = await runSourceAdmission({
      backend:'llvm', argv:[executable, '{file}'], sourceSha,
      spawn:(_,args) => {
        calls++;
        writeFileSync(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x32]));
        return successful(args);
      }
    });
    assert.equal(calls, 1);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.results.length, 1);
    assert.equal(receipt.results[0].status, 'EXECUTABLE_CHANGED');
    assert.equal(receipt.verificationScope, 'UNATTESTED_COMPILER_SOURCE_ADMISSION_ONLY');
    assert.equal(receipt.provenanceVerified, false);
  });
});

test('hard-linked main executable is rejected without execution', async () => {
  await scratchRun(async dir => {
    const original = join(dir, 'original');
    const second = join(dir, 'compiler-alias');
    await writeFile(original, Buffer.from([0x7f,0x45,0x4c,0x46]), {mode:0o700});
    await link(original, second);
    await rejectsPreSpawn([second, '{file}'], /unsafe\/nonregular\/oversized file/);
  });
});

test('directory and missing executable paths fail before spawn', async () => {
  await scratchRun(async dir => {
    await rejectsPreSpawn([dir, '{file}'], /unsafe\/nonregular\/oversized file/);
    await rejectsPreSpawn([join(dir, 'absent'), '{file}'], /ENOENT/);
  });
});

test('real compiler artifact hash is stable and recorded when mock does not mutate it', async () => {
  await scratchRun(async dir => {
    const executable = join(dir, 'mock-executable');
    const artifact = join(dir, 'pinned-artifact.bin');
    await writeFile(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), {mode:0o700});
    await writeFile(artifact, 'artifact bytes');
    const receipt = await runSourceAdmission({
      backend:'llvm', argv:[executable,'{file}'], artifacts:[artifact], sourceSha,
      spawn:(_,args,options) => {
        assert.equal(options.timeout, 15000);
        assert.equal(options.shell, false);
        assert.equal(options.encoding, 'utf8');
        assert.equal(options.maxBuffer, 128*1024);
        assert.equal(options.env.GITHUB_TOKEN, undefined);
        assert.equal(options.env.NODE_OPTIONS, undefined);
        assert.equal(options.cwd, options.env.TMPDIR);
        return successful(args);
      }
    });
    assert.equal(receipt.ok,true);
    assert.match(receipt.executableSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.compilerArtifactSha256.length,1);
    assert.match(receipt.compilerArtifactSha256[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.provenanceVerified,false);
  });
});

test('subprocess exception cannot leak scratch directories or a passing receipt', async () => {
  let scratch;
  await assert.rejects(runSourceAdmission({
    backend:'llvm', argv:['/usr/bin/true','{file}'], sourceSha,
    spawn:(_,args,opts) => {
      scratch = opts.cwd;
      assert.ok(args.at(-1).startsWith(scratch));
      throw Error('injected subprocess exception');
    }
  }), /injected subprocess exception/);
  assert.ok(scratch);
  await assert.rejects(stat(scratch), {code:'ENOENT'});
});

test('non-success exit statuses never masquerade as semantic ownership rejection', () => {
  const good = 'error: actor message sent after stop';
  for (const status of [-1,0,2,3,124,127,128,134,137,139,255]) {
    assert.equal(classifyCompilerResult(negative,{status,stdout:'',stderr:good}), 'UNEXPECTED_COMPILER_RESULT', String(status));
  }
  for (const error of [{code:'ETIMEDOUT'}, {code:'ENOENT'}]) {
    assert.equal(classifyCompilerResult(negative,{status:null,error,stdout:'',stderr:good}), 'EXECUTION_FAILED');
  }
});

test('misleading later diagnostic and compiler crash never promote negative source case', () => {
  const good = 'error: actor message sent after stop';
  const cases = [
    {stderr:'error: unknown grammar\n'+good,expected:'DIAGNOSTIC_MISMATCH'},
    {stderr:'error: parser rejected quoted text "actor message sent after stop"',expected:'DIAGNOSTIC_MISMATCH'},
    {stderr:good+'\nsegmentation fault',expected:'COMPILER_CRASH'},
    {stderr:good+'\nstacktrace',expected:'COMPILER_CRASH'},
    {stderr:good+'\nfatal error: heap corrupt',expected:'COMPILER_CRASH'},
    {stderr:'note: '+good,expected:'UNEXPECTED_COMPILER_RESULT'}
  ];
  for(const {stderr,expected} of cases) {
    assert.equal(classifyCompilerResult(negative,{status:1,stdout:'',stderr}),expected);
  }
});

test('large stdout, even with correct stderr, is rejected as oversized', () => {
  assert.equal(classifyCompilerResult(negative,{
    status:1,stdout:'x'.repeat(262144),stderr:'error: actor message sent after stop'
  }),'OUTPUT_TOO_LARGE');
});

test('unconfigured source admission cannot inherit a forged certification receipt', async () => {
  for (const backend of ['llvm','java']) {
    const receipt = await runSourceAdmission({backend,sourceSha});
    assert.equal(receipt.ok,false);
    assert.equal(receipt.verificationScope,'NOT_EXECUTED');
    assert.equal(receipt.certificationEligible,false);
    assert.equal(receipt.provenanceVerified,false);
    assert.equal(receipt.runtimeTraceVerified,false);
    assert.equal(receipt.physicalIsolationVerified,false);
    assert.ok(receipt.results.every(x => x.status==='UNCONFIGURED'));
  }
});
