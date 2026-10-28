import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCompiledActorHeap } from '../tools/verify-compiled-actor-heap.mjs';

const source = readFileSync(new URL('../fixtures/actor-memory/compiled-guest-v1/two-same-kind-actors.ores', import.meta.url));
const mk = () => {
  const a = {actorId:'actor:a:7', heapId:'heap:a:7'};
  const b = {actorId:'actor:b:9', heapId:'heap:b:9'};
  const row = (actor, message, value) => ({type:'guest-handler-result',actor, message, value,...(actor==='a'?a:b)});
  return {
    schemaVersion:1, backend:'llvm', sourceGitBlobSha1:'016733b1fbc8bdfbde7414a15b877a190dd92806',
    sourceCommitSha1:'a'.repeat(40), compilerSha256:'b'.repeat(64), artifactSha256:'c'.repeat(64),
    runnerJobUrl:'https://github.com/example-org/example-repo/actions/runs/100/job/200',
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
test('only candidate classification on a syntactically valid full guest observation', () => {
  for (const backend of ['java','llvm','net','wasm','forge']) {
    const rec = mk(); rec.backend = backend;
    assert.equal(verifyCompiledActorHeap(rec, source).classification, 'CANDIDATE_TRACE_ONLY');
  }
});
const denied = (title, mutate) => test(title, () => {
  const receipt=mk(); const b=Buffer.from(source); mutate(receipt,b);
  assert.throws(() => verifyCompiledActorHeap(receipt,b), /compiled actor guest:/);
});
denied('deny shared physical actor heap identity', r => {r.events[1].heapId = r.events[0].heapId;});
denied('deny same runtime actor identity', r => {r.events[1].actorId = r.events[0].actorId;});
denied('deny crossed actor heap owner', r => {r.events[4].heapId=r.events[1].heapId;});
denied('deny false handler result, though exit code is 43', r => {r.events[13].value=171;});
denied('deny omitted foreign authority rejection', r => {r.events.splice(9,1);});
denied('deny foreign access presented as permitted', r => {r.events[10].reason='allowed';});
denied('deny missing loan write barrier', r => {r.events[12].type='own-write-accepted';});
denied('deny early physical free before loan close', r => {const e=r.events; [e[16],e[17]]=[e[17],e[16]];});
denied('deny B stalled after A stops', r => {r.events[18].value=0;});
denied('deny missing B surviving A physical free', r => {r.events[19].value=0;});
denied('deny forged verified flag', r => {r.verified=true;});
denied('deny status promotions in input', r => {r.status='VERIFIED';});
denied('deny missing compiled artifact SHA', r => {r.artifactSha256='0'.repeat(64);});
denied('deny a stale/mismatched fixture pin', r => {r.sourceGitBlobSha1='d'.repeat(40);});
denied('deny changed fixture bytes', (_,b) => {b[5] = b[5] === 88 ? 89 : 88;});
denied('deny invented backend', r => {r.backend='js';});
denied('deny source-free or synthetic receipt URL', r => {r.runnerJobUrl='https://example.com/synthetic';});
