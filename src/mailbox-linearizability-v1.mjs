/**
 * MAILBOX_LINEARIZABILITY_V1: bounded, source-free linearizability oracle.
 * No Oreslang guest executes in this module. No real-time/liveness guarantee.
 */
const OPS = new Set(['send', 'receive', 'cancel', 'settle', 'close', 'probe']);
const TICKET_OPS = new Set(['send', 'cancel', 'settle']);
const MAX_OPS = 10;
const MAX_STATES = 200_000;
const MAX_TIME = 10_000;
const fail = message => { throw new Error('INVALID_MAILBOX_HISTORY: ' + message); };
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null) &&
  Object.getOwnPropertySymbols(x).length === 0;
const exactKeys = (obj, allowed) => {
  if (!plain(obj) || Object.keys(obj).some(k => !allowed.includes(k)) ||
      Reflect.ownKeys(obj).some(k => typeof k === 'symbol')) fail('unexpected fields');
};
const int = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_TIME;
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(x);

export function validateMailboxHistory(input) {
  exactKeys(input, ['schema', 'capacity', 'events']);
  if (input.schema !== 'oreslang.mailbox_linearizability.v1') fail('schema');
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 4)
    fail('bounded queue capacity 1..4 required');
  if (!Array.isArray(input.events) || !input.events.length || input.events.length > MAX_OPS)
    fail('event count must be 1..10');
  const labels = new Set(), time = new Set();
  const sends = new Set();
  for (const e of input.events) {
    exactKeys(e, ['id', 'op', 'ticket', 'invoke', 'complete', 'result']);
    if (!id(e.id) || labels.has(e.id)) fail('duplicate or malformed operation ID');
    labels.add(e.id);
    if (!OPS.has(e.op)) fail('unknown operation');
    if (TICKET_OPS.has(e.op)) {
      if (!id(e.ticket)) fail('missing/invalid ticket');
    } else if (Object.hasOwn(e, 'ticket')) fail('unexpected ticket');
    if (e.op === 'send') {
      if (sends.has(e.ticket)) fail('duplicate send ticket');
      sends.add(e.ticket);
    }
    if (!int(e.invoke) || !int(e.complete) || e.invoke >= e.complete ||
      time.has(e.invoke) || time.has(e.complete)) fail('invalid/ambiguous event timestamps');
    time.add(e.invoke);time.add(e.complete);
    if (typeof e.result !== 'string' || !(/^[A-Z][A-Z_0-9]{0,79}$/.test(e.result) || (e.op === 'receive' && /^MESSAGE:[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(e.result))))
      fail('invalid response shape');
  }
  return input;
}

const initial = () => ({open: true, queue: [], inflight: [], states: Object.create(null)});
const clone = s => ({open:s.open, queue:[...s.queue],
  inflight:[...s.inflight], states:{...s.states}});

// Reference transition: every call has one atomic linearization point.
export function referenceTransition(state, event, capacity) {
  const s = clone(state);
  const ticket = event.ticket;
  let result;
  switch (event.op) {
    case 'send':
      if (!s.open) result = 'CLOSED';
      else if (s.queue.length >= capacity) result = 'FULL';
      else {s.queue.push(ticket);s.states[ticket]='queued';result='ACCEPTED';}
      break;
    case 'receive':
      if (s.queue.length) {
        const t = s.queue.shift();
        s.inflight.push(t);s.states[t]='inflight';result='MESSAGE:' + t;
      } else result = s.open ? 'EMPTY' : 'CLOSED';
      break;
    case 'cancel':
      if (s.states[ticket] === 'queued') {
        s.queue.splice(s.queue.indexOf(ticket),1);
        s.states[ticket]='cancelled';result='CANCELLED';
      } else if (s.states[ticket] === 'cancelled') result='ALREADY_CANCELLED';
      else if (s.states[ticket] === 'inflight' || s.states[ticket] === 'settled') result='TOO_LATE';
      else result='UNKNOWN';
      break;
    case 'settle':
      if (s.states[ticket] === 'inflight') {
        s.inflight.splice(s.inflight.indexOf(ticket),1);
        s.states[ticket]='settled';result='SETTLED';
      } else result='INVALID';
      break;
    case 'close':
      result = s.open ? 'CLOSED' : 'ALREADY_CLOSED';
      if (s.open) {
        s.open = false;
        for (const t of s.queue) s.states[t]='cancelled';
        s.queue=[];
      }
      break;
    case 'probe':
      // Only a mailbox-local observation; NOT actor/task physical quiescence.
      result = (!s.open || s.queue.length || s.inflight.length) ? 'BUSY' : 'IDLE_OPEN';
      // Closed and empty has a distinct status to avoid treating IDLE_OPEN as Done.
      if (!s.open && !s.queue.length && !s.inflight.length) result='MAILBOX_DRAINED';
      break;
    default: fail('unknown operation');
  }
  return {state:s,result};
}

export function checkMailboxLinearizability(input, {maxStates=MAX_STATES}={}) {
  validateMailboxHistory(input);
  if (!Number.isSafeInteger(maxStates) || maxStates < 1 || maxStates > MAX_STATES)
    fail('state budget');
  const events=input.events;
  const n=events.length, predecessors=Array(n).fill(0);
  for (let j=0;j<n;j++) for(let i=0;i<n;i++) {
    if(i!==j && events[i].complete < events[j].invoke)
      predecessors[j] |= (1<<i);
  }
  let explored=0, exhausted=false;
  const seen=new Set();
  const full=(1<<n)-1;
  function dfs(mask,state,witness){
    if(mask===full) return witness;
    const key=mask + '|' + JSON.stringify(state);
    if(seen.has(key))return null;
    if(++explored>maxStates){exhausted=true;return null;}
    seen.add(key);
    for(let i=0;i<n;i++) {
      const bit=1<<i;
      if(mask&bit || (mask&predecessors[i])!==predecessors[i])continue;
      const next=referenceTransition(state,events[i],input.capacity);
      if(next.result!==events[i].result)continue;
      const solution=dfs(mask|bit,next.state,[...witness,events[i].id]);
      if(solution)return solution;
      if(exhausted)return null;
    }
    return null;
  }
  const witness=dfs(0,initial(),[]);
  const classification='BOUNDED_SOURCE_FREE_ORACLE_ONLY';
  if(witness) return {status:'LINEARIZABLE',classification,witness,explored,
    compiledGuestExecuted:false,nativeParityCertified:false};
  return {status:exhausted?'INCONCLUSIVE':'NOT_LINEARIZABLE',classification,
    witness:null,explored,compiledGuestExecuted:false,nativeParityCertified:false};
}
