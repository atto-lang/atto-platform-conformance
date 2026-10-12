import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareRestartTraces, extractOneTrace } from
  '../bin/compare-supervisor-restart-traces.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/supervision/v1/verified-restart-trace.json', import.meta.url),
  'utf8'));
const marker = 'SUPERVISOR_RESTART_TRACE_V1=';

test('shared RESTART trace contract contains complete generation and cleanup path', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.actions.length, 11);
  assert.deepEqual(fixture.actions.map(x => x.action), [
    'register','finalize','reserve-restart','stage-replacement',
    'acknowledge-admission','commit-restart','finalize','reserve-restart',
    'stage-replacement','acknowledge-physical-cleanup','abort-restart'
  ]);
  const good = marker + fixture.expectedTrace;
  assert.equal(compareRestartTraces(fixture, good, good).steps, 11);
});

test('matching log markers without true runtime output are not automatically supplied', () => {
  assert.throws(() => compareRestartTraces(fixture, '', ''), /exactly one runtime trace/);
  assert.throws(() => extractOneTrace(marker+'ACTIVE\n'+marker+'ACTIVE', 'java'),
    /exactly one runtime trace/);
});

test('backend mismatch fails CI rather than reporting parity', () => {
  const expected = marker + fixture.expectedTrace;
  const unsafe = marker + fixture.expectedTrace.replace('ADMITTED>ACTIVE', 'SPAWNED>ACTIVE');
  assert.throws(() => compareRestartTraces(fixture, expected, unsafe),
    /BACKEND_REFINEMENT_MISMATCH/);
});

test('mutated fixture is rejected even when both runtime logs agree', () => {
  const expected = marker + fixture.expectedTrace;
  assert.throws(() => compareRestartTraces(
    {...fixture, actions:fixture.actions.slice(1)}, expected, expected),
    /inconsistent/);
});

test('aborted identities and closed CONTROL are explicit negative refinement gates', () => {
  const negatives = fixture.negativeTransitions;
  assert.ok(Array.isArray(negatives));
  assert.equal(new Set(negatives).size, negatives.length, 'duplicate case names');
  for (const fragment of [
    'physically spawned candidate ActorId after cleanup-backed abort',
    'same native scheduler slot and generation after abandoned RESTART',
    'supervisor CONTROL process has closed',
    'two logical children staging the same physical ActorId'
  ]) {
    assert.ok(negatives.some(v => v.includes(fragment)),
      'missing critical physical refinement obligation: ' + fragment);
  }
  assert.match(fixture.implementationNotes.readinessRace, /release gate/);
});
