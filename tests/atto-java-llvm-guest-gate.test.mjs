import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArguments,runGate,main} from '../bin/atto-java-llvm-guest-gate.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const H='a'.repeat(40),T='b'.repeat(40);
const fake={
  'java-check':[process.execPath,'-e','process.exit(0)','{source}'],
  'java-run':[process.execPath,'-e','process.exit(42)','{source}'],
  'llvm-compile':[process.execPath,'-e','require("fs").copyFileSync(process.argv[1],process.argv[2])','{source}','{artifact}'],
  'llvm-run':['{artifact}'],
  'java-head':H,'java-tree':T,'llvm-head':T,'llvm-tree':H
};
const flags=o=>Object.entries(o).map(([k,v])=>'--'+k+'='+(typeof v==='string'?v:JSON.stringify(v)));

test('missing real compiler commands is NOT_EXECUTED and never a parity pass',async()=>{
  const r=await runGate(parseArguments([]));
  assert.equal(r.status,'NOT_EXECUTED');
  assert.equal(r.promotable,false);
  assert.equal(r.stages.length,0);
  assert.equal(r.missing.length,8);
  assert.match(r.fixture.sha256,/^[a-f0-9]{64}$/);
});
test('reject relative executables, interpolation, spoofed commits and wrong placeholders',()=>{
  assert.throws(()=>parseArguments(['--java-head=short']),/invalid java-head/);
  assert.throws(()=>parseArguments(['--java-check=["node","{source}"]']),/absolute path/);
  assert.throws(()=>parseArguments(['--java-check=["/bin/echo","literal-42.atto"]']),/exactly one/);
  assert.throws(()=>parseArguments(['--llvm-run=["/bin/echo","{artifact}"]']),/directly/);
  assert.throws(()=>parseArguments(['--java-run=["/bin/echo","{evil}","{source}"]']),/interpolation/);
  assert.throws(()=>parseArguments(['--java-head='+H,'--java-head='+H]),/repeated/);
  assert.throws(()=>parseArguments(['--timeout-ms=99999999']),/out of range/);
});
test('synthetic Node smoke cannot fabricate a native guest parity receipt',async()=>{
  const r=await runGate(parseArguments(flags(fake)));
  assert.equal(r.promotable,false);
  assert.equal(r.authenticated_ci,false);
  assert.equal(r.status,'INCOMPLETE_OR_FAILED');
  assert.deepEqual(r.stages.map(s=>s.stage),['java-check','java-run','llvm-compile','llvm-run']);
  assert.ok(r.stages.slice(0,3).every(s=>s.oracle_match));
  assert.equal(r.stages[3].oracle_match,false);
  assert.ok(r.blockers.length>0);
});
test('a compile step exiting 0 without an artifact must fail closed',async()=>{
  const bad={...fake,'llvm-compile':[process.execPath,'-e','process.exit(0)','{source}','{artifact}']};
  const r=await runGate(parseArguments(flags(bad)));
  assert.equal(r.status,'INCOMPLETE_OR_FAILED');
  assert.deepEqual(r.stages.map(s=>s.stage),['java-check','java-run','llvm-compile']);
  assert.match(r.blockers.join(' '),/Missing bounded LLVM native artifact/);
});
test('shared .atto fixture is an explicit exit-42 guest oracle',async()=>{
  const source=await readFile(fileURLToPath(new URL('../fixtures/atto-java-llvm-guest-gate/literal-42.atto',import.meta.url)),'utf8');
  assert.match(source,/pub fnc main\(\): int \{ return 42; \}/);
  const r=await runGate(parseArguments([]));
  assert.equal(r.fixture.sha256,'9c8b175cc615d00b3eb2f85d015febe77c48db4dd5e76b09ed3b0f19a05d8629');
});
test('CLI rejects missing runner commands with nonzero exit classification',async()=>{
  assert.equal(await main(['--java-head='+H]),3);
});
