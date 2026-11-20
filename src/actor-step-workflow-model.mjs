/**
 * HOST-ONLY MODEL: deterministic workflow admission + atomic candidate transitions.
 * No guest actor, durable database, authenticated transport, or external side effects.
 */
import {createHash} from 'node:crypto';

const check = (ok, code) => { if (!ok) throw new Error(code); };
const nonempty = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 256;
const integer = v => Number.isSafeInteger(v) && v >= 0;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const copy = v => structuredClone(v);
const put = (obj,key,v) => Object.defineProperty(obj,key,{value:v,enumerable:true,writable:true,configurable:true});
const has = (obj,key) => Object.hasOwn(obj,key);
const durableId = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const deepFreeze = v => {
  if (record(v) || Array.isArray(v)) {
    for (const value of Object.values(v)) deepFreeze(value);
    Object.freeze(v);
  }
  return v;
};
const canonical = v => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { check(integer(v), 'NON_CANONICAL_VALUE'); return JSON.stringify(v); }
  if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  check(record(v), 'NON_CANONICAL_VALUE');
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
};
const digest = v => 'sha256:'+createHash('sha256').update(canonical(v)).digest('hex');
const seal = store => { const next=copy(store); delete next.snapshotDigest; next.snapshotDigest=digest(next); return next; };
const strictKeys = (v,keys) => check(record(v) && Object.keys(v).every(k=>keys.includes(k)), 'UNKNOWN_FIELD');

export function admitStepPlan(plan) {
  strictKeys(plan,['start','nodes']);
  check(nonempty(plan.start) && record(plan.nodes), 'BAD_PLAN');
  const entries=Object.entries(plan.nodes);
  check(entries.length>0 && entries.length<=64 && entries.every(([id])=>/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)), 'BAD_PLAN_SIZE');
  const refs=[]; const branchOwners=new Map();
  for(const [id,n] of entries) {
    check(record(n) && nonempty(n.kind), 'BAD_NODE');
    if(n.kind==='task') {
      strictKeys(n,['kind','worker','next','maxAttempts','onError']);
      check(nonempty(n.worker) && integer(n.maxAttempts) && n.maxAttempts>=1 && n.maxAttempts<=5, 'BAD_TASK');
      if(n.next!==null) check(nonempty(n.next), 'BAD_NEXT');
      if(n.onError!==undefined) check(nonempty(n.onError), 'BAD_ERROR_ROUTE');
      if(n.next!==null) refs.push([id,n.next]);
      if(n.onError!==undefined) refs.push([id,n.onError]);
    } else if(n.kind==='parallel') {
      strictKeys(n,['kind','branches','next']);
      check(Array.isArray(n.branches) && n.branches.length>=2 && n.branches.length<=8 &&
        new Set(n.branches).size===n.branches.length && nonempty(n.next), 'BAD_PARALLEL');
      for(const b of n.branches) {check(nonempty(b) && !branchOwners.has(b), 'BAD_BRANCH');branchOwners.set(b,id);refs.push([id,b]);}
      refs.push([id,n.next]);
    } else if(n.kind==='choice') {
      strictKeys(n,['kind','routes','otherwise']);
      check(record(n.routes) && Object.keys(n.routes).length>0 && Object.keys(n.routes).length<=16 && nonempty(n.otherwise), 'BAD_CHOICE');
      for(const [tag,to] of Object.entries(n.routes)) {check(nonempty(tag) && nonempty(to), 'BAD_CHOICE_ROUTE');refs.push([id,to]);}
      refs.push([id,n.otherwise]);
    } else if(n.kind==='wait') {
      strictKeys(n,['kind','signal','authority','next']);
      check(nonempty(n.signal) && nonempty(n.authority) && nonempty(n.next), 'BAD_WAIT');
      refs.push([id,n.next]);
    } else if(n.kind==='succeed'||n.kind==='fail') strictKeys(n,['kind']);
    else throw new Error('UNKNOWN_NODE_KIND');
  }
  check(has(plan.nodes,plan.start), 'BAD_START');
  for(const [from,to] of refs) check(has(plan.nodes,to), 'UNKNOWN_TARGET');
  for(const [branch,owner] of branchOwners) {
    check(plan.nodes[branch].kind==='task' && plan.nodes[branch].next===null &&
      plan.nodes[branch].onError===undefined && plan.start!==branch, 'BAD_BRANCH_TASK');
    check(refs.filter(([,to])=>to===branch).length===1, 'BRANCH_HAS_OTHER_ENTRY');
  }
  check(!branchOwners.has(plan.start), 'BAD_START');
  const visiting=new Set(), visited=new Set();
  const visit=id=>{
    check(!visiting.has(id),'CYCLE_NOT_ADMITTED');
    if(visited.has(id)) return;
    visiting.add(id);
    for(const [,to] of refs.filter(([from])=>from===id)) visit(to);
    visiting.delete(id);visited.add(id);
  };
  visit(plan.start);
  check(visited.size===entries.length,'UNREACHABLE_NODE');
  return deepFreeze(copy(plan));
}

export class ActorStepWorkflowModel {
  #plan;
  #planDigest;
  #db;
  constructor({plan,tenantId,runId,store=null}={}) {
    this.#plan=admitStepPlan(plan);
    this.#planDigest=digest(this.#plan);
    if(store!==null) {
      check(record(store) && store.formatVersion===0 && store.stateSchemaVersion===1 &&
        store.codeGeneration==='actor-step-oracle-v0', 'INCOMPATIBLE_SNAPSHOT');
      const saved=copy(store), savedDigest=saved.snapshotDigest;
      delete saved.snapshotDigest;
      check(typeof savedDigest==='string' && savedDigest===digest(saved), 'CORRUPT_SNAPSHOT');
      check(durableId(tenantId) && durableId(runId) &&
        saved.planDigest===this.#planDigest && saved.tenantId===tenantId &&
        saved.runId===runId && integer(saved.epoch) && integer(saved.version) &&
        record(saved.state) && record(saved.inbox) && record(saved.seen) && record(saved.outbox) &&
        Array.isArray(saved.events), 'INCOMPATIBLE_SNAPSHOT');
      this.#db=seal({...saved,active:false}); // A restored process never owns the old lease.
    } else {
      check(durableId(tenantId) && durableId(runId), 'BAD_RUN_ID');
      this.#db=seal({formatVersion:0,stateSchemaVersion:1,codeGeneration:'actor-step-oracle-v0',
        tenantId,runId,planDigest:this.#planDigest,epoch:0,active:false,version:0,
        state:{status:'CREATED',current:null,pending:{},join:null,attempts:{},lastTag:null},
        inbox:{},seen:{},outbox:{},events:[]});
    }
  }
  snapshot() { return copy(this.#db); }
  #commit(db) {this.#db=seal(db);}
  #checkLease(epoch) {check(this.#db.active && epoch===this.#db.epoch, 'STALE_ACTIVATION_EPOCH');}
  activate() {
    check(!this.#db.active,'ALREADY_ACTIVE');
    check(integer(this.#db.epoch+1),'EPOCH_EXHAUSTED');
    const db=this.snapshot();db.epoch++;db.active=true;this.#commit(db);return db.epoch;
  }
  freeze(epoch) {this.#checkLease(epoch);const db=this.snapshot();db.active=false;this.#commit(db);return this.snapshot();}
  enqueue(message) {
    check(record(message) && nonempty(message.id) && nonempty(message.type), 'BAD_MESSAGE');
    check(message.tenantId===this.#db.tenantId && message.runId===this.#db.runId,'WRONG_RUN');
    check(['start','task_result','signal','cancel'].includes(message.type),'UNKNOWN_MESSAGE_TYPE');
    const allowed={start:[],task_result:['nodeId','key','worker','outcome','tag','receipt'],
      signal:['nodeId','signal','authority'],cancel:['authority']};
    strictKeys(message,['id','type','tenantId','runId',...allowed[message.type]]);
    check(Buffer.byteLength(canonical(message),'utf8')<=4096,'MESSAGE_TOO_LARGE');
    if(message.type==='task_result') {
      check(durableId(message.nodeId) && nonempty(message.key) &&
        nonempty(message.worker) && (message.outcome==='ok'||message.outcome==='error') &&
        nonempty(message.tag) && nonempty(message.receipt), 'BAD_TASK_RESULT');
    } else if(message.type==='signal') {
      check(durableId(message.nodeId) && nonempty(message.signal) &&
        nonempty(message.authority), 'BAD_SIGNAL');
    } else if(message.type==='cancel') {
      check(nonempty(message.authority), 'BAD_CANCEL');
    }
    const db=this.snapshot();
    if(has(db.seen,message.id)) {
      check(db.seen[message.id]===digest(message), 'DELIVERY_CONFLICT');return false;
    }
    if(has(db.inbox,message.id)) {
      check(digest(db.inbox[message.id])===digest(message), 'DELIVERY_CONFLICT');return false;
    }
    // Prevent unbounded growth from valid receipts redelivered under fresh IDs.
    check(Object.keys(db.seen).length<1024,'REPLAY_LEDGER_EXHAUSTED');
    check(Object.keys(db.inbox).length<256,'INBOX_CAPACITY');
    put(db.inbox,message.id,copy(message));this.#commit(db);return true;
  }
  // A pending intent is a request to dispatch a child actor, NOT a delivery receipt.
  #issue(db,id,attempt) {
    const node=this.#plan.nodes[id], key=`${db.tenantId}/${db.runId}/${id}/${attempt}`;
    check(!has(db.outbox,key),'DUPLICATE_INTENT');
    put(db.outbox,key,{kind:'spawn_step_actor',nodeId:id,worker:node.worker,attempt,key,status:'pending'});
    put(db.state.pending,id,{attempt,key});
    put(db.state.attempts,id,attempt);
  }
  #enter(db,id,tag=null) {
    const s=db.state;
    for(let depth=0;depth<=64;depth++) {
      const n=this.#plan.nodes[id];s.current=id;
      if(n.kind==='choice') {id=has(n.routes,tag)?n.routes[tag]:n.otherwise;continue;}
      if(n.kind==='task') {s.status='RUNNING';this.#issue(db,id,1);return;}
      if(n.kind==='parallel') {
        s.status='RUNNING';s.join={nodeId:id,next:n.next,remaining:[...n.branches]};
        for(const branch of n.branches) this.#issue(db,branch,1);
        return;
      }
      if(n.kind==='wait') {s.status='WAITING';return;}
      if(n.kind==='succeed') {s.status='COMPLETED';return;}
      if(n.kind==='fail') {s.status='FAILED';return;}
    }
    throw new Error('ROUTING_BUDGET_EXHAUSTED');
  }
  #cancelOutstanding(db) {
    for(const [id,pending] of Object.entries(db.state.pending)) {
      const key=`${db.tenantId}/${db.runId}/cancel/${id}/${pending.attempt}`;
      if(!has(db.outbox,key)) put(db.outbox,key,{kind:'cancel_step_actor',nodeId:id,
        worker:this.#plan.nodes[id].worker,attempt:pending.attempt,key,status:'pending'});
    }
    db.state.pending={};db.state.join=null;
  }
  apply(epoch,id,{crashBeforeCommit=false}={}) {
    this.#checkLease(epoch);
    check(nonempty(id),'BAD_MESSAGE_ID');
    if(has(this.#db.seen,id)) return false;
    check(has(this.#db.inbox,id),'UNKNOWN_INBOX');
    const db=this.snapshot(),m=db.inbox[id],s=db.state;
    let receiptReplay=false;
    delete db.inbox[id];put(db.seen,id,digest(m));
    if(m.type==='start') {
      check(s.status==='CREATED','ALREADY_STARTED');this.#enter(db,this.#plan.start);
    } else if(m.type==='cancel') {
      check(m.authority==='workflow-owner','UNAUTHORIZED_CANCEL');
      if(!['COMPLETED','FAILED','CANCELLED'].includes(s.status)) {
        this.#cancelOutstanding(db);s.status='CANCELLED';
      }
    } else if(m.type==='signal') {
      check(s.status==='WAITING','NOT_WAITING');
      const node=this.#plan.nodes[s.current];
      check(m.nodeId===s.current && m.signal===node.signal && m.authority===node.authority,
        'UNAUTHORIZED_SIGNAL');
      this.#enter(db,node.next);
    } else if(m.type==='task_result') {
      check(nonempty(m.nodeId) && nonempty(m.key) && nonempty(m.worker) &&
        (m.outcome==='ok'||m.outcome==='error') && nonempty(m.tag), 'BAD_TASK_RESULT');
      check(has(db.outbox,m.key) && db.outbox[m.key].kind==='spawn_step_actor', 'UNKNOWN_TASK_INTENT');
      const intent=db.outbox[m.key];
      check(intent.nodeId===m.nodeId && intent.worker===m.worker, 'FORGED_TASK_RESULT');
      if(intent.status==='acknowledged') {
        check(intent.receipt===m.receipt && intent.outcome===m.outcome &&
          intent.tag===m.tag && nonempty(m.receipt), 'RECEIPT_CONFLICT');
        receiptReplay=true;
      } else {
        check(s.status==='RUNNING' && has(s.pending,m.nodeId) &&
          s.pending[m.nodeId].key===m.key && nonempty(m.receipt), 'STALE_TASK_RESULT');
        intent.status='acknowledged';intent.receipt=m.receipt;
        intent.outcome=m.outcome;intent.tag=m.tag;
        const n=this.#plan.nodes[m.nodeId];
        if(m.outcome==='error' && s.pending[m.nodeId].attempt<n.maxAttempts) {
          const attempt=s.pending[m.nodeId].attempt+1;
          this.#issue(db,m.nodeId,attempt);
        } else {
          delete s.pending[m.nodeId];
          if(m.outcome==='error') {
            if(s.join!==null) {this.#cancelOutstanding(db);s.status='FAILED';}
            else if(n.onError!==undefined) this.#enter(db,n.onError,m.tag);
            else {s.status='FAILED';s.current=m.nodeId;}
          } else if(s.join!==null) {
            s.join.remaining=s.join.remaining.filter(b=>b!==m.nodeId);
            if(s.join.remaining.length===0) {
              const next=s.join.next;s.join=null;this.#enter(db,next,'joined');
            }
          } else {s.lastTag=m.tag;this.#enter(db,n.next,m.tag);}
        }
      }
    } else throw new Error('UNKNOWN_MESSAGE_TYPE');
    if (receiptReplay) {
      // Consume the duplicate inbox delivery without manufacturing a new transition.
      if(crashBeforeCommit) throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
      this.#commit(db);return true;
    }
    check(integer(db.version+1) && db.events.length<512,'WORKFLOW_BUDGET');
    db.version++;
    db.events.push({messageId:id,type:m.type,status:s.status,version:db.version});
    if(crashBeforeCommit) throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
    this.#commit(db);return true;
  }
}
