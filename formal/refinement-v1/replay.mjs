// Design-trace replay interface: NEVER proof of real AttoLang compiler execution.
// A valid trace may be invented. Authenticate source, toolchain, workflow, job
// attempt, steps, and guest artifact separately before claiming refinement.
const IDENT = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
const OP_FIELDS = Object.freeze({
  critical_enter: ['actor','gen','task','mode'],
  critical_exit: ['actor','gen','task'],
  suspend: ['actor','gen','task'],
  resume: ['actor','gen','task'],
  retire: ['actor','gen'],
  restart: ['actor','gen'],
  stale_permit_denied: ['actor','gen','permitGen','task'],
  panic: ['actor','gen'],
  control_notice: ['actor','gen'],
  deliver_data: ['actor','gen'],
  join: ['sub','gen'],
  leave: ['sub','gen'],
  publish_request: ['sub','gen','publisher','sequence'],
  publish_pending: ['sub','gen','publisher','sequence'],
  publish_admit: ['sub','gen','publisher','sequence'],
  ack: ['sub','gen','publisher','sequence'],
  cancel_pending: ['sub','gen','publisher','sequence'],
  deliver: ['sub','gen','publisher','sequence'],
  discard_queued: ['sub','gen','publisher','sequence','reason'],
  close_group: []
});
const POSITIVE = n => Number.isSafeInteger(n) && n > 0;
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
function require(ok, reason) { if (!ok) throw Error('FORMAL_REFINEMENT_REJECTED: ' + reason); }
function exactDataProperties(value, fields, reason) {
  require(object(value), reason);
  const own = Reflect.ownKeys(value);
  require(own.length === fields.length && fields.every(k => own.includes(k) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value,k), 'value')),
    reason);
}
function checkShape(e) {
  require(object(e), 'event must be plain object');
  require(typeof e.op === 'string' && Object.hasOwn(OP_FIELDS,e.op), 'unknown operation');
  exactDataProperties(e, ['op', ...OP_FIELDS[e.op]], 'missing, extra or accessor event fields');
  for (const k of ['actor','task','sub','publisher']) {
    if (Object.hasOwn(e,k)) require(typeof e[k] === 'string' && IDENT.test(e[k]), 'invalid '+k);
  }
  for (const k of ['gen','permitGen','sequence']) {
    if (Object.hasOwn(e,k)) require(POSITIVE(e[k]) && e[k] <= 4096, 'invalid '+k);
  }
  if (e.op === 'critical_enter') require(e.mode === 'read' || e.mode === 'write', 'invalid mode');
  if (e.op === 'discard_queued') require(e.reason === 'leave' || e.reason === 'close', 'invalid discard reason');
}
export function replayDesignTrace(envelope) {
  exactDataProperties(envelope,['schema','scenario','events'],'invalid trace envelope fields');
  require(envelope.schema === 'attolang.formal.actor-trace.v1' &&
    ['critical-generation', 'panic-control', 'reliable-pubsub'].includes(envelope.scenario) &&
    Array.isArray(envelope.events) && envelope.events.length >= 2 && envelope.events.length <= 128,
    'invalid bounded trace envelope');
  const actor = {id:null,generation:1,alive:true,held:new Map(),suspended:new Set(),
    tasks:new Set(),permitsIssued:new Map(),panic:false,notice:false};
  const sub = {id:null,generation:0,joined:false,closed:false,queue:[],requested:new Set(),
    pending:new Set(),cancelled:new Set(),acked:new Set(),delivered:new Map(),
    admittedSequence:new Map(),nextIssued:new Map(),publishers:new Set(),
    nextRequiredTerminal:null};
  const seen = new Set(), witnessed = new Set();
  for (const e of envelope.events) {
    checkShape(e);
    require(!seen.has(e), 'event reference reused');
    seen.add(e);
    if (envelope.scenario === 'reliable-pubsub') {
      require(['join','leave','publish_request','publish_pending','publish_admit','ack',
        'cancel_pending','deliver','discard_queued','close_group'].includes(e.op), 'cross-scenario operation');
      if (sub.nextRequiredTerminal) require(e.op === sub.nextRequiredTerminal,
        'discard must immediately precede its claimed leave or close');
      if (e.op !== 'close_group') {
        require(sub.id === null || sub.id === e.sub, 'cross-subscription event');
        sub.id = e.sub;
      }
      if (e.op === 'join') {
        require(!sub.closed && !sub.joined && e.gen === sub.generation + 1 && e.gen <= 2, 'join or generation');
        require(sub.requested.size === 0 && sub.pending.size === 0 && sub.queue.length === 0,
          'rejoin before outstanding work resolved');
        sub.generation = e.gen; sub.joined = true;
      } else if (e.op === 'leave') {
        require(sub.joined && e.gen === sub.generation, 'invalid leave');
        require(sub.requested.size === 0 && sub.pending.size === 0 && sub.queue.length === 0,
          'leave with unaccounted reliable publication');
        sub.joined = false; sub.nextRequiredTerminal = null;
      } else if (e.op === 'close_group') {
        require(!sub.closed && sub.requested.size === 0 && sub.pending.size === 0 &&
          sub.queue.length === 0, 'group closed with unaccounted reliable publication');
        sub.closed = true; sub.joined = false; sub.nextRequiredTerminal = null;
      } else {
        require(sub.joined && !sub.closed && e.gen === sub.generation, 'stale or closed publication');
        require(e.sequence <= 2, 'pubsub model sequence bound');
        const id = [e.gen,e.publisher,e.sequence].join(':');
        const edge = e.gen + ':' + e.publisher;
        if (e.op === 'publish_request') {
          sub.publishers.add(e.publisher);
          require(sub.publishers.size <= 2 && e.sequence === (sub.nextIssued.get(edge) || 0) + 1,
            'publisher bound or non-contiguous publish request');
          require(![...sub.requested].some(x => x.startsWith(edge+':')),
            'overlapping publisher requests on an edge');
          require(!sub.cancelled.has(id) && !sub.acked.has(id), 'duplicate publication identity');
          sub.requested.add(id);
          sub.nextIssued.set(edge,e.sequence);
        } else if (e.op === 'publish_pending') {
          require(sub.requested.has(id) && sub.queue.length === 1 && !sub.pending.has(id) &&
            !sub.cancelled.has(id) && !sub.acked.has(id), 'pending without request and backpressure');
          sub.pending.add(id);
        } else if (e.op === 'publish_admit') {
          require(sub.requested.has(id) && sub.queue.length < 1 &&
            !sub.cancelled.has(id) && !sub.acked.has(id), 'admission without request, after cancel or at capacity');
          require(e.sequence > (sub.admittedSequence.get(edge) || 0), 'publisher-edge admission FIFO');
          sub.pending.delete(id);
          require(!sub.queue.some(x=>x.id===id), 'duplicate admission');
          sub.admittedSequence.set(edge,e.sequence);
          sub.queue.push({id,publisher:e.publisher,sequence:e.sequence,gen:e.gen});
        } else if (e.op === 'cancel_pending') {
          require(sub.requested.has(id) && sub.pending.has(id) && !sub.acked.has(id),
            'cancel without pending or after ack');
          sub.pending.delete(id); sub.requested.delete(id); sub.cancelled.add(id);
        } else if (e.op === 'ack') {
          require(sub.queue.some(x=>x.id === id) && sub.requested.has(id) &&
            !sub.acked.has(id) && !sub.cancelled.has(id), 'early, duplicate or cancelled ACK');
          sub.acked.add(id);
        } else if (e.op === 'deliver') {
          require(sub.queue.length > 0 && sub.queue[0].id === id &&
            sub.requested.has(id) && sub.acked.has(id), 'stale, unordered or unacked delivery');
          require(e.sequence > (sub.delivered.get(edge) || 0), 'publisher-edge FIFO');
          sub.delivered.set(edge,e.sequence);
          sub.queue.shift(); sub.requested.delete(id);
        } else if (e.op === 'discard_queued') {
          require(sub.queue.length > 0 && sub.queue[0].id === id &&
            sub.requested.has(id) && sub.acked.has(id),
            'discard requires acknowledged queued publication');
          sub.queue.shift(); sub.requested.delete(id);
          sub.nextRequiredTerminal = e.reason === 'leave' ? 'leave' : 'close_group';
        }
      }
    } else {
      require(['critical_enter','critical_exit','suspend','resume','retire','restart',
        'stale_permit_denied','panic','control_notice','deliver_data'].includes(e.op),
        'cross-scenario operation');
      require(actor.id === null || actor.id === e.actor, 'cross-actor event');
      actor.id = e.actor;
      require(e.gen === actor.generation, 'actor generation mismatch');
      if (envelope.scenario === 'critical-generation') {
        require(!['panic','control_notice','deliver_data'].includes(e.op), 'CONTROL operation in critical trace');
        if (Object.hasOwn(e,'task')) {
          actor.tasks.add(e.task);
          require(actor.tasks.size <= 2, 'critical task bound exceeded');
        }
        if (e.op === 'critical_enter') {
          require(actor.alive && !actor.held.has(e.task) && !actor.suspended.has(e.task),
            'enter without live, eligible actor task');
          require(e.mode !== 'write' ? ![...actor.held.values()].includes('write') : actor.held.size === 0,
            'overlapping critical permits');
          actor.held.set(e.task,e.mode);
          if (!actor.permitsIssued.has(e.task)) actor.permitsIssued.set(e.task,new Set());
          actor.permitsIssued.get(e.task).add(e.gen);
        } else if (e.op === 'critical_exit') {
          require(actor.alive && actor.held.has(e.task), 'unowned critical exit');
          actor.held.delete(e.task);
        } else if (e.op === 'suspend') {
          require(actor.alive && !actor.held.has(e.task) && !actor.suspended.has(e.task),
            'suspension under critical permit or duplicate suspend');
          actor.suspended.add(e.task);
        } else if (e.op === 'resume') {
          require(actor.alive && actor.suspended.has(e.task), 'resume without matching suspend');
          actor.suspended.delete(e.task);
        } else if (e.op === 'retire') {
          require(actor.alive && actor.held.size === 0 && actor.suspended.size === 0,
            'retire with outstanding critical permits or suspended tasks');
          actor.alive=false;
        } else if (e.op === 'restart') {
          require(!actor.alive && actor.generation < 2, 'invalid actor restart');
          actor.generation++; actor.alive=true;
        } else if (e.op === 'stale_permit_denied') {
          require(actor.alive && !actor.held.has(e.task) &&
            actor.permitsIssued.get(e.task)?.has(e.permitGen) && e.permitGen < e.gen,
            'stale denial lacks an actually issued old-generation permit');
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
    witnessed.add(e.op);
  }
  const coverage = envelope.scenario === 'critical-generation' ?
    ['critical_enter','critical_exit','suspend','resume','retire','restart','stale_permit_denied'] :
    envelope.scenario === 'panic-control' ? ['panic','control_notice'] :
    ['join','publish_request','publish_admit','ack','deliver','leave','close_group'];
  require(coverage.every(op=>witnessed.has(op)), 'vacuous scenario lacks required lifecycle witnesses');
  if (envelope.scenario === 'critical-generation')
    require(actor.held.size === 0 && actor.suspended.size === 0, 'unterminated actor tasks');
  if (envelope.scenario === 'panic-control')
    require(actor.panic && actor.notice, 'missing supervisor CONTROL notice');
  if (envelope.scenario === 'reliable-pubsub')
    require(sub.closed && sub.requested.size === 0 && sub.pending.size === 0 &&
      sub.queue.length === 0, 'unterminated reliable publication or open group');
  return {classification:'DESIGN_TRACE_SHAPE_ONLY', traceShapeValid:true,
    compiledGuestAuthenticated:false, runtimeAuthenticated:false,
    fiveBackendParity:false, mergerReady:false, eventCount:envelope.events.length};
}
