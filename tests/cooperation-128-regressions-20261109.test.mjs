import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/safepoints/cooperation-128-v1.json', import.meta.url)));
const i64max = (1n << 63n) - 1n;
const i64min = -(1n << 63n);

function validateContract(f) {
  assert.equal(f.schemaVersion, 1);
  assert.equal(f.contract, 'attolang-cooperation-128-v1');
  assert.equal(f.evidenceStatus, 'SOURCE_FREE_NON_CERTIFYING');
  assert.deepEqual(Object.keys(f.backendGuestEvidence).sort(), ['forge', 'java', 'llvm', 'net', 'wasm']);
  for (const status of Object.values(f.backendGuestEvidence)) assert.equal(status, 'NOT_EXECUTED');
  assert.equal(f.slowPollInterval, 128);
  assert.equal(f.softReductionTarget, 512);
  assert.equal(f.softTimeBudgetNs, 2_000_000);
  assert.ok(f.hardFuelPolicy.untrustedChargeEachCommittedBackedge);
  assert.ok(f.hardFuelPolicy.untrustedChargeEachRecursiveHop);
  assert.equal(f.hardFuelPolicy.fuelMayRefillOnPhysicalDispatch, false);
  assert.equal(f.hardFuelPolicy.softPollMayReplaceHardFuel, false);
  assert.equal(f.hardFuelPolicy.automaticUntrustedSuspendCertified, false);
  assert.equal(f.hardFuelPolicy.noYieldExitRequiresHeapContinuationAndReleasedGuards, true);
}

// Source-free policy transitions; NOT compiled Java/LLVM/Wasm/Forge/.NET.
class QuantumOracle {
  constructor(interval, cap) {
    this.interval = interval; this.cap = cap; this.phase = 0;
    this.dispatchEdges = 0; this.ticket = false; this.pending = false;
    this.acknowledged = false; this.coldPolls = 0;
    this.clockReads = 0; this.hardFuel = 4096;
  }
  beginDispatch() {
    if (!this.acknowledged && this.dispatchEdges >= this.cap) this.pending = true;
    this.acknowledged = false; this.dispatchEdges = 0; this.ticket = false;
    this.clockReads++; // physical dispatch sample, not a new logical hard quota
  }
  edge({untrusted = false} = {}) {
    if (untrusted) {
      if (this.hardFuel === 0) throw new Error('logical fuel exhausted');
      this.hardFuel--;
    }
    this.dispatchEdges++; this.phase = (this.phase + 1) % this.interval;
    this.ticket = this.phase === 0;
    return this.ticket;
  }
  slowPoll({watchdog = false, elapsedOverdue = false} = {}) {
    if (!this.ticket) return false;
    this.ticket = false; this.coldPolls++;
    if (this.pending || watchdog || elapsedOverdue || this.dispatchEdges >= this.cap) {
      this.pending = true; return true;
    }
    this.clockReads++; return false;
  }
  noYieldExitHint() { return this.pending || this.dispatchEdges >= this.cap; }
  recordedCooperate() {
    this.pending = false; this.acknowledged = true; this.ticket = false;
  }
}

function elapsedOverdue(start, now, limitNs) {
  const begin = BigInt(start), current = BigInt(now);
  assert.ok(begin >= i64min && begin <= i64max);
  assert.ok(current >= i64min && current <= i64max);
  return current < begin || current - begin >= BigInt(limitNs);
}

test('fixture is canonical and five backend guest claims fail closed', () => {
  validateContract(fixture);
  assert.throws(() => validateContract({...fixture, backendGuestEvidence: {...fixture.backendGuestEvidence, llvm: 'PASS'}}));
  assert.throws(() => validateContract({...fixture, hardFuelPolicy: {...fixture.hardFuelPolicy, fuelMayRefillOnPhysicalDispatch: true}}));
});

test('127/128/129 and 511/512/513 edge boundaries never alter slow poll cadence', () => {
  const q = new QuantumOracle(fixture.slowPollInterval, fixture.softReductionTarget);
  q.beginDispatch(); const checks = new Set(fixture.boundaries); const due = [];
  for (let n = 1; n <= 1024; n++) {
    const poll = q.edge();
    if (poll) due.push(n);
    if (checks.has(n)) assert.equal(poll, n % fixture.slowPollInterval === 0, `n=${n}`);
  }
  assert.deepEqual(due, fixture.expectedColdPollBoundaries);
});

test('eight 127-edge physical dispatches still generate seven cold polls', () => {
  const q = new QuantumOracle(fixture.slowPollInterval, fixture.softReductionTarget);
  const due = []; let absolute = 0;
  for (const width of fixture.shortDispatchWidths) {
    q.beginDispatch();
    for (let i = 0; i < width; i++) {
      absolute++;
      if (q.edge()) { due.push(absolute); assert.equal(q.slowPoll(), false); }
      else {
        const before = q.clockReads;
        assert.equal(q.slowPoll({watchdog: true}), false);
        assert.equal(q.clockReads, before);
      }
    }
    assert.equal(q.dispatchEdges, 127);
  }
  assert.deepEqual(due, fixture.expectedShortDispatchPolls);
  assert.equal(q.coldPolls, 7);
});

test('guard-deferred 512-reduction debt survives await until legal handoff', () => {
  const q = new QuantumOracle(fixture.slowPollInterval, fixture.softReductionTarget);
  q.beginDispatch();
  for (let i = 0; i < fixture.deferredHandoff.guardHeldBackedges; i++) q.edge();
  assert.equal(q.noYieldExitHint(), fixture.deferredHandoff.pendingAtGuardExit);
  q.beginDispatch();
  assert.equal(q.noYieldExitHint(), fixture.deferredHandoff.pendingAfterCarrierRestart);
  for (let i = 0; i < fixture.deferredHandoff.nextDispatchBackedges; i++) q.edge();
  assert.equal(q.slowPoll(), true);
  q.recordedCooperate();
  assert.equal(q.noYieldExitHint(), fixture.deferredHandoff.pendingAfterCooperate);
  q.beginDispatch();
  assert.equal(q.noYieldExitHint(), false);
});

test('single-use watchdog tickets cannot reenter after consume/redispatch', () => {
  const q = new QuantumOracle(fixture.slowPollInterval, fixture.softReductionTarget);
  q.beginDispatch();
  for (let i = 0; i < 127; i++) {
    assert.equal(q.edge(), false);
    assert.equal(q.slowPoll({watchdog: true}), false);
  }
  assert.equal(q.edge(), true);
  assert.equal(q.slowPoll({watchdog: true}), true);
  const reads = q.clockReads;
  assert.equal(q.slowPoll({watchdog: true}), false);
  q.beginDispatch();
  assert.equal(q.slowPoll({watchdog: true}), false);
  assert.equal(q.clockReads, reads + 1);
});

test('signed clocks fail closed on regression, overflow and huge deltas', () => {
  for (const sample of fixture.signedClockCases)
    assert.equal(elapsedOverdue(sample.start, sample.now, fixture.softTimeBudgetNs), sample.expectedOverdue, sample.id);
});

test('untrusted redispatch never recharges logical hard fuel', () => {
  const q = new QuantumOracle(fixture.slowPollInterval, fixture.softReductionTarget);
  for (let t = 0; t < 8; t++) {
    q.beginDispatch();
    for (let j = 0; j < 127; j++) q.edge({untrusted: true});
  }
  assert.equal(q.hardFuel, 4096 - 8 * 127);
  q.recordedCooperate(); q.beginDispatch();
  assert.equal(q.hardFuel, 4096 - 8 * 127);
  for (let i = 0; i < 4096 - 8 * 127; i++) q.edge({untrusted: true});
  assert.throws(() => q.edge({untrusted: true}), /logical fuel exhausted/);
});

test('saturated 64-bit total cannot freeze independent 128 phase', () => {
  let completed = i64max - 1n, phase = 0, seen = 0;
  for (let i = 1; i <= 512; i++) {
    if (completed < i64max) completed++;
    phase = (phase + 1) % fixture.slowPollInterval;
    if (phase === 0) seen++;
  }
  assert.equal(completed, i64max);
  assert.equal(seen, 4);
});
