// HOST-ONLY transactional actor reference; NOT compiled AttoLang or async I/O.
// Reuses the existing sidecar's atomic multi-event command transaction and
// durable command index; does not introduce a second persistence engine.
import {createHash} from 'node:crypto';
import {validate_bank_command, apply_bank_event} from './bank-account-reference.mjs';

const deny=code=>{throw new Error(code);};
const integer=n=>Number.isSafeInteger(n);
const encode=v=>Buffer.from(JSON.stringify(v));
const parse=b=>JSON.parse(b.toString('utf8'));
const canonical_command=command=>encode([command.kind,command.amount_cents]);
const digest=b=>createHash('sha256').update(b).digest('hex');

export class TransactionalBankAccountReference {
  #store; #scope; #state={balance_cents:0}; #version=0;
  #ready=false; #pending=null;
  constructor({sidecar,tenantId,actorId,stateName='main',epoch}={}) {
    if(!sidecar || typeof sidecar.enqueueCommand!=='function' ||
       typeof sidecar.verifyCommand!=='function' ||
       typeof sidecar.loadFenced!=='function' ||
       ![tenantId,actorId,stateName].every(v=>typeof v==='string' && v.length>0) ||
       !integer(epoch) || epoch<1)deny('INVALID_ACTIVATION');
    this.#store=sidecar;
    this.#scope=Object.freeze({tenantId,actor:actorId,stateName,epoch});
    Object.freeze(this);
  }
  #requireReady() {if(!this.#ready)deny('RECOVERY_NOT_COMPLETE');}
  get version(){this.#requireReady();return this.#version;}
  get balance_cents(){this.#requireReady();return this.#state.balance_cents;}
  get has_pending_write(){return this.#pending!==null;}

  // Must run after the trusted supervisor has installed the provider fence.
  // Build entirely into local candidates: a corrupt tail never publishes a
  // partially replayed balance, even if the snapshot is otherwise valid.
  restore() {
    if(this.#ready || this.#pending)deny('INVALID_RECOVERY_STATE');
    const loaded=this.#store.loadFenced(this.#scope);
    if(!integer(loaded.version) || loaded.version<0 ||
       !Array.isArray(loaded.events))deny('INVALID_JOURNAL');
    let state={balance_cents:0},version=0;
    if(loaded.snapshot) {
      if(loaded.snapshot.schemaVersion!==1 ||
         !integer(loaded.snapshot.version) || loaded.snapshot.version<1 ||
         !Buffer.isBuffer(loaded.snapshot.payload))
        deny('SCHEMA_MIGRATION_REQUIRED');
      try {state=parse(loaded.snapshot.payload);}
      catch {deny('INVALID_SNAPSHOT');}
      if(!state || !integer(state.balance_cents) || state.balance_cents<0 ||
         Object.keys(state).sort().join(',')!=='balance_cents')
        deny('INVALID_SNAPSHOT');
      version=loaded.snapshot.version;
    }
    for(const row of loaded.events) {
      if(row.version!==version+1 || row.schemaVersion!==1 ||
         !Buffer.isBuffer(row.payload))deny('INVALID_JOURNAL');
      let event;
      try {event=parse(row.payload);}
      catch {deny('INVALID_JOURNAL');}
      state=apply_bank_event(state,event);
      version=row.version;
    }
    if(version!==loaded.version)deny('JOURNAL_GAP');
    this.#state=Object.freeze({balance_cents:state.balance_cents});
    this.#version=version;
    this.#ready=true;
    return {status:'ready',version,balance_cents:state.balance_cents};
  }

  #commandScope(opId,commandBytes) {
    return {...this.#scope,opId,commandBytes};
  }
  #finalize(p,proof) {
    if(!proof || proof.status!=='committed' || proof.durable!==true ||
       proof.opId!==p.opId || proof.firstVersion!==p.expectedVersion+1 ||
       proof.version!==p.expectedVersion+p.eventCount ||
       proof.eventCount!==p.eventCount ||
       !Buffer.isBuffer(proof.resultBytes) ||
       !proof.resultBytes.equals(p.resultBytes) ||
       this.#version!==p.expectedVersion)deny('OUTCOME_UNKNOWN');
    this.#state=Object.freeze({balance_cents:p.nextBalance});
    this.#version=proof.version;
    this.#pending=null;
    return {status:'committed',durable:true,version:this.#version};
  }
  // A deterministic two-event split deliberately tests atomic multi-event
  // transactions: one domain command maps to one or two immutable events.
  submit(opId,input) {
    this.#requireReady();
    if(typeof opId!=='string' || opId.length<1 || opId.length>128)
      deny('INVALID_OPERATION_ID');
    const command=validate_bank_command(input),commandBytes=canonical_command(command);
    if(this.#pending) {
      if(this.#pending.opId===opId &&
         this.#pending.commandBytes.equals(commandBytes))
        return {status:'pending',durable:false,duplicate:true};
      deny('WRITE_ALREADY_PENDING');
    }
    const scope=this.#commandScope(opId,commandBytes);
    const prior=this.#store.verifyCommand(scope);
    if(prior) {
      if(prior.version>this.#version)deny('REACTIVATION_REQUIRED');
      return {status:'committed',durable:true,duplicate:true,
        firstVersion:prior.firstVersion,version:prior.version,
        resultBytes:Buffer.from(prior.resultBytes)};
    }
    const before=this.#state.balance_cents;
    const signed=command.kind==='deposit'?command.amount_cents:-command.amount_cents;
    const next=before+signed;
    if(!integer(next))return {status:'rejected',code:'AMOUNT_OVERFLOW',durable:false};
    if(next<0)return {status:'rejected',code:'INSUFFICIENT_FUNDS',durable:false};
    const midpoint=Math.floor(command.amount_cents/2);
    const amounts=midpoint>0?[midpoint,command.amount_cents-midpoint]:[command.amount_cents];
    const type=command.kind==='deposit'?'money_deposited':'money_withdrawn';
    const command_hash=digest(commandBytes);
    let candidate={balance_cents:before};
    const events=amounts.map(amount_cents=>{
      const e={kind:type,amount_cents,command_hash,schema_version:1};
      candidate=apply_bank_event(candidate,e);
      return encode(e);
    });
    if(candidate.balance_cents!==next)deny('REDUCER_NONDETERMINISM');
    const resultBytes=encode({balance_cents:next});
    const admission=this.#store.enqueueCommand({
      ...this.#scope,opId,expectedVersion:this.#version,
      schemaVersion:1,commandBytes,events,resultBytes
    });
    if(admission.status==='committed') {
      const proof=this.#store.verifyCommand(scope);
      if(!proof || proof.version>this.#version)deny('REACTIVATION_REQUIRED');
      return {status:'committed',durable:true,duplicate:true,
        firstVersion:proof.firstVersion,version:proof.version,
        resultBytes:Buffer.from(proof.resultBytes)};
    }
    if(admission.status!=='admitted' || admission.durable!==false)
      deny('INVALID_ADMISSION');
    this.#pending={opId,commandBytes,resultBytes,nextBalance:next,
      expectedVersion:this.#version,eventCount:events.length};
    return {status:'admitted',durable:false,duplicate:!!admission.duplicate};
  }
  accept_commit(receipt) {
    this.#requireReady();
    const p=this.#pending;
    if(!p)deny('NO_PENDING_WRITE');
    if(!receipt || receipt.opId!==p.opId)deny('UNMATCHED_RECEIPT');
    // Provider evidence is mandatory; fabricated success is never state.
    if(receipt.status!=='committed' || receipt.durable!==true)
      deny('OUTCOME_UNKNOWN');
    const proof=this.#store.verifyCommand(this.#commandScope(p.opId,p.commandBytes));
    if(!proof || proof.version!==receipt.version ||
       proof.firstVersion!==receipt.firstVersion ||
       proof.eventCount!==receipt.eventCount)deny('OUTCOME_UNKNOWN');
    return this.#finalize(p,proof);
  }
  reconcile_pending() {
    this.#requireReady();
    const p=this.#pending;
    if(!p)deny('NO_PENDING_WRITE');
    const proof=this.#store.verifyCommand(this.#commandScope(p.opId,p.commandBytes));
    if(!proof)return {status:'pending',durable:false};
    return this.#finalize(p,proof);
  }
  cancel_wait() {
    this.#requireReady();
    if(!this.#pending)deny('NO_PENDING_WRITE');
    return {status:'OUTCOME_UNKNOWN',durable:false,requires_reconciliation:true};
  }
}
