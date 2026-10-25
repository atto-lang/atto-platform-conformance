import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativeNumericSafeFailureCode} from '../src/native-numeric-safe-diagnostics.mjs';

const fallback='UNCLASSIFIED_EXECUTION_OR_IO_ERROR';

test('unknown filesystem errors never reveal private absolute paths',()=>{
  const secret='GH_TOKEN_SUPER_SECRET_DO_NOT_ECHO';
  for(const bad of [
    new Error("ENOENT: no such file, lstat '/tmp/"+secret+"'"),
    new Error("clang failed: Authorization: Bearer "+secret),
    new Error('LLVM compiler SHA-256 differs; '+secret),
    new Error('native executable exists before Clang link '+secret),
    Object.defineProperty({},'message',{get(){throw Error(secret)}}),
    null,undefined,{message:secret},{message:42}
  ]){
    assert.equal(nativeNumericSafeFailureCode(bad),fallback);
  }
});

test('recognized exact static errors retain useful non-sensitive codes',()=>{
  for(const [message,code] of [
    ['unexpected/duplicate argument','INVALID_CLI_ARGUMENT'],
    ['missing --clang-resource-dir','MISSING_REQUIRED_ARGUMENT'],
    ['exact 40-character LLVM source SHA required','INVALID_SOURCE_COMMIT_PIN'],
    ['numeric source fixture manifest SHA-256 mismatch','MANIFEST_BYTES_MISMATCH'],
    ['missing or oversized LLVM IR','LLVM_IR_INVALID'],
    ['Clang did not produce a safe native executable','NATIVE_EXECUTABLE_UNSAFE']
  ]){
    assert.equal(nativeNumericSafeFailureCode(new Error(message)),code);
  }
  assert.equal(nativeNumericSafeFailureCode(new Error('missing --token')),fallback);
});

test('native evidence CLI redacts a failed compiler path and environment secret',()=>{
  const secret='SECRET_IN_FILESYSTEM_PATH_MUST_NOT_LEAK';
  const cli=fileURLToPath(new URL('../bin/verify-native-numeric-source.mjs',import.meta.url));
  const manifest=readFileSync(fileURLToPath(new URL('../fixtures/numeric-separators-source-v1.json',import.meta.url)));
  const args=[
    cli,
    '--compiler='+join(tmpdir(),secret,'does-not-exist'),
    '--compiler-sha256='+'1'.repeat(64),
    '--clang='+join(tmpdir(),'clang-does-not-matter'),
    '--clang-sha256='+'2'.repeat(64),
    '--clang-resource-dir='+tmpdir(),
    '--source-commit='+'a'.repeat(40),
    '--manifest-sha256='+createHash('sha256').update(manifest).digest('hex')
  ];
  const result=spawnSync(process.execPath,args,{
    encoding:'utf8',timeout:10000,
    env:{...process.env,GITHUB_TOKEN:'UNSAFE_ENV_TOKEN_SHOULD_NOT_PRINT'}
  });
  assert.equal(result.status,2,'CLI must fail closed: '+result.stderr);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/^NATIVE_EVIDENCE_UNAVAILABLE: UNCLASSIFIED_EXECUTION_OR_IO_ERROR\n$/);
  assert.doesNotMatch(result.stderr,/SECRET_IN_FILESYSTEM_PATH|UNSAFE_ENV_TOKEN|Bearer/);
});

test('JSON receipt cannot copy a raw caught exception into evidence.failure',()=>{
  const source=readFileSync(fileURLToPath(new URL('../src/native-numeric-source-evidence.mjs',import.meta.url)),'utf8');
  assert.match(source,/evidence\.failure=nativeNumericSafeFailureCode\(e\)/);
  assert.doesNotMatch(source,/evidence\.failure\s*=\s*String\(/);
});
