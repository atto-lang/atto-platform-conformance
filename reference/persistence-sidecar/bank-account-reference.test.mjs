import test from 'node:test';
import assert from 'node:assert/strict';
import {BankAccountCommandReference, apply_bank_event, validate_bank_command} from './bank-account-reference.mjs';

// Source-free in-memory test doubles; this is NOT a real database or guest actor.
class MemorySidecar {
  constructor() { this.events=[];this.version=0;this.epoch=1;this.queue=[];this.durable=new Map(); }
  grant_epoch(epoch) { if(epoch<=this.epoch) throw new Error('EPOCH_NOT_ADVANCED'); this.epoch=epoch;this.queue=[]; }
  loadFenced({epoch}) {
    if(epoch!==this.epoch)throw new Error('STALE_EPOCH');
    return {snapshot:null,version:this.version,events:this.events.map(e=>({...e,payload:Buffer.from(e.payload)}))};
  }
  enqueue(envelope) {
    if(envelope.epoch!==this.epoch)throw new Error('STALE_EPOCH');
    if(envelope.expectedVersion!==this.version)throw new Error('VERSION_CONFLICT');
    this.queue.push({...envelope,payload:Buffer.from(envelope.payload)});
    return {status:'admitted',durable:false};
  }
  flush() {
    const receipts=[];
    for(const e of this.queue.splice(0)){
      if(e.epoch!==this.epoch || e.expectedVersion!==this.version){receipts.push({opId:e.opId,status:'rejected',durable:false});continue;}
      this.version++;
      this.events.push({version:this.version,opId:e.opId,schemaVersion:1,payload:Buffer.from(e.payload)});
      this.durable.set(e.opId,{version:this.version,payload:Buffer.from(e.payload)});
      receipts.push({opId:e.opId,status:'committed',durable:true,version:this.version});
    }
    return receipts;
  }
  verifyCommit(e){
    if(e.epoch!==this.epoch)throw new Error('STALE_EPOCH');
    const d=this.durable.get(e.opId);
    return d && d.version===e.expectedVersion+1 && d.payload.equals(e.payload)
      ? {opId:e.opId,status:'committed',durable:true,version:d.version}:null;
  }
}
class MemoryPolicyActor {
  constructor(store,epoch) { this.store=store;this.epoch=epoch;this.state={balance_cents:0};this.version=0;this.pending=null; }
  handle_state(access,callback) { if(access!=='critical-read')throw new Error('DENIED'); return callback({...this.state}); }
  restore() {
    const s=this.store.loadFenced({epoch:this.epoch});this.state={balance_cents:0};this.version=0;
    for(const e of s.events){this.state=apply_bank_event(this.state,JSON.parse(e.payload));this.version=e.version;}
  }
  stage_event(opId,event) {
    if(this.pending)throw new Error('PENDING');
    const next=apply_bank_event(this.state,event);
    const e={opId,epoch:this.epoch,expectedVersion:this.version,payload:Buffer.from(JSON.stringify(event))};
    const result=this.store.enqueue(e);this.pending={e,next};return result;
  }
  apply_commit(receipt) {
    if(!this.pending || receipt.opId!==this.pending.e.opId)throw new Error('UNMATCHED_RECEIPT');
    if(receipt.status!=='committed' || !receipt.durable || !this.store.verifyCommit(this.pending.e))throw new Error('OUTCOME_UNKNOWN');
    this.state=this.pending.next;this.version=receipt.version;this.pending=null;
    return {version:this.version,status:'committed',durable:true};
  }
  resolve_pending() {
    if(!this.pending)throw new Error('NO_PENDING');
    const proof=this.store.verifyCommit(this.pending.e);
    if(!proof)return {status:'pending',durable:false};
    return this.apply_commit(proof);
  }
}
const harness=(store=new MemorySidecar(),epoch=store.epoch,id='bank-a')=>{
  const account=new BankAccountCommandReference({actor:new MemoryPolicyActor(store,epoch),sidecar:store,
    tenantId:'tenant-a',actorId:id,epoch});
  return {account,store};
};
const deposit=(amount_cents)=>({kind:'deposit',amount_cents});
const withdraw=(amount_cents)=>({kind:'withdraw',amount_cents});
const committed=(account,store,opId,command)=>{
  assert.equal(account.submit(opId,command).status,'admitted');
  return account.accept_commit(store.flush()[0]);
};

test('pure reducer and command validation reject invalid money and corrupt journal events',()=>{
  assert.deepEqual(validate_bank_command(deposit(100)),deposit(100));
  for(const command of [deposit(0),deposit(-1),deposit(1.5),deposit(Number.MAX_SAFE_INTEGER+1),
    {...deposit(1),extra:4},{kind:'transfer',amount_cents:1},null])
    assert.throws(()=>validate_bank_command(command),/INVALID_COMMAND/);
  assert.throws(()=>apply_bank_event({balance_cents:0},{kind:'money_withdrawn',amount_cents:1,
    command_hash:'0'.repeat(64),schema_version:1}),/CORRUPT_ACCOUNT_JOURNAL/);
  assert.throws(()=>apply_bank_event({balance_cents:0},{kind:'money_deposited',amount_cents:25,
    command_hash:'0'.repeat(64),schema_version:1}),/CORRUPT_ACCOUNT_JOURNAL/);
});

test('must restore before accepting commands or exposing actor state',()=>{
  const {account}=harness();
  assert.throws(()=>account.submit('op-1',deposit(42)),/RECOVERY_NOT_COMPLETE/);
  assert.throws(()=>account.balance_cents,/RECOVERY_NOT_COMPLETE/);
  assert.deepEqual(account.restore(),{status:'ready',version:0,balance_cents:0});
  assert.throws(()=>account.restore(),/INVALID_RECOVERY_STATE/);
});

test('committed event changes state only after provider proof; withdrawal validation',()=>{
  const {account,store}=harness();account.restore();
  assert.equal(account.submit('d1',deposit(120)).status,'admitted');
  assert.equal(account.balance_cents,0);
  assert.equal(account.version,0);
  assert.throws(()=>account.submit('d2',deposit(5)),/WRITE_ALREADY_PENDING/);
  assert.equal(account.submit('d1',deposit(120)).status,'pending');
  assert.equal(account.balance_cents,0);
  account.accept_commit(store.flush()[0]);
  assert.equal(account.balance_cents,120);
});

test('deposit/withdraw/rejection and duplicate command in same incarnation',()=>{
  const {account,store}=harness();account.restore();
  committed(account,store,'d1',deposit(120));
  assert.equal(account.balance_cents,120);
  assert.deepEqual(account.submit('d1',deposit(120)),{status:'committed',durable:true,duplicate:true,version:1});
  assert.throws(()=>account.submit('d1',deposit(130)),/OP_ID_CONFLICT/);
  assert.deepEqual(account.submit('w0',withdraw(200)),{status:'rejected',code:'INSUFFICIENT_FUNDS',durable:false});
  committed(account,store,'w1',withdraw(30));
  assert.equal(account.balance_cents,90);
  assert.equal(store.events.length,2);
});

test('crash after durable event commit, before ACK: retry same ID after new epoch does not append',()=>{
  const store=new MemorySidecar();
  const first=harness(store).account;first.restore();
  assert.equal(first.submit('d1',deposit(500)).status,'admitted');
  assert.equal(store.flush()[0].status,'committed'); // no actor receipt: process crashes
  assert.equal(first.balance_cents,0);
  store.grant_epoch(2);
  const second=harness(store,2).account;
  assert.deepEqual(second.restore(),{status:'ready',version:1,balance_cents:500});
  assert.deepEqual(second.submit('d1',deposit(500)),{status:'committed',durable:true,duplicate:true,version:1});
  assert.throws(()=>second.submit('d1',deposit(700)),/OP_ID_CONFLICT/);
  assert.equal(store.events.length,1);
});

test('unflushed admitted write lost at crash and same command can be committed once',()=>{
  const store=new MemorySidecar();const first=harness(store).account;first.restore();
  first.submit('d1',deposit(500));
  store.grant_epoch(2);
  const next=harness(store,2).account;next.restore();
  committed(next,store,'d1',deposit(500));
  assert.equal(next.balance_cents,500);
  assert.equal(store.events.length,1);
});

test('lost ACK remains pending until trusted provider persisted-op reconciliation',()=>{
  const {account,store}=harness();account.restore();
  account.submit('d1',deposit(400));
  assert.deepEqual(account.reconcile_pending(),{status:'pending',durable:false});
  assert.equal(account.balance_cents,0);
  store.flush();
  assert.deepEqual(account.reconcile_pending(),{status:'committed',durable:true,version:1});
  assert.equal(account.balance_cents,400);
});

test('forged receipt cannot publish state, then genuine receipt succeeds',()=>{
  const {account,store}=harness();account.restore();
  account.submit('d1',deposit(300));
  assert.throws(()=>account.accept_commit({status:'committed',durable:true,opId:'d1',version:1}),/OUTCOME_UNKNOWN/);
  assert.equal(account.balance_cents,0);
  const [real]=store.flush();account.accept_commit(real);
  assert.equal(account.balance_cents,300);
});

test('fail closed on post-snapshot dedupe gap and corrupted journal',()=>{
  const {account,store}=harness();store.loadFenced=()=>({snapshot:{version:1},version:1,events:[]});
  assert.throws(()=>account.restore(),/DURABLE_DEDUPE_INDEX_REQUIRED/);
  const other=new MemorySidecar();other.events.push({version:2,opId:'bad',schemaVersion:1,
    payload:Buffer.from('{}')});other.version=2;
  const restarted=harness(other).account;
  assert.throws(()=>restarted.restore(),/INVALID_EVENT|INVALID_JOURNAL/);
});

test('cancelling a persistence wait cannot erase an unresolved write or authorize the next command',()=>{
  const {account,store}=harness();account.restore();
  account.submit('cancel-me',deposit(901));
  assert.deepEqual(account.cancel_wait(),
    {status:'OUTCOME_UNKNOWN',durable:false,requires_reconciliation:true});
  assert.equal(account.has_pending_write,true);
  assert.equal(account.balance_cents,0);
  assert.throws(()=>account.submit('next',deposit(1)),/WRITE_ALREADY_PENDING/);
  store.flush();
  assert.equal(account.reconcile_pending().status,'committed');
  assert.equal(account.balance_cents,901);
  assert.equal(account.has_pending_write,false);
});

test('bank replay rejects duplicate operation rows even with matching event hash',()=>{
  const {account,store}=harness();account.restore();
  committed(account,store,'dup-1',deposit(33));
  store.events.push({...store.events[0],version:2,payload:Buffer.from(store.events[0].payload)});
  store.version=2;
  assert.throws(()=>harness(store).account.restore(),/INVALID_JOURNAL/);
});

test('bank adapter rejects mismatched trusted actor activation identity',()=>{
  const store=new MemorySidecar();
  assert.throws(()=>new BankAccountCommandReference({actor:new MemoryPolicyActor(store,2),
    sidecar:store,tenantId:'tenant-a',actorId:'bank-a',epoch:1}),/ACTIVATION_SCOPE_MISMATCH/);
});
