import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const original=fileURLToPath(new URL('../bin/verify-native-numeric-source.mjs',import.meta.url));
const secret='PRIVATE_RUNNER_PATH_MUST_BE_REDACTED';

async function withIsolatedCLI(setup,verify){
  const root=await mkdtemp(join(tmpdir(),'ores-'+secret+'-'));
  try{
    const bin=join(root,'bin'),src=join(root,'src');
    await mkdir(bin);await mkdir(src);
    const cli=join(bin,'verify-native-numeric-source.mjs');
    await copyFile(original,cli);
    await setup(src);
    const result=spawnSync(process.execPath,[cli],{
      encoding:'utf8',timeout:10000,
      env:{...process.env,NODE_OPTIONS:'',GITHUB_TOKEN:'SECRET_TOKEN_MUST_NOT_LEAK'}
    });
    assert.equal(result.status,2);
    assert.equal(result.stdout,'');
    assert.equal(result.stderr,'NATIVE_EVIDENCE_UNAVAILABLE: UNCLASSIFIED_EXECUTION_OR_IO_ERROR\n');
    assert.doesNotMatch(result.stderr,/PRIVATE_RUNNER_PATH|SECRET_TOKEN|ERR_MODULE_NOT_FOUND|SyntaxError/);
    verify?.(result);
  }finally{await rm(root,{recursive:true,force:true});}
}

test('missing diagnostic module cannot leak native CLI import path',async()=>{
  await withIsolatedCLI(async()=>{});
});

test('missing compiler evidence module cannot leak native CLI import path',async()=>{
  await withIsolatedCLI(async src=>{
    await writeFile(join(src,'native-numeric-safe-diagnostics.mjs'),
      'export function nativeNumericSafeFailureCode(){return "UNCLASSIFIED_EXECUTION_OR_IO_ERROR";}\n');
  });
});

test('syntax-invalid diagnostic module cannot leak source path or parser excerpt',async()=>{
  await withIsolatedCLI(async src=>{
    await writeFile(join(src,'native-numeric-safe-diagnostics.mjs'),
      'THIS_IS_NOT_VALID_JAVASCRIPT !!! SECRET_TOKEN_MUST_NOT_LEAK\n');
  });
});
