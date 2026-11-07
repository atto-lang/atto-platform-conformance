// Design-trace replay interface: NEVER proof of real AttoLang compiler execution.
// A valid trace may be invented. Authenticate source, toolchain, workflow, job
// attempt, steps, and guest artifact separately before claiming refinement.
const IDENT = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const OP_FIELDS = Object.freeze({
  critical_enter: ['actor','gen','task','mode'],
  critical_exit: ['actor','gen','task'],
  suspend: ['actor','gen','task'],
  retire: ['actor','gen'],
  restart: ['actor','gen'],
  stale_permit_denied: ['actor','gen','permitGen','task'],
  panic: ['actor','gen'],
  control_notice: ['actor','gen'],
  deliver_data: ['actor','gen'],
  join: ['sub','gen'],
  leave: ['sub','gen'],
  publish_pending: ['sub','gen','publisher','sequence'],
  publish_admit: ['sub','gen','publisher','sequence'],
  ack: ['sub','gen','publisher','sequence'],
  cancel_pending: ['sub','gen','publisher','sequence'],
  deliver: ['sub','gen','publisher','sequence'],
  close_group: []
});
const POSITIVE = n => Number.isSafeInteger(n) && n > 0;
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
function require(ok, reason) { if (!ok) throw Error('FORMAL_REFINEMENT_REJECTED: ' + reason); }
function checkShape(e) {
  require(object(e), 'event must be plain object');
  require(typeof e.op === 'string' && Object.hasOwn(OP_FIELDS,e.op), 'unknown operation');
  const keys = ['op', ...OP_FIELDS[e.op]];
  require(Reflect.ownKeys(e).length === keys.length &&
    keys.every(k => Object.hasOwn(e,k) && Object.getOwnPropertyDescriptor(e,k)?.value !== undefined),
    'missing or extra event fields');
  for (const k of ['actor','task','sub','publisher']) {
    if (Object.hasOwn(e,k)) require(typeof e[k] === 'string' && IDENT.test(e[k]), 'invalid '+k);
  }
  for (const k of ['gen','permitGen','sequence']) {
    if (Object.hasOwn(e,k)) require(POSITIVE(e[k]) && e[k] <= 4096, 'invalid '+k);
  }
  if (e.op === 'critical_enter') require(e.mode === 'read' || e.mode === 'write', 'invalid mode');
}
export function replayDesignTrace(envelope) {
  require(object(envelope) && Reflect.ownKeys(envelope).length === 3 &&
    envelope.schema === 'attolang.formal.actor-trace.v1' &&
    typeof envelope.scenario === 'string' &&
    ['critical-generation', 'panic-control', 'reliable-pubsub'].includes(envelope.scenario) &&
    Array.isArray(envelope.events) && envelope.events.length >= 2 && envelope.events.length <= 128,
    'invalid bounded trace envelope');
  const actor = {id:null,generation:1,alive:true,held:new Map(),panic:false,notice:false};
  const sub = {id:null,generation:0,joined:false,closed:false,queue:[],pending:new Set(),cancelled:new Set(),acked:new Set(),delivered:new Map(),admittedSequence:new Map()};
  const seen = new Set();
  for (const e of envelope.events) {
    checkShape(e);
    require(!seen.has(e), 'event reference reused');
    seen.add(e);
    if (envelope.scenario === 'reliable-pubsub') {
      require(['join','leave','publish_pending','publish_admit','ack','cancel_pending','deliver','close_group'].includes(e.op), 'cross-scenario operation');
      if (e.op !== 'close_group') {
        require(sub.id === null || sub.id === e.sub, 'cross-subscription event');
        sub.id = e.sub;
      }
      if (e.op === 'join') {
        require(!sub.closed && !sub.joined && e.gen === sub.generation + 1 && e.gen <= 2, 'join or generation');
        require(sub.pending.size === 0 && sub.queue.length === 0, 'rejoin before drain');
        sub.generation = e.gen; sub.joined = true;
      } else if (e.op === 'leave') {
        require(sub.joined && e.gen === sub.generation, 'invalid leave');
        require(sub.pending.size === 0, 'uncancelled backpressure at leave');
        sub.queue.length = 0; sub.joined = false;
      } else if (e.op === 'close_group') {
        require(!sub.closed, 'duplicate close');
        require(sub.pending.size === 0, 'pending publication at close');
        sub.closed = true; sub.joined = false; sub.queue.length=0;
      } else {
        require(sub.joined && !sub.closed && e.gen === sub.generation, 'stale or closed publication');
        const id = [e.gen,e.publisher,e.sequence].join(':');
        if (e.op === 'publish_pending') {
          require(sub.queue.length === 1 && !sub.pending.has(id) && !sub.cancelled.has(id) && !sub.acked.has(id), 'pending without backpressure');
          sub.pending.add(id);
        } else if (e.op === 'publish_admit') {
          require(sub.queue.length < 1 && !sub.cancelled.has(id) && !sub.acked.has(id), 'admission after cancel or at capacity');
          const edge = e.gen + ':' + e.publisher;
          require(e.sequence > (sub.admittedSequence.get(edge) || 0), 'publisher-edge admission FIFO');
          sub.pending.delete(id);
          require(!sub.queue.some(x=>x.id===id), 'duplicate admission');
          sub.admittedSequence.set(edge,e.sequence);
          sub.queue.push({id,publisher:e.publisher,sequence:e.sequence,gen:e.gen});
        } else if (e.op === 'cancel_pending') {
          require(sub.pending.has(id) && !sub.acked.has(id), 'cancel without pending or after ack');
          sub.pending.delete(id); sub.cancelled.add(id);
        } else if (e.op === 'ack') {
          require(sub.queue.some(x=>x.id === id) && !sub.acked.has(id) && !sub.cancelled.has(id), 'early, duplicate or cancelled ACK');
          sub.acked.add(id);
        } else if (e.op === 'deliver') {
          require(sub.queue.length > 0 && sub.queue[0].id === id && sub.acked.has(id), 'stale, unordered or unacked delivery');
          const edge = e.gen + ':' + e.publisher;
          require(e.sequence > (sub.delivered.get(edge) || 0), 'publisher-edge FIFO');
          sub.delivered.set(edge,e.sequence);
          sub.queue.shift();
        }
      }
    } else {
      require(['critical_enter','critical_exit','suspend','retire','restart','stale_permit_denied','panic','control_notice','deliver_data'].includes(e.op), 'cross-scenario operation');
      require(actor.id === null || actor.id === e.actor, 'cross-actor event');
      actor.id = e.actor;
      require(e.gen === actor.generation, 'actor generation mismatch');
      if (envelope.scenario === 'critical-generation') {
        require(!['panic','control_notice','deliver_data'].includes(e.op), 'CONTROL operation in critical trace');
        if (e.op === 'critical_enter') {
          require(actor.alive && !actor.held.has(e.task), 'enter without live actor or double loan');
          require(e.mode !== 'write' ? ![...actor.held.values()].includes('write') : actor.held.size === 0, 'overlapping critical permits');
          actor.held.set(e.task,e.mode);
        } else if (e.op === 'critical_exit') {
          require(actor.alive && actor.held.has(e.task), 'unowned critical exit');
          actor.held.delete(e.task);
        } else if (e.op === 'suspend') {
          require(actor.alive && !actor.held.has(e.task), 'suspension under critical permit');
        } else if (e.op === 'retire') {
          require(actor.alive && actor.held.size === 0, 'retire with outstanding permits');
          actor.alive=false;
        } else if (e.op === 'restart') {
          require(!actor.alive && actor.generation < 2, 'invalid actor restart');
          actor.generation++; actor.alive=true;
        } else if (e.op === 'stale_permit_denied') {
          require(actor.alive && e.permitGen < e.gen, 'stale denial lacks old-generation permit');
        }
      } else {
        require(['panic','control_notice','deliver_data'].includes(e.op), 'unexpected critical event in CONTROL trace');
        if (e.op === 'panic') {
          require(actor.alive && !actor.panic, 'duplicate or dead panic');
          actor.panic=true; actor.alive=false;
        } else if (e.op === 'control_notice') {
          require(actor.panic && !actor.notice, 'notice without panic or duplicate');
          actor.notice=true;
        } else if (e.op === 'deliver_data') {
          require(actor.alive && !actor.panic, 'data delivery after panic/CONTROL');
        }
      }
    }
  }
  if (envelope.scenario === 'panic-control') require(actor.panic && actor.notice, 'missing supervisor CONTROL notice');
  if (envelope.scenario === 'reliable-pubsub') require(sub.pending.size === 0, 'unterminated pending publication');
  return {classification:'DESIGN_TRACE_SHAPE_ONLY', traceShapeValid:true,
    compiledGuestAuthenticated:false, runtimeAuthenticated:false,
    fiveBackendParity:false, mergerReady:false, eventCount:envelope.events.length};
}
