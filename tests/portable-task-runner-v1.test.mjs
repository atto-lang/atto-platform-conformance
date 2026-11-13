import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('guest runner refuses unconfigured invocation (cannot claim parity)',()=>{
 const script=fileURLToPath(new URL('../bin/portable-task-v1-run.mjs',import.meta.url));
 const x=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:5000});
 assert.equal(x.status,2);
 assert.match(x.stderr,/TASK_GUEST_RUNNER_DENIED/);
 assert.doesNotMatch(x.stdout,/"passed":14/);
});

test('structural-only matrix CLI fails release gate without actual verified guest evidence',()=>{
 const script=fileURLToPath(new URL('../bin/portable-task-v1.mjs',import.meta.url));
 const out=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:8000});
 assert.equal(out.status,1);
 const report=JSON.parse(out.stdout);
 assert.equal(report.backends.java.not_executed,14);
 assert.equal(report.backends.llvm.not_executed,14);
 assert.equal(report.backends.rs.not_executed,14);
 assert.equal(report.backends.wasm.releaseQualified,false);
});

test('guest runner rejects an unknown fixture-only execution request',()=>{
 const script=fileURLToPath(new URL('../bin/portable-task-v1-run.mjs',import.meta.url));
 const x=spawnSync(process.execPath,[script,'--config=/definitely/missing-task-config.json'],{encoding:'utf8',timeout:5000});
 assert.equal(x.status,2);
 assert.match(x.stderr,/TASK_GUEST_RUNNER_DENIED/);
});
