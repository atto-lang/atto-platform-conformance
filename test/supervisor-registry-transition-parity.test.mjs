import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRegistryTransitions, extractRegistryTransitions,
  EXPECTED_REGISTRY_RESTART} from '../bin/compare-supervisor-registry-transitions.mjs';

const MARKER = 'SUPERVISOR_REGISTRY_TRANSITIONS_V1=';
const valid = MARKER + EXPECTED_REGISTRY_RESTART.join('>') + '\n';

test('identical committed journal sequence is admitted', () => {
  assert.deepEqual(compareRegistryTransitions('java test\n'+valid,
    'native test\n'+valid), {ok:true,scope:'trusted-host-registry-only',steps:11});
});
test('a missing runtime log is not replaced by a canonical fixture',()=>{
  assert.throws(()=>compareRegistryTransitions('',valid), /exactly one/);
  assert.throws(()=>compareRegistryTransitions(valid,''), /exactly one/);
});
test('duplicate markers fail even when both markers agree',()=>{
  assert.throws(()=>extractRegistryTransitions(valid+valid,'java'),/exactly one/);
});
test('illegal skipped admission or cleanup fails',()=>{
  const skipped=MARKER+EXPECTED_REGISTRY_RESTART.filter(
    x=>x!=='restart.admit-verified').join('>')+'\n';
  assert.throws(()=>compareRegistryTransitions(valid,skipped),/REGISTRY_TRANSITION_MISMATCH/);
  const extra=MARKER+EXPECTED_REGISTRY_RESTART.join('>')+'>restart.commit\n';
  assert.throws(()=>compareRegistryTransitions(extra,valid),/REGISTRY_TRANSITION_MISMATCH/);
});
test('malformed output or duplicate records fail',()=>{
  assert.throws(()=>extractRegistryTransitions(MARKER+'register>!\n','native'),/malformed/);
  assert.throws(()=>extractRegistryTransitions(MARKER+'register\n','native'),/malformed/);
});

test('embedded log markers and output spoofing cannot claim registry parity', () => {
  assert.throws(() => extractRegistryTransitions('echo '+valid,'java'), /standalone runtime output/);
  assert.throws(() => extractRegistryTransitions('error: '+valid,'java'), /standalone runtime output/);
  assert.throws(() => extractRegistryTransitions('  '+valid,'java'), /standalone runtime output/);
  assert.throws(() => extractRegistryTransitions(
    MARKER+EXPECTED_REGISTRY_RESTART.join('>')+MARKER+'\n','native'),
    /standalone runtime output/);
});
test('marker-only checks do not accept ANSI-wrapped or contaminated lines', () => {
  const color='\x1b[32m'+valid+'\x1b[0m';
  assert.throws(() => extractRegistryTransitions(color,'native'), /standalone runtime output/);
  assert.throws(() => extractRegistryTransitions(
    valid.trimEnd()+' trailing-error\n','native'), /malformed/);
});
