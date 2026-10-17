import test from 'node:test';
import assert from 'node:assert/strict';
import {runJsRuntimeEvidence} from '../src/js-runtime-evidence.mjs';

test('unconfigured real JS runtime collector is explicitly not a pass',async()=>{
 const r=await runJsRuntimeEvidence({});
 assert.equal(r.backend,'js');
 assert.equal(r.status,'UNCONFIGURED');
 assert.equal(r.verified,0);
 assert.equal(r.ok,false);
});

test('missing exact revision, invalid path and bad deadlines fail closed',async()=>{
 await assert.rejects(runJsRuntimeEvidence({compilerScript:'relative/compiler.mjs',declaredSourceSha:'a'.repeat(40)}),/absolute/);
 await assert.rejects(runJsRuntimeEvidence({compilerScript:'/no/such/compiler.mjs'}),/independently pinned compiler script SHA-256/);
 await assert.rejects(runJsRuntimeEvidence({compilerScript:'/no/such/compiler.mjs',declaredSourceSha:'a'.repeat(40),expectedCompilerScriptSha256:'b'.repeat(64),timeoutMs:50}),/timeoutMs/);
 await assert.rejects(runJsRuntimeEvidence({compilerScript:'/no/such/compiler.mjs',declaredSourceSha:'a'.repeat(40)}));
});
