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
