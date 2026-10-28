import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This validates only a candidate trace. It cannot authenticate the compiler,
// executable, runner, or the fact that the events came from compiled guest code.
const FIXTURE_BLOB = '51519bdf9084d7d8457b1e5a39c92a5efe2b63ce';
const BACKENDS = new Set(['java', 'llvm', 'net', 'wasm', 'forge']);
const fail = (message) => { throw new Error(`compiled actor guest: ${message}`); };
const exact = (value, keys, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    fail(`unexpected shape for ${label}`);
  }
};
const hex = (s, length) => typeof s === 'string' &&
  new RegExp(`^[0-9a-f]{${length}}$`).test(s) && !/^0+$/.test(s);
const id = (s) => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(s);
const witness = (event, shape) => {
  exact(event, Object.keys(shape), event?.type ?? 'unknown event');
  for (const [key, value] of Object.entries(shape)) {
    if (event[key] !== value) fail(`bad ${event.type}.${key}: expected ${String(value)}`);
  }
};
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function verifyCompiledActorHeap(candidate, sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes) || gitBlob(sourceBytes) !== FIXTURE_BLOB) fail('source fixture Git blob drift');
  exact(candidate, ['schemaVersion', 'backend', 'sourceGitBlobSha1', 'sourceCommitSha1',
    'compilerSha256', 'artifactSha256', 'runnerJobUrl', 'events'], 'receipt');
  if (candidate.schemaVersion !== 1 || !BACKENDS.has(candidate.backend)) fail('unknown schema/backend');
  if (candidate.sourceGitBlobSha1 !== FIXTURE_BLOB || !hex(candidate.sourceCommitSha1, 40) ||
      !hex(candidate.compilerSha256, 64) || !hex(candidate.artifactSha256, 64)) fail('missing or malformed immutable identity');
  if (candidate.compilerSha256 === candidate.artifactSha256) fail('compiler and artifact identities must differ');
  if (typeof candidate.runnerJobUrl !== 'string' ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/job\/[1-9][0-9]*$/.test(candidate.runnerJobUrl)) {
    fail('runner job link missing or invalid');
  }
  if (!Array.isArray(candidate.events) || candidate.events.length !== 23) fail('event count must be exactly 23');
  const es = candidate.events;
  const spawn = (event, actor) => {
    exact(event, ['type', 'actor', 'actorId', 'heapId'], 'spawn');
    if (event.type !== 'spawn' || event.actor !== actor || !id(event.actorId) || !id(event.heapId)) fail('invalid actor spawn/owner identity');
    return event;
  };
  const a = spawn(es[0], 'a'), b = spawn(es[1], 'b');
  if (a.actorId === b.actorId || a.heapId === b.heapId ||
      a.actorId === b.heapId || b.actorId === a.heapId) fail('same-kind actors must have distinct owner and heap identities');
  let k = 2;
  const state = (actor, message, value) => {
    const owner = actor === 'a' ? a : b;
    witness(es[k++], { type: 'guest-handler-result', actor, actorId: owner.actorId,
      heapId: owner.heapId, message, value });
  };
  state('a', 1, 2); state('b', 5, 10);
  state('a', 2, 8); state('b', 6, 32);
  state('a', 3, 22); state('b', 7, 78);
  state('a', 4, 52); state('b', 8, 172);
  witness(es[k++], { type: 'foreign-read-denied', requester: b.actorId, owner: a.actorId, reason: 'owner-authority' });
  witness(es[k++], { type: 'foreign-write-denied', requester: b.actorId, owner: a.actorId, reason: 'owner-authority' });
  witness(es[k++], { type: 'loan-open', actorId: a.actorId, heapId: a.heapId, loanId: 'loan-a', mode: 'read' });
  witness(es[k++], { type: 'own-write-denied', actorId: a.actorId, heapId: a.heapId, reason: 'read-loan-live' });
  witness(es[k++], { type: 'stop-requested', actorId: a.actorId, heapId: a.heapId });
  witness(es[k++], { type: 'reclaim-deferred', actorId: a.actorId, heapId: a.heapId, reason: 'loan-not-quiescent' });
  state('b', 9, 362); // Progress must continue while A's read loan pins its pages.
  witness(es[k++], { type: 'loan-close', actorId: a.actorId, heapId: a.heapId, loanId: 'loan-a' });
  witness(es[k++], { type: 'physically-reclaimed', actorId: a.actorId, heapId: a.heapId });
  witness(es[k++], { type: 'survivor-read', actorId: b.actorId, heapId: b.heapId, value: 362 });
  witness(es[k++], { type: 'stop-requested', actorId: b.actorId, heapId: b.heapId });
  witness(es[k++], { type: 'physically-reclaimed', actorId: b.actorId, heapId: b.heapId });
  witness(es[k++], { type: 'guest-exit', code: 43 }); // Sentinel only, not state proof.
  if (k !== es.length) fail('unused/replayed events');
  return { backend: candidate.backend, events: k, classification: 'CANDIDATE_TRACE_ONLY' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4) fail('usage: node tools/verify-compiled-actor-heap.mjs <source.ores> <trace.json>');
    const source = readFileSync(process.argv[2]);
    const raw = readFileSync(process.argv[3]);
    if (raw.length > 32768) fail('trace exceeds 32KiB');
    const result = verifyCompiledActorHeap(JSON.parse(raw.toString('utf8')), source);
    console.log(JSON.stringify(result));
    console.log('NOT VERIFIED: independently check compiler/source/binary identity, actual compiled execution, runner steps and publication admission.');
  } catch (err) {
    console.error(err?.message ?? String(err));
    process.exitCode = 1;
  }
}
