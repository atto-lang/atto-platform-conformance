// Executable trace-level safety oracle for host supervisor integration tests.
// This checks an observed sequence against the SupervisorLifecycle.tla action
// contract. It is NOT a proof that a runtime emitted a complete or honest trace.
import { readFileSync } from 'node:fs';

function requireField(ok, message) {
  if (!ok) throw new Error('SUPERVISOR_TRACE_REJECT: ' + message);
}
function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256; }
function pos(value) { return Number.isSafeInteger(value) && value > 0; }
function sha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }

export function verifySupervisorTrace(doc) {
  requireField(doc && typeof doc === 'object' && !Array.isArray(doc), 'invalid document');
  requireField(doc.schemaVersion === 1, 'unknown schema version');
  requireField(['java', 'llvm'].includes(doc.backend), 'invalid backend');
  requireField(sha(doc.sourceSha), 'source commit SHA is required');
  requireField(Array.isArray(doc.events) && doc.events.length > 0, 'missing events');
  const children = new Map(), supervisors = new Map(), usedActors = new Set();
  let invocations = 0, acknowledgments = 0, commits = 0;
  const getSupervisor = s => {
    if (!supervisors.has(s)) supervisors.set(s, {closed:false, control:null, nextTurn:0});
    return supervisors.get(s);
  };
  function childFor(e) {
    requireField(id(e.child), 'missing child');
    const c = children.get(e.child);
    requireField(c !== undefined, 'unknown child ' + e.child);
    requireField(e.supervisor === c.supervisor, 'foreign supervisor');
    requireField(e.generation === c.generation, 'stale or forged generation');
    return c;
  }
  function owner(c, e) {
    const s = getSupervisor(c.supervisor);
    requireField(!s.closed && s.control === e.child && e.turn === c.turn && pos(e.turn),
      'wrong, stale, or closed CONTROL turn');
    return s;
  }
  for (let i = 0; i < doc.events.length; i++) {
    const e = doc.events[i];
    requireField(e && typeof e === 'object' && !Array.isArray(e), 'invalid event');
    requireField(e.seq === i + 1, 'non-contiguous or replayed event sequence');
    requireField(typeof e.op === 'string', 'missing operation');
    if (e.op === 'register') {
      requireField(id(e.child) && id(e.supervisor) && id(e.actor), 'invalid registration');
      requireField(e.generation === 1 && !children.has(e.child), 'duplicate child or invalid initial generation');
      requireField(!usedActors.has(e.actor), 'physical ActorId ABA reuse');
      const s = getSupervisor(e.supervisor);
      requireField(!s.closed, 'register under closed supervisor');
      usedActors.add(e.actor);
      children.set(e.child, {supervisor:e.supervisor, actor:e.actor, generation:1,
        phase:'Active', cleaned:false, receipt:'None', calls:0, proof:false,
        applied:false, turn:0, lease:0});
      continue;
    }
    if (e.op === 'supervisor.close') {
      requireField(id(e.supervisor) && supervisors.has(e.supervisor), 'unknown supervisor close');
      const s = getSupervisor(e.supervisor);
      requireField(!s.closed, 'duplicate close');
      s.closed = true;
      s.control = null;
      continue;
    }
    const c = childFor(e), s = getSupervisor(c.supervisor);
    switch (e.op) {
      case 'cleanup':
        requireField(c.phase === 'Active' && !c.cleaned, 'cleanup outside active incarnation');
        c.cleaned = true; break;
      case 'finalize':
        requireField(c.phase === 'Active' && c.cleaned, 'finalization before cleanup');
        c.phase = 'Finalized'; break;
      case 'control.acquire':
        requireField(c.phase === 'Finalized' && !s.closed && s.control === null,
          'CONTROL not serial or not finalized');
        requireField(pos(e.turn) && e.turn === s.nextTurn + 1, 'non-monotonic CONTROL turn');
        s.control = e.child; s.nextTurn = e.turn; c.turn = e.turn; break;
      case 'stop.reserve':
        owner(c,e);
        requireField(c.phase === 'Finalized' && c.receipt === 'None', 'STOP/RESTART reservation overlap');
        c.phase = 'Stopping'; c.receipt = 'Pending'; c.lease = c.generation; break;
      case 'restart.reserve':
        owner(c,e);
        requireField(c.phase === 'Finalized' && c.receipt === 'None', 'STOP/RESTART reservation overlap');
        c.phase = 'Restarting'; c.lease = c.generation; break;
      case 'restart.abort':
        requireField(c.phase === 'Restarting' && c.lease === c.generation, 'invalid restart abort');
        requireField(e.turn === c.turn, 'stale restart abort turn');
        c.phase = 'Finalized'; c.lease = 0; break;
      case 'restart.commit':
        owner(c,e);
        requireField(c.phase === 'Restarting' && c.lease === c.generation,
          'replacement outside admitted reservation');
        requireField(id(e.newActor) && !usedActors.has(e.newActor), 'physical ActorId ABA reuse');
        requireField(pos(e.newGeneration) && e.newGeneration === c.generation + 1,
          'non-monotonic incarnation');
        usedActors.add(e.newActor);
        c.actor = e.newActor; c.generation = e.newGeneration; c.phase = 'Active';
        c.cleaned = false; c.lease = 0; c.receipt = 'None'; c.calls = 0;
        c.proof = false; c.applied = false; c.turn = 0; s.control = null; commits++; break;
      case 'stop.invoke':
        owner(c,e);
        requireField(c.phase === 'Stopping' && c.receipt === 'Pending' &&
          c.lease === c.generation && c.calls === 0, 'duplicate or unreserved host STOP effect');
        c.calls = 1; invocations++; break;
      case 'stop.applied':
        owner(c,e);
        requireField(c.phase === 'Stopping' && c.receipt === 'Pending' && c.calls === 1,
          'invalid applied receipt');
        c.receipt = 'Applied'; c.applied = true; break;
      case 'stop.uncertain':
        requireField(c.phase === 'Stopping' && c.receipt === 'Pending' &&
          c.calls === 1 && e.turn === c.turn, 'invalid uncertain receipt');
        c.receipt = 'Uncertain'; break;
      case 'stop.proof':
        requireField(c.phase === 'Stopping' && ['Pending','Uncertain'].includes(c.receipt) &&
          c.calls === 1 && !c.proof && e.turn === c.turn && id(e.evidenceId),
          'invalid or wrong-turn independent proof');
        // A trusted external verifier MUST vouch for evidenceId; this parser cannot do so.
        c.proof = true; break;
      case 'stop.ack':
        requireField(c.phase === 'Stopping' && c.lease === c.generation &&
          c.calls === 1 && e.turn === c.turn, 'unreserved or replayed STOP acknowledgment');
        if (c.receipt === 'Applied') {
          owner(c,e);
          requireField(c.applied, 'missing applied receipt');
        } else {
          requireField(['Pending','Uncertain'].includes(c.receipt) && c.proof,
            'unverified ambiguous STOP acknowledgment');
        }
        c.receipt = 'Ack'; c.phase = 'Stopped'; acknowledgments++;
        if (s.control === e.child) s.control = null;
        break;
      default:
        throw new Error('SUPERVISOR_TRACE_REJECT: unknown action ' + e.op);
    }
  }
  return Object.freeze({ok:true, backend:doc.backend, sourceSha:doc.sourceSha,
    events:doc.events.length, children:children.size, invocations,
    acknowledgments, restartCommits:commits});
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    requireField(process.argv.length === 3, 'usage: node bin/verify-supervisor-trace.mjs <trace.json>');
    const result = verifySupervisorTrace(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write('SUPERVISOR_TRACE_CONTRACT_PASS ' + JSON.stringify(result) + '\n');
  } catch (e) {
    process.stderr.write(String(e.message) + '\n');
    process.exitCode = 1;
  }
}
