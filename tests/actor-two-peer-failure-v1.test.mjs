import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const base = new URL('../fixtures/actor-two-peer-failure-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
const source = readFileSync(new URL('two-peer-failure-matrix.atto', base));
const sha = bytes => createHash('sha1')
  .update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const requiredEvidence = [
  'guestCompiler', 'guestNative', 'heapIsolation', 'stackContainment',
  'failureHooks', 'supervisorControl'
];
const caseIds = [
  'caught-throw', 'uncaught-throw-actor-recovery', 'raised-lexical-recover',
  'raised-actor-hook-recovery', 'terminal-panic', 'guest-stack-budget-terminal'
];

// Manifest and static source admission are NOT a parser, compiler, runtime,
// or guest proof. They intentionally deny evidence promotion.
function validate(m, bytes) {
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.id, 'actor-two-peer-failure-v1');
  assert.equal(m.language, 'AttoLang');
  assert.equal(m.canonicalExtension, '.atto');
  assert.equal(m.source, 'fixtures/actor-two-peer-failure-v1/two-peer-failure-matrix.atto');
  assert.match(m.sourceGitBlobSha1, /^[0-9a-f]{40}$/);
  assert.equal(sha(bytes), m.sourceGitBlobSha1, 'fixture Git blob must be exact');
  assert.equal(m.evidenceLevel, 'SOURCE_AUTHORED_ONLY');
  assert.equal(m.compilationAdmission, 'UNVERIFIED_PENDING_PORTABLE_SOURCE_ABI');
  assert.equal(m.expectedExitCode, 0);
  assert.equal(m.expectedStdout, 'ACTOR_TWO_PEER_V1_OK|6|42\n');
  assert.deepEqual(m.actors, ['FaultWorker', 'Witness']);
  assert.equal(m.supervisor, 'Root');
  assert.equal(m.witnessPayload, 42);
  assert.equal(m.cases.length, 6);
  assert.deepEqual(m.cases.map(c => c.mode), [0,1,2,3,4,5]);
  assert.deepEqual(m.cases.map(c => c.id), caseIds);
  assert.deepEqual(m.cases.map(c => c.faultResponse), [100,101,202,203,null,null]);
  assert.deepEqual(m.cases.map(c => c.guestCatch), [1,0,0,0,0,0]);
  assert.deepEqual(m.cases.map(c => c.lexicalRecover), [0,0,1,0,0,0]);
  assert.deepEqual(m.cases.map(c => c.actorOnThrow), [0,1,0,0,0,0]);
  assert.deepEqual(m.cases.map(c => c.actorOnRaise), [0,0,0,1,0,0]);
  assert.deepEqual(m.cases.map(c => c.supervisorOnPanic), [0,0,0,0,1,0]);
  assert.deepEqual(m.cases.map(c => c.controlNotices), [0,0,0,0,1,1]);
  for (const c of m.cases) {
    assert.equal(c.witnessResponse, 42);
    if (c.mode < 4) assert.equal(c.postTurnResponse, 7);
    else assert.equal(c.postTurnResponse, null);
  }
  assert.equal(m.cases[4].expectedNoticeKind, 'panic');
  assert.equal(m.cases[4].noGuestTeardown, true);
  assert.equal(m.cases[5].expectedNoticeKind, 'guest_stack_budget_exhausted');
  assert.equal(m.cases[5].guestFrameBudgetBeforeNativeOverflow, true);
  for (const k of [
    'sameSourceBytesAcrossBackends', 'noNativeFaultRecoveryOnSharedCarrier',
    'noActorLocalOnPanic', 'noCrossActorMutableRef',
    'actorHeapProvenanceMeasuredOutsideGuest',
    'postFailureWitnessRunsOnReusedCarrier',
    'supervisorControlsAreAuthenticated',
    'exactlyOneTerminalNoticePerActorIncarnation',
    'actorSourceMustNotPrintSuccessUnconditionally',
    'guestStdoutAloneInsufficient', 'disabledCrossOrgSourceCopy'
  ]) assert.equal(m.invariants[k], true, k);

  const text = bytes.toString('utf8');
  assert.ok(text.endsWith('\n'));
  assert.deepEqual([...text.matchAll(/define pub actor (\w+) as/g)]
    .map(x => x[1]), ['Witness','FaultWorker']);
  assert.match(text, /define pub supervisor Root as/);
  assert.match(text, /critical-read/);
  assert.match(text, /defer recover/);
  assert.match(text, /non_tail_fault\(100000\)/);
  assert.match(text, /root\.control_events\.next\(\)/);
  assert.match(text, /worker\.incarnation/);
  assert.match(text, /await witness\.outputs\.next\(\)/);
  assert.match(text, /ACTOR_TWO_PEER_V1_OK\|6\|42/);
  assert.match(text, /UNVERIFIED|NOT EXECUTED|NOT presently parser-valid/);
  const workerRegion = text.split('define pub actor FaultWorker as')[1]?.split('define pub supervisor Root as')[0];
  assert.ok(workerRegion);
  assert.doesNotMatch(workerRegion, /\n\s*(?:pub )?on_panic\s*\(/);
  const sourceDependencies = m.sourceAbiDependencies.join('|');
  for (const required of ['Root.spawn_child', 'Root.control_events', 'defer recover', 'stack'])
    assert.ok(sourceDependencies.includes(required));

  assert.deepEqual(Object.keys(m.backends).sort(), ['java','llvm','net']);
  for (const [backend,record] of Object.entries(m.backends)) {
    assert.equal(record.repository, 'ores-truffle-oreslang/oreslang-source.' + backend);
    assert.ok(record.candidatePrs.length >= 1);
    assert.equal(record.receipt, null, backend + ' cannot self-certify');
    for (const key of requiredEvidence)
      assert.equal(record[key], 'NOT_EXECUTED', backend + '.' + key);
  }
  assert.ok(m.evidenceRequirements.length >= 12);
  for (const must of ['exact source', 'GitHub job steps', 'native stack',
    'independent review', 'actor heap', 'CONTROL']) {
    assert.ok(m.evidenceRequirements.some(s => s.toLowerCase().includes(must.toLowerCase())), must);
  }
  assert.deepEqual(m.promotion, {
    certified:false,requiresExecutedGuest:true,requiresExactHead:true,
    requiresIndependentEvidenceReview:true,allowsHostModelAsGuest:false,
    allowsParserOnlyAsGuest:false,allowsZeroStepRun:false,
    allowsSyntheticReceipts:false,allowsCrossOrgPrivateSourceCopyWithoutApproval:false
  });
  return true;
}

test('one exact Git-blob fixture and six distinct actor failure cases', () => {
  assert.equal(validate(manifest, source), true);
});

test('mutated source, fake backend passes, weakened safety and case spoofing are rejected', () => {
  const modify = action => { const x = structuredClone(manifest); action(x); return x; };
  const mutants = [
    x => { x.backends.net.guestNative = 'PASS'; },
    x => { x.backends.java.receipt = {conclusion:'success'}; },
    x => { x.backends.llvm.supervisorControl = 'PASS'; },
    x => { x.invariants.noActorLocalOnPanic = false; },
    x => { x.invariants.noNativeFaultRecoveryOnSharedCarrier = false; },
    x => { x.invariants.guestStdoutAloneInsufficient = false; },
    x => { x.promotion.certified = true; },
    x => { x.promotion.allowsZeroStepRun = true; },
    x => { x.cases[4].controlNotices = 0; },
    x => { x.cases[5].guestFrameBudgetBeforeNativeOverflow = false; },
    x => { x.cases[2].lexicalRecover = 0; },
    x => { x.cases[3].actorOnRaise = 0; },
    x => { x.cases[4].actorOnThrow = 1; },
    x => { x.cases[0].witnessResponse = 43; },
    x => { x.cases[3].mode = 2; },
    x => { x.cases[5].id = x.cases[4].id; },
    x => { x.sourceGitBlobSha1 = '0'.repeat(40); },
    x => { x.backends.net = x.backends.llvm; },
    x => { delete x.backends.java; },
    x => { x.source = '../unsafe.ores'; }
  ];
  for (const fn of mutants)
    assert.throws(() => validate(modify(fn), source));
  const changed = Buffer.from(source);
  changed[changed.length-2] ^= 1;
  assert.throws(() => validate(manifest, changed));
  assert.throws(() => validate(manifest,
    Buffer.from(source.toString('utf8').replaceAll('\n','\r\n'))));
});
