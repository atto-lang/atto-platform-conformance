import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fail-closed consistency gate for one canonical compiled guest contract.
// It validates receipt shape and semantic observations, but it cannot authenticate
// GitHub, the compiler binary, or that a candidate trace came from real execution.
const FIXTURE_BLOB = '430565092d8a4ff114f601a54b771ef3d42eae58';
const FOREIGN_SHA256 = '3071307899db9c4f4f3acc44465d60dd77d2ee2d2c0930d4bcc23e7fd9a8e94c';
const READ_LOAN_SHA256 = '9af717d6cea42dbb6e1192981c227222ad837a8e54785ce205c676d1d33be3b5';
const BACKEND_REPOS = Object.freeze({
  java:'ores-truffle-oreslang/oreslang-source.java',
  llvm:'ores-truffle-oreslang/oreslang-source.llvm',
  net:'ores-truffle-oreslang/oreslang-source.net',
  wasm:'ores-truffle-oreslang/oreslang-source.wasm',
  cranelift:'ores-truffle-oreslang/oreslang-source.cranelift',
  forge:'ores-truffle-oreslang/oreslang-source.forge'
});
const BACKENDS = new Set(Object.keys(BACKEND_REPOS));
const REQUIRED_STEPS = ['compiler_build', 'guest_compile', 'guest_execute',
  'reject_foreign_access', 'reject_read_loan_write'];
const fail = message => { throw new Error(`compiled actor guest: ${message}`); };
const exact = (value, keys, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    fail(`unexpected shape for ${label}`);
  }
};
const hex = (s, length) => typeof s === 'string' &&
  new RegExp(`^[0-9a-f]{${length}}$`).test(s) && !/^0+$/.test(s);
const id = s => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(s);
const witness = (event, shape) => {
  exact(event, Object.keys(shape), event?.type ?? 'unknown event');
  for (const [key, value] of Object.entries(shape)) {
    if (event[key] !== value) fail(`bad ${event.type}.${key}: expected ${String(value)}`);
  }
};
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function verifyExecutionEvidence(candidate) {
  if (candidate.kind !== 'ACTUAL_COMPILED_ORES_GUEST') fail('host-only or synthetic receipt');
  if (!hex(candidate.sourceCommitSha1, 40) || !hex(candidate.sourceTreeSha1, 40) ||
      !hex(candidate.compilerSha256, 64) || !hex(candidate.artifactSha256, 64)) {
    fail('missing or malformed immutable identity');
  }
  if (candidate.compilerSha256 === candidate.artifactSha256)
    fail('compiler and artifact identities must differ');
  if (!Number.isSafeInteger(candidate.runId) || candidate.runId <= 0 ||
      !Number.isSafeInteger(candidate.jobId) || candidate.jobId <= 0 ||
      !Number.isSafeInteger(candidate.attempt) || candidate.attempt <= 0) {
    fail('invalid run/job/attempt');
  }
  const repo = BACKEND_REPOS[candidate.backend];
  const url = `https://github.com/${repo}/actions/runs/${candidate.runId}/job/${candidate.jobId}`;
  if (candidate.runnerJobUrl !== url)
    fail('runner job URL must match the exact backend source repository');
  if (!Array.isArray(candidate.steps)) fail('missing executed CI steps');
  const numbers = new Set();
  for (const step of candidate.steps) {
    exact(step, ['name', 'number', 'executed', 'conclusion'], 'CI step');
    if (!Number.isSafeInteger(step.number) || step.number <= 0 || numbers.has(step.number))
      fail('invalid or duplicate CI step number');
    numbers.add(step.number);
  }
  for (const name of REQUIRED_STEPS) {
    const matching = candidate.steps.filter(step => step.name === name);
    if (matching.length !== 1 || matching[0].executed !== true || matching[0].conclusion !== 'success')
      fail(`missing successful executed step: ${name}`);
  }
  exact(candidate.negatives, ['foreign-state', 'read-loan-write'], 'negative receipts');
  const negative = (key, sourceSha256, diagnosticClass) => {
    const n = candidate.negatives[key];
    exact(n, ['sourceSha256', 'exitCode', 'diagnosticClass', 'outputArtifacts'], key);
    if (n.sourceSha256 !== sourceSha256 || n.exitCode !== 1 ||
        n.diagnosticClass !== diagnosticClass || n.outputArtifacts !== 0) {
      fail(`missing semantic denial: ${key}`);
    }
  };
  negative('foreign-state', FOREIGN_SHA256, 'FOREIGN_ACTOR_STATE_DENIED');
  negative('read-loan-write', READ_LOAN_SHA256, 'WRITE_WITH_READ_LOAN_DENIED');
}

export function verifyCompiledActorHeap(candidate, sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes) || gitBlob(sourceBytes) !== FIXTURE_BLOB)
    fail('source fixture Git blob drift');
  exact(candidate, ['schemaVersion', 'kind', 'backend', 'sourceGitBlobSha1',
    'sourceCommitSha1', 'sourceTreeSha1', 'compilerSha256', 'artifactSha256',
    'runnerJobUrl', 'runId', 'jobId', 'attempt', 'steps', 'negatives', 'events'], 'receipt');
  if (candidate.schemaVersion !== 2 || !BACKENDS.has(candidate.backend))
    fail('unknown schema/backend');
  if (candidate.sourceGitBlobSha1 !== FIXTURE_BLOB) fail('mismatched source fixture identity');
  verifyExecutionEvidence(candidate);

  if (!Array.isArray(candidate.events) || candidate.events.length !== 23)
    fail('event count must be exactly 23');
  const es = candidate.events;
  const spawn = (event, actor) => {
    exact(event, ['type', 'actor', 'actorId', 'heapId'], 'spawn');
    if (event.type !== 'spawn' || event.actor !== actor || !id(event.actorId) || !id(event.heapId))
      fail('invalid actor spawn/owner identity');
    return event;
  };
  const a = spawn(es[0], 'a'), b = spawn(es[1], 'b');
  if (a.actorId === b.actorId || a.heapId === b.heapId ||
      a.actorId === b.heapId || b.actorId === a.heapId)
    fail('same-kind actors must have distinct owner and heap identities');

  let k = 2;
  const state = (actor, message, value) => {
    const owner = actor === 'a' ? a : b;
    witness(es[k++], {type:'guest-handler-result', actor, actorId:owner.actorId,
      heapId:owner.heapId, message, value});
  };
  state('a', 1, 2); state('b', 5, 10);
  state('a', 2, 8); state('b', 6, 32);
  state('a', 3, 22); state('b', 7, 78);
  state('a', 4, 52);
  witness(es[k++], {type:'foreign-read-denied', requester:b.actorId, owner:a.actorId, reason:'owner-authority'});
  witness(es[k++], {type:'foreign-write-denied', requester:b.actorId, owner:a.actorId, reason:'owner-authority'});
  witness(es[k++], {type:'loan-open', actorId:a.actorId, heapId:a.heapId, loanId:'loan-a', mode:'read'});
  witness(es[k++], {type:'own-write-denied', actorId:a.actorId, heapId:a.heapId, reason:'read-loan-live'});
  state('b', 8, 172);
  witness(es[k++], {type:'stop-requested', actorId:a.actorId, heapId:a.heapId});
  witness(es[k++], {type:'reclaim-deferred', actorId:a.actorId, heapId:a.heapId, reason:'loan-not-quiescent'});
  witness(es[k++], {type:'loan-close', actorId:a.actorId, heapId:a.heapId, loanId:'loan-a'});
  witness(es[k++], {type:'physically-reclaimed', actorId:a.actorId, heapId:a.heapId});
  state('b', 9, 362);
  witness(es[k++], {type:'survivor-read', actorId:b.actorId, heapId:b.heapId, value:362});
  witness(es[k++], {type:'stop-requested', actorId:b.actorId, heapId:b.heapId});
  witness(es[k++], {type:'physically-reclaimed', actorId:b.actorId, heapId:b.heapId});
  witness(es[k++], {type:'guest-exit', code:43});
  if (k !== es.length) fail('unused/replayed events');

  return {
    backend:candidate.backend,
    events:k,
    classification:'CANDIDATE_TRACE_ONLY',
    independentlyAttested:false,
    physicallyQuiescentVerified:false,
    publiclyPromotable:false
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4)
      fail('usage: node tools/verify-compiled-actor-heap.mjs <source.ores> <trace.json>');
    const source = readFileSync(process.argv[2]);
    const raw = readFileSync(process.argv[3]);
    if (raw.length > 32768) fail('trace exceeds 32KiB');
    const result = verifyCompiledActorHeap(JSON.parse(raw.toString('utf8')), source);
    console.log(JSON.stringify(result));
    console.log('NOT VERIFIED: independently authenticate source/compiler/artifact identity, GitHub steps, review and publication admission.');
  } catch (err) {
    console.error(err?.message ?? String(err));
    process.exitCode = 1;
  }
}
