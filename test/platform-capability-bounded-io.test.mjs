import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync, truncateSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const verifier=fileURLToPath(new URL('../bin/verify-platform-capability-receipt.mjs',import.meta.url));
const receipt=JSON.stringify({
  schema:'oreslang.platform-capability/1',
  platform:'desktop',
  repository:'ores-truffle-oreslang/oreslang-platform.desktop',
  sourceCommit:'a'.repeat(40),
  stage:'compiler-guest',
  evidence:{
    exactHead:true,executedSteps:2,workflowConclusion:'success',
    targetArtifactSha256:'b'.repeat(64),
    abiLinked:true,hostReferenceOnly:false,compilerProduced:true,
    compilerSourceCommit:'c'.repeat(40),compilerBinarySha256:'d'.repeat(64)
  }
});

function runFixture(build) {
  const dir=mkdtempSync(join(tmpdir(),'atto-bounded-json-'));
  try {
    const path=join(dir,'receipt.json');
    build(path);
    const result=spawnSync(process.execPath,[verifier,path],{
      encoding:'utf8',timeout:10000,maxBuffer:128*1024
    });
    assert.equal(result.error,undefined,'verifier failed to launch');
    assert.equal(result.signal,null,'verifier unexpectedly terminated');
    return result;
  } finally { rmSync(dir,{recursive:true,force:true}); }
}

test('exact 1 MiB valid JSON receipt remains accepted as schema-only',()=>{
  const payload=receipt+' '.repeat(1048576-Buffer.byteLength(receipt));
  assert.equal(Buffer.byteLength(payload),1048576);
  const result=runFixture(path=>writeFileSync(path,payload));
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/SCHEMA_ONLY; NOT_AUTHENTICATED/);
});

test('one byte beyond cap is rejected before parsing',()=>{
  const payload=receipt+' '.repeat(1048577-Buffer.byteLength(receipt));
  const result=runFixture(path=>writeFileSync(path,payload));
  assert.equal(result.status,1);
  assert.match(result.stderr,/JSON exceeds size limit/);
  assert.doesNotMatch(result.stdout,/PASS/);
});

test('sparse 1 GiB receipt is rejected without unbounded read allocation',()=>{
  const result=runFixture(path=>{
    writeFileSync(path,receipt);
    truncateSync(path,1024*1024*1024);
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/JSON exceeds size limit/);
  assert.doesNotMatch(result.stdout,/PASS/);
});

test('missing or nonregular JSON source cannot satisfy receipt gate',()=>{
  const missing=runFixture(()=>{});
  assert.equal(missing.status,1);
  assert.doesNotMatch(missing.stdout,/PASS/);
  if(process.platform!=='win32'){
    const nonregular=runFixture(path=>{
      // A symlink to a nonregular source exercises the fstat guard.
      // /dev/null is an ordinary character device on POSIX hosts.
      symlinkSync('/dev/null',path);
    });
    assert.equal(nonregular.status,1);
    assert.match(nonregular.stderr,/regular JSON file/);
  }
});
