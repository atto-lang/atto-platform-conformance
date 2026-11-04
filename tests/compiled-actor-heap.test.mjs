import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCompiledActorHeap } from '../tools/verify-compiled-actor-heap.mjs';

const source = readFileSync(new URL('../fixtures/actor-memory/compiled-guest-v1/two-same-kind-actors.ores', import.meta.url));
const mk = () => {
  const a = {actorId:'actor:a:7', heapId:'heap:a:7'};
  const b = {actorId:'actor:b:9', heapId:'heap:b:9'};
  const row = (actor, message, value) => ({type:'guest-handler-result', actor, message, value,
    ...(actor === 'a' ? a : b)});
  return {
    schemaVersion:2,
    kind:'ACTUAL_COMPILED_ORES_GUEST',
    backend:'llvm',
    sourceGitBlobSha1:'430565092d8a4ff114f601a54b771ef3d42eae58',
    sourceCommitSha1:'a'.repeat(40),
    sourceTreeSha1:'d'.repeat(40),
    compilerSha256:'b'.repeat(64),
    artifactSha256:'c'.repeat(64),
    runId:100,
    jobId:200,
    attempt:1,
    runnerJobUrl:'https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/100/job/200',
    steps:[
      {name:'compiler_build',number:1,executed:true,conclusion:'success'},
      {name:'guest_compile',number:2,executed:true,conclusion:'success'},
      {name:'guest_execute',number:3,executed:true,conclusion:'success'},
      {name:'reject_foreign_access',number:4,executed:true,conclusion:'success'},
      {name:'reject_read_loan_write',number:5,executed:true,conclusion:'success'}
    ],
    negatives:{
      'foreign-state':{
        sourceSha256:'3071307899db9c4f4f3acc44465d60dd77d2ee2d2c0930d4bcc23e7fd9a8e94c',
        exitCode:1,diagnosticClass:'FOREIGN_ACTOR_STATE_DENIED',outputArtifacts:0
      },
      'read-loan-write':{
        sourceSha256:'9af717d6cea42dbb6e1192981c227222ad837a8e54785ce205c676d1d33be3b5',
        exitCode:1,diagnosticClass:'WRITE_WITH_READ_LOAN_DENIED',outputArtifacts:0
      }
    },
    events:[
      {type:'spawn',actor:'a',...a}, {type:'spawn',actor:'b',...b},
      row('a',1,2),row('b',5,10),row('a',2,8),row('b',6,32),
      row('a',3,22),row('b',7,78),row('a',4,52),
      {type:'foreign-read-denied',requester:b.actorId,owner:a.actorId,reason:'owner-authority'},
      {type:'foreign-write-denied',requester:b.actorId,owner:a.actorId,reason:'owner-authority'},
      {type:'loan-open',actorId:a.actorId,heapId:a.heapId,loanId:'loan-a',mode:'read'},
      {type:'own-write-denied',actorId:a.actorId,heapId:a.heapId,reason:'read-loan-live'},
      row('b',8,172),
      {type:'stop-requested',...a},
      {type:'reclaim-deferred',...a,reason:'loan-not-quiescent'},
      {type:'loan-close',...a,loanId:'loan-a'},
      {type:'physically-reclaimed',...a},
      row('b',9,362),
      {type:'survivor-read',...b,value:362},
      {type:'stop-requested',...b},
      {type:'physically-reclaimed',...b},
      {type:'guest-exit',code:43}
    ]
  };
};

test('valid receipt remains candidate-only across all backends', () => {
  for (const backend of ['java','llvm','net','wasm','cranelift','forge']) {
    const receipt = mk();
    receipt.backend = backend;
    receipt.runnerJobUrl = `https://github.com/ores-truffle-oreslang/oreslang-source.${backend}/actions/runs/100/job/200`;
    const result = verifyCompiledActorHeap(receipt, source);
    assert.equal(result.classification, 'CANDIDATE_TRACE_ONLY');
    assert.equal(result.independentlyAttested, false);
    assert.equal(result.publiclyPromotable, false);
  }
});

const denied = (title, mutate, pattern = /compiled actor guest:/) => test(title, () => {
  const receipt = mk();
  const bytes = Buffer.from(source);
  mutate(receipt, bytes);
  assert.throws(() => verifyCompiledActorHeap(receipt, bytes), pattern);
});

denied('deny host-only receipt', r => {r.kind='HOST_ARENA_TEST';});
denied('deny zero-step receipt', r => {r.steps=[];}, /missing successful executed step/);
denied('deny skipped guest execution', r => {
  r.steps.find(x => x.name === 'guest_execute').conclusion='skipped';
});
denied('deny duplicate CI step numbers', r => {r.steps[1].number=r.steps[0].number;});
denied('deny runner URL inconsistent with run identity', r => {r.runId=101;});
denied('deny missing foreign-state semantic negative', r => {r.negatives['foreign-state'].outputArtifacts=1;});
denied('deny wrong read-loan diagnostic class', r => {r.negatives['read-loan-write'].diagnosticClass='UNSUPPORTED_SYNTAX';});
denied('deny shared physical actor heap identity', r => {r.events[1].heapId = r.events[0].heapId;});
denied('deny same runtime actor identity', r => {r.events[1].actorId = r.events[0].actorId;});
denied('deny crossed actor heap owner', r => {r.events[4].heapId=r.events[1].heapId;});
denied('deny false handler result despite exit 43', r => {r.events[13].value=171;});
denied('deny omitted foreign authority rejection', r => {r.events.splice(9,1);});
denied('deny foreign access presented as permitted', r => {r.events[10].reason='allowed';});
denied('deny missing loan write barrier', r => {r.events[12].type='own-write-accepted';});
denied('deny early physical free before loan close', r => {const e=r.events; [e[16],e[17]]=[e[17],e[16]];});
denied('deny B stalled after A stops', r => {r.events[18].value=0;});
denied('deny missing B surviving A physical free', r => {r.events[19].value=0;});
denied('deny forged verified flag', r => {r.verified=true;});
denied('deny status promotions in input', r => {r.status='VERIFIED';});
denied('deny missing compiled artifact SHA', r => {r.artifactSha256='0'.repeat(64);});
denied('deny stale fixture pin', r => {r.sourceGitBlobSha1='e'.repeat(40);});
denied('deny changed fixture bytes', (_,bytes) => {bytes[5] = bytes[5] === 88 ? 89 : 88;});
denied('deny invented backend', r => {r.backend='js';});

denied('deny job URL borrowed from another source backend', r => {
  r.runnerJobUrl='https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/100/job/200';
}, /exact backend source repository/);
denied('deny job URL from another organization', r => {
  r.runnerJobUrl='https://github.com/outside-org/oreslang-source.llvm/actions/runs/100/job/200';
}, /exact backend source repository/);
