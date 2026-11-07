import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotTimeMs, qualifyWave} from '../tools/merge-wave-qualifier.mjs';

// Test the exported module directly, never only the CLI input parser.
const utc = ms => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sample = as_of => ({schema_version: 1, as_of, candidates: []});
const valid = (s, now = Date.now()) => Number.isFinite(snapshotTimeMs(s, now));

test('fresh UTC source evidence is structurally parseable but not merge permission', () => {
  const stamp = utc(0);
  assert.equal(valid(stamp), true);
  assert.equal(qualifyWave(sample(stamp)).status, 'BLOCKED');
});
test('recent UTC clocks admit exactly the same non-authorizing result', () => {
  for (const min of [-4, -2, 0, 2, 4]) {
    const stamp = utc(min * 60_000);
    assert.equal(valid(stamp), true);
    assert.equal(qualifyWave(sample(stamp)).status, 'BLOCKED');
  }
});
test('old and future direct API snapshots reject before a favorable response', () => {
  for (const ms of [-3600_000, -6 * 60_000, 6 * 60_000, 3600_000]) {
    const stamp = utc(ms);
    assert.equal(valid(stamp), false);
    assert.throws(() => qualifyWave(sample(stamp)), /stale|future/);
  }
});
test('old January snapshots cannot replay positive source evidence', () => {
  const stamp = '2026-01-01T00:00:00Z';
  assert.equal(valid(stamp), false);
  assert.throws(() => qualifyWave(sample(stamp)), TypeError);
});
test('silently normalized impossible day numbers are never canonical', () => {
  for (const stamp of ['2026-02-29T18:00:00Z', '2026-02-30T18:00:00Z',
                        '2026-04-31T18:00:00Z', '2025-02-29T18:00:00Z']) {
    assert.equal(valid(stamp, Date.parse(stamp)), false, stamp);
    assert.throws(() => qualifyWave(sample(stamp)), TypeError);
  }
});
test('genuine leap day works at its pinned reference and is stale afterward', () => {
  const s = '2024-02-29T23:59:59Z';
  assert.equal(snapshotTimeMs(s, Date.parse(s)), Date.parse(s));
  assert.equal(valid(s), false);
});
test('bad month/day/hour/minute/second/year fields are rejected', () => {
  for (const stamp of ['2026-00-01T10:00:00Z','2026-13-01T10:00:00Z',
    '2026-11-00T10:00:00Z','2026-11-32T10:00:00Z',
    '2026-11-06T24:00:00Z','2026-11-06T23:60:00Z',
    '2026-11-06T23:59:60Z','0000-01-01T00:00:00Z']) {
    assert.equal(valid(stamp, Date.parse(stamp)), false, stamp);
  }
});
test('noncanonical timezone, fractional seconds and separators reject', () => {
  const stamp = utc(0);
  for (const value of [stamp.replace('Z','+00:00'),stamp.replace('Z','.000Z'),
    stamp.toLowerCase(),stamp.replace('T',' '),stamp.slice(0,16)+'Z']) {
    assert.equal(valid(value), false, value);
    assert.throws(() => qualifyWave(sample(value)), TypeError);
  }
});
test('missing values and nonfinite clocks cannot qualify evidence', () => {
  for (const input of [null,undefined,0,{},[],true,'']) {
    assert.equal(Number.isFinite(snapshotTimeMs(input)),false);
  }
  for (const now of [NaN,Infinity,-Infinity]) {
    assert.equal(Number.isFinite(snapshotTimeMs(utc(0),now)),false);
  }
});
test('strict five-minute boundary is symmetric under a pinned clock', () => {
  const t=Date.parse('2026-11-06T12:00:00Z');
  const stamp=d=>new Date(t+d).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.equal(valid(stamp(-300000),t),true);
  assert.equal(valid(stamp(300000),t),true);
  assert.equal(valid(stamp(-301000),t),false);
  assert.equal(valid(stamp(301000),t),false);
});
