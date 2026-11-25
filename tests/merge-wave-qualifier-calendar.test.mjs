import assert from 'node:assert/strict';
import test from 'node:test';
import {qualifyCandidate, qualifyWave} from '../tools/merge-wave-qualifier.mjs';

// Keep this suite independent of candidate fixtures: rejection must occur
// before any PR evidence can be interpreted.
const snapshot = as_of => ({schema_version:1, as_of, candidates:[]});
const leaseReasons = (expires_at, asOf='2026-11-06T18:00:00Z') =>
  qualifyCandidate({lease:{expires_at}}, Date.parse(asOf))
    .filter(x => x.kind === 'lease').map(x => x.reason);

test('reject date normalization at month end and non-leap years', () => {
  for (const value of [
    '2026-02-30T18:00:00Z',
    '2025-02-29T18:00:00Z',
    '1900-02-29T18:00:00Z',
    '2024-02-30T18:00:00Z',
    '2026-04-31T18:00:00Z',
    '2026-06-31T18:00:00Z',
    '2026-11-31T18:00:00Z'
  ]) assert.throws(() => qualifyWave(snapshot(value)), TypeError, value);
});

test('reject invalid calendar components before Date.parse normalizes them', () => {
  for (const value of [
    '0000-01-01T18:00:00Z',
    '2026-00-01T18:00:00Z',
    '2026-13-01T18:00:00Z',
    '2026-01-00T18:00:00Z',
    '2026-01-32T18:00:00Z',
    '2026-11-06T24:00:00Z',
    '2026-11-06T19:60:00Z',
    '2026-11-06T19:00:60Z'
  ]) assert.throws(() => qualifyWave(snapshot(value)), TypeError, value);
});

test('valid leap days stay accepted, including Gregorian century rules', () => {
  for (const value of [
    '2000-02-29T18:00:00Z',
    '2024-02-29T18:00:00Z',
    '2026-11-06T18:00:00Z'
  ]) assert.doesNotThrow(() => qualifyWave(snapshot(value)), value);
});

test('snapshot timestamps still require exact UTC seconds', () => {
  for (const value of [
    '2026-11-06T18:00:00+00:00',
    '2026-11-06T18:00:00.123Z',
    '2026-11-06t18:00:00z',
    '2026-11-06T18:00:00'
  ]) assert.throws(() => qualifyWave(snapshot(value)), TypeError, value);
});

test('invalid agent lease dates fail closed instead of silently expiring', () => {
  for (const value of [
    '2026-02-30T18:00:00Z',
    '2025-02-29T18:00:00+00:00',
    '2026-04-31T23:00:00-04:00',
    '2026-11-06T24:00:00Z',
    '2026-11-06T18:00:00+24:00',
    '2026-11-06T18:00:00-00:60',
    '2026-11-06T18:00:00.123456789+25:00'
  ]) assert(leaseReasons(value).includes('active_or_unknown_agent_lease'), value);
});

test('valid expired lease with UTC offset or fractional seconds remains admissible', () => {
  for (const value of [
    '2024-02-29T20:00:00.123+02:00',
    '2000-02-29T00:00:00Z',
    '2026-11-06T12:00:00.123456789-03:00'
  ]) assert.deepEqual(leaseReasons(value), [], value);
});

test('valid active lease cannot be bypassed using an offset', () => {
  assert(leaseReasons('2026-11-06T19:00:00.123+00:00')
    .includes('active_or_unknown_agent_lease'));
});
