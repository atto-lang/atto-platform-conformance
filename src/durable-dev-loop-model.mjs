/**
 * HOST-ONLY DETERMINISTIC MODEL. Not Oreslang actor runtime, SQL, or production exactly-once delivery.
 * Simulates durable inbox/state/outbox atomicity, fencing, freeze/rehydration, and dev-loop routing.
 */
const copy = value => structuredClone(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
// Define dictionary entries as own data properties, never __proto__ setters.
const put = (object, key, value) => Object.defineProperty(object, key, {
  configurable:true, enumerable:true, writable:true, value
});
const assert = (condition, code) => { if (!condition) throw new Error(code); };

export class DurableDevLoopModel {
  constructor({tenantId='tenant-a', runId='run-1', nodeId='coordinator', maxIterations=10, store=null}={}) {
    if (store !== null) {
      assert(store.formatVersion === 0 && store.stateSchemaVersion === 1, 'INCOMPATIBLE_SNAPSHOT');
      assert(nonempty(store.tenantId) && nonempty(store.runId) &&
             nonempty(store.nodeId) && store.codeGeneration === 'dev-loop-v0', 'CORRUPT_SNAPSHOT');
      assert(Number.isSafeInteger(store.epoch) && store.epoch >= 0 &&
             Number.isSafeInteger(store.version) && store.version >= 0, 'CORRUPT_SNAPSHOT');
      assert(store.state && Number.isSafeInteger(store.state.iteration) &&
             Number.isSafeInteger(store.state.maxIterations) &&
             store.state.maxIterations > 0 && store.state.iteration >= 0 &&
             store.state.iteration <= store.state.maxIterations &&
             store.state.expectedRef === 'refs/heads/dev', 'CORRUPT_SNAPSHOT');
      assert(store.inbox && store.seen && store.outbox &&
             Array.isArray(store.events) && !Array.isArray(store.inbox) &&
             !Array.isArray(store.seen) && !Array.isArray(store.outbox), 'CORRUPT_SNAPSHOT');
      this.db = copy(store);
      this.db.active = false; // a new process must never inherit an active lease
    } else {
      assert(nonempty(tenantId) && nonempty(runId) && nonempty(nodeId), 'BAD_ACTOR_ID');
      assert(Number.isSafeInteger(maxIterations) && maxIterations > 0, 'BAD_BUDGET');
      this.db = {
        formatVersion:0, stateSchemaVersion:1, codeGeneration:'dev-loop-v0',
        tenantId, runId, nodeId, epoch:0, active:false, version:0,
        state:{stage:'editing',iteration:0,expectedSha:null,expectedRef:'refs/heads/dev',maxIterations,
               lastFailure:null,unchangedFailures:0},
        inbox:{}, seen:{}, outbox:{}, events:[]
      };
    }
  }
  snapshot() { return copy(this.db); }
  activate() {
    assert(!this.db.active, 'ALREADY_ACTIVE');
    assert(Number.isSafeInteger(this.db.epoch+1), 'EPOCH_OVERFLOW');
    this.db.epoch++;
    this.db.active=true;
    return this.db.epoch;
  }
  checkLease(epoch) {
    assert(this.db.active && epoch === this.db.epoch, 'STALE_ACTIVATION_EPOCH');
  }
  freeze(epoch) {
    this.checkLease(epoch);
    this.db.active=false;
    return this.snapshot();
  }
  enqueue(message) {
    assert(message && nonempty(message.id) && nonempty(message.type), 'BAD_MESSAGE');
    assert(message.tenantId === this.db.tenantId && message.runId === this.db.runId, 'WRONG_ACTOR');
    if (Object.hasOwn(this.db.seen,message.id) || Object.hasOwn(this.db.inbox,message.id)) return false;
    put(this.db.inbox,message.id,copy(message));
    return true;
  }
  apply(epoch, id, {crashBeforeCommit=false}={}) {
    this.checkLease(epoch);
    assert(nonempty(id), 'BAD_MESSAGE_ID');
    if (Object.hasOwn(this.db.seen,id)) return false;
    assert(Object.hasOwn(this.db.inbox,id), 'UNKNOWN_INBOX_MESSAGE');
    const m=this.db.inbox[id];
    // Candidate state is isolated; exceptions or simulated crashes cannot partially commit.
    const next=this.snapshot(), s=next.state;
    delete next.inbox[id];
    put(next.seen,id,true);
    const event=(kind)=>next.events.push({kind,messageId:id,iteration:s.iteration,sha:s.expectedSha});
    const intent=(kind,key)=> {
      assert(!Object.hasOwn(next.outbox,key), 'DUPLICATE_INTENT');
      put(next.outbox,key,{kind,key,status:'pending'});
    };
    switch(m.type) {
      case 'code_pushed':
        assert(s.stage==='editing', 'UNEXPECTED_PUSH');
        assert(nonempty(m.sha), 'BAD_SHA');
        assert(s.iteration < s.maxIterations, 'ITERATION_BUDGET_EXHAUSTED');
        s.iteration++;
        s.expectedSha=m.sha;
        s.stage='waiting_webhook';
        event('code_pushed');
        break;
      case 'github_push':
        // A delivery from an old revision, another branch, or a different iteration is inert.
        if (s.stage!=='waiting_webhook' || m.sha!==s.expectedSha ||
            m.iteration!==s.iteration || m.ref!==s.expectedRef) {
          event('stale_webhook_ignored'); break;
        }
        s.stage='testing';
        intent('test_run',next.runId+':test:'+s.iteration+':'+s.expectedSha);
        event('webhook_matched');
        break;
      case 'tests_failed':
        if(s.stage!=='testing' || m.sha!==s.expectedSha || m.iteration!==s.iteration) {
          event('stale_test_ignored'); break;
        }
        assert(nonempty(m.fingerprint), 'BAD_FAILURE_FINGERPRINT');
        s.unchangedFailures=(s.lastFailure===m.fingerprint)?s.unchangedFailures+1:1;
        s.lastFailure=m.fingerprint;
        // Group repeated failure reports under one durable fingerprint for the run.
        const bugKey=next.runId+':bug:'+m.fingerprint;
        if(!Object.hasOwn(next.outbox,bugKey))intent('bug_report',bugKey);
        s.stage=s.unchangedFailures>=3?'paused':'editing';
        event('tests_failed');
        break;
      case 'tests_passed':
        if(s.stage!=='testing' || m.sha!==s.expectedSha || m.iteration!==s.iteration) {
          event('stale_test_ignored'); break;
        }
        s.stage='awaiting_review';
        intent('request_review',next.runId+':review:'+s.iteration+':'+s.expectedSha);
        event('tests_passed');
        break;
      default: throw new Error('UNKNOWN_MESSAGE_TYPE');
    }
    assert(Number.isSafeInteger(next.version+1), 'STATE_VERSION_OVERFLOW');
    next.version++;
    if (crashBeforeCommit) throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
    this.db=next;
    return true;
  }
  acknowledge(epoch,key,receipt) {
    this.checkLease(epoch);
    assert(nonempty(receipt), 'BAD_RECEIPT');
    assert(Object.hasOwn(this.db.outbox,key), 'UNKNOWN_INTENT');
    const current=this.db.outbox[key];
    if(current.status==='acknowledged') {
      assert(current.receipt===receipt, 'RECEIPT_CONFLICT');
      return false;
    }
    assert(Number.isSafeInteger(this.db.version+1), 'STATE_VERSION_OVERFLOW');
    const next=this.snapshot();
    next.outbox[key].status='acknowledged';
    next.outbox[key].receipt=receipt;
    next.version++;
    this.db=next;
    return true;
  }
}
