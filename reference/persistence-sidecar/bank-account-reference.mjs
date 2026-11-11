// Source-free COMMAND ADAPTER for the existing PolicyActorReference + BatchPersistenceSidecar.
// NOT compiled AttoLang, a supervisor, an async provider or production idempotency.
// Compacted checkpoints require provider-verified command index provenance.
import {createHash} from 'node:crypto';

const reject = (code) => { throw new Error(code); };
const int = (x) => Number.isSafeInteger(x);
const canon = (command) => JSON.stringify([command.kind, command.amount_cents]);
const hash = (command) => createHash('sha256').update(canon(command)).digest('hex');
// The command identity is independent of incarnation and stream version.
const command_bytes = (command) => Buffer.from(canon(command),'utf8');

export function validate_bank_command(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command) ||
      Object.keys(command).sort().join(',') !== 'amount_cents,kind' ||
      !['deposit','withdraw'].includes(command.kind) ||
      !int(command.amount_cents) || command.amount_cents <= 0) reject('INVALID_COMMAND');
  return Object.freeze({kind: command.kind, amount_cents: command.amount_cents});
}

export function apply_bank_event(state, event) {
  if (!state || !int(state.balance_cents) || state.balance_cents < 0 ||
      !event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).sort().join(',') !== 'amount_cents,command_hash,kind,schema_version' ||
      !['money_deposited','money_withdrawn'].includes(event.kind) ||
      event.schema_version !== 1 || !int(event.amount_cents) || event.amount_cents <= 0 ||
      typeof event.command_hash !== 'string' || !/^[0-9a-f]{64}$/.test(event.command_hash))
    reject('INVALID_EVENT');
  // A valid-looking hash must also match the canonical logical command.
  // Otherwise tampered history could carry a forged retry identity.
  const original_command = {kind:event.kind === 'money_deposited' ? 'deposit' : 'withdraw',
    amount_cents:event.amount_cents};
  if (event.command_hash !== hash(original_command)) reject('CORRUPT_ACCOUNT_JOURNAL');
  const delta = event.kind === 'money_deposited' ? event.amount_cents : -event.amount_cents;
  const next = state.balance_cents + delta;
  if (!int(next) || next < 0) reject('CORRUPT_ACCOUNT_JOURNAL');
  return {balance_cents: next};
}

// actor: the existing PolicyActorReference configured with #event_sourced + apply_bank_event.
// sidecar: the existing trusted BatchPersistenceSidecar (or a contract-compatible test double).
// Tenant, actor ID and epoch MUST originate in the trusted host control plane, never guest input.
export class BankAccountCommandReference {
  #actor; #sidecar; #scope; #committed = new Map(); #pending = null; #ready = false;
  #checkpointVersion = 0;
  constructor({actor, sidecar, tenantId, actorId, stateName = 'main', epoch}) {
    if (!actor || !sidecar || typeof tenantId !== 'string' || !tenantId ||
        typeof actorId !== 'string' || !actorId || typeof stateName !== 'string' || !stateName ||
        !int(epoch) || epoch < 1) reject('INVALID_ACTIVATION');
    // Bind adapter identity to the trusted actor activation, not caller input.
    if ((actor.tenantId !== undefined && actor.tenantId !== tenantId) ||
        (actor.actor !== undefined && actor.actor !== actorId) ||
        (actor.stateName !== undefined && actor.stateName !== stateName) ||
        (actor.epoch !== undefined && actor.epoch !== epoch) ||
        (sidecar.tenantId !== undefined && sidecar.tenantId !== tenantId))
      reject('ACTIVATION_SCOPE_MISMATCH');
    this.#actor = actor;
    this.#sidecar = sidecar;
    this.#scope = Object.freeze({tenantId, actor:actorId, stateName, epoch});
  }
  #check_ready() { if (!this.#ready) reject('RECOVERY_NOT_COMPLETE'); }
  get version() { this.#check_ready(); return this.#actor.version; }
  get balance_cents() {
    this.#check_ready();
    return this.#actor.handle_state('critical-read', s => s.balance_cents);
  }
  get has_pending_write() { return this.#pending !== null; }
  // Supervisor must establish a provider-enforced activation fence BEFORE this call.
  // Reject ordinary legacy snapshots; allow only fenced command checkpoints
  // supplied by the trusted provider. Read one coherent recovery view.
  restore() {
    if (this.#ready || this.#pending) reject('INVALID_RECOVERY_STATE');
    const restored = this.#actor.restore();
    const loaded = restored && Array.isArray(restored.events)
      ? restored : this.#sidecar.loadFenced(this.#scope);
    if (!int(loaded.version) || loaded.version < 0 || !Array.isArray(loaded.events))
      reject('INVALID_JOURNAL');
    let balance = 0, sequence = 0;
    if (loaded.snapshot !== null) {
      const snap=loaded.snapshot;
      if(snap.provenance!=='command_checkpoint_v1' || snap.verifiedCommandIndex!==true)
        reject('DURABLE_DEDUPE_INDEX_REQUIRED');
      if(!int(snap.version)||snap.version<1||snap.version>loaded.version||
         snap.schemaVersion!==1||!Buffer.isBuffer(snap.payload))
        reject('INVALID_CHECKPOINT');
      let state;
      try {state=JSON.parse(snap.payload.toString('utf8'));}
      catch {reject('INVALID_CHECKPOINT');}
      if(!state||typeof state!=='object'||Array.isArray(state)||
         Object.keys(state).join(',')!=='balance_cents'||
         !int(state.balance_cents)||state.balance_cents<0)
        reject('INVALID_CHECKPOINT');
      balance=state.balance_cents;sequence=snap.version;
    }
    const seen = new Map();
    for (const entry of loaded.events) {
      // This bank fixture emits exactly one event per command. Other typed
      // actors may use multi-event transactions, but duplicated IDs here are corruption.
      if (entry.version !== sequence + 1 || entry.schemaVersion !== 1 ||
          typeof entry.opId !== 'string' || !entry.opId || seen.has(entry.opId) ||
          !Buffer.isBuffer(entry.payload)) reject('INVALID_JOURNAL');
      let event;
      try { event = JSON.parse(entry.payload.toString('utf8')); }
      catch { reject('INVALID_JOURNAL'); }
      balance = apply_bank_event({balance_cents:balance}, event).balance_cents;
      sequence = entry.version;
      if (typeof this.#sidecar.verifyCommand === 'function') {
        // Modern storage must retain a stable command receipt for EVERY
        // replayed bank event, not only for compacted history.
        const original_command = {kind:event.kind === 'money_deposited' ? 'deposit' : 'withdraw',
          amount_cents:event.amount_cents};
        const proof = this.#sidecar.verifyCommand({...this.#scope,opId:entry.opId,
          commandBytes:command_bytes(original_command)});
        if (!proof || proof.status !== 'committed' || proof.durable !== true ||
            proof.opId !== entry.opId || proof.firstVersion !== entry.version ||
            proof.version !== entry.version || proof.eventCount !== 1 ||
            !Buffer.isBuffer(proof.resultBytes) ||
            !proof.resultBytes.equals(Buffer.from(JSON.stringify({balance_cents:balance}))))
          reject('MISSING_COMMAND_RECORD');
      }
      const prior = seen.get(entry.opId);
      if (prior && prior.command_hash !== event.command_hash) reject('INVALID_JOURNAL');
      seen.set(entry.opId, {command_hash:event.command_hash, version:sequence});
    }
    if (sequence !== loaded.version || sequence !== this.#actor.version ||
        this.#actor.handle_state('critical-read', s => s.balance_cents) !== balance)
      reject('INVALID_JOURNAL');
    this.#committed = seen;
    this.#checkpointVersion=loaded.snapshot?.version??0;
    this.#ready = true;
    return {status:'ready',version:sequence,balance_cents:balance};
  }
  submit(opId, input) {
    this.#check_ready();
    if (typeof opId !== 'string' || !opId || opId.length > 128) reject('INVALID_OPERATION_ID');
    const command = validate_bank_command(input), command_hash = hash(command);
    if (this.#pending) {
      if (this.#pending.opId === opId && this.#pending.command_hash === command_hash)
        return {status:'pending', durable:false, duplicate:true};
      reject('WRITE_ALREADY_PENDING');
    }
    const prior = this.#committed.get(opId);
    if (prior && prior.command_hash !== command_hash) reject('OP_ID_CONFLICT');
    // Durable duplicate proofs are provider-authoritative and epoch-fenced.
    // A stale in-memory map alone may NEVER acknowledge a command.
    if (typeof this.#sidecar.verifyCommand === 'function') {
      const proof = this.#sidecar.verifyCommand({...this.#scope,opId,
        commandBytes:command_bytes(command)});
      if (proof) {
        if (!proof.durable || proof.status !== 'committed' || proof.opId !== opId ||
            !int(proof.version) || proof.version<1 || proof.version>this.#actor.version ||
            proof.eventCount!==1 || proof.firstVersion!==proof.version ||
            !Buffer.isBuffer(proof.resultBytes))
          reject('UNVERIFIABLE_COMMIT');
        if(prior) {
          if(prior.version!==proof.version)reject('INVALID_JOURNAL');
        } else if(!this.#checkpointVersion || proof.version>this.#checkpointVersion) {
          // Only an authenticated checkpoint may hide an old operation ID
          // from the in-memory replay map. Newer absent IDs require reload.
          reject('RELOAD_REQUIRED');
        }
        return {status:'committed',durable:true,duplicate:true,version:proof.version};
      }
    }
    if (prior) {
      // A modern provider returning null is an integrity failure. Never
      // acknowledge using a cached replay map when durable proof is missing.
      if (typeof this.#sidecar.verifyCommand === 'function')
        reject('MISSING_COMMAND_RECORD');
      // Compatibility for source-free legacy memory test doubles only.
      if (typeof this.#sidecar.loadFenced !== 'function') reject('UNVERIFIABLE_RESTORE');
      this.#sidecar.loadFenced(this.#scope);
      return {status:'committed',durable:true,duplicate:true,version:prior.version};
    }
    const balance = this.balance_cents;
    const delta = command.kind === 'deposit' ? command.amount_cents : -command.amount_cents;
    if (!int(balance + delta)) return {status:'rejected',code:'AMOUNT_OVERFLOW',durable:false};
    if (balance + delta < 0) return {status:'rejected',code:'INSUFFICIENT_FUNDS',durable:false};
    const event = {kind:command.kind === 'deposit' ? 'money_deposited':'money_withdrawn',
      amount_cents:command.amount_cents,command_hash,schema_version:1};
    const use_commands = typeof this.#actor.stage_events === 'function' &&
      typeof this.#sidecar.verifyCommand === 'function';
    const admitted = use_commands
      ? this.#actor.stage_events(opId,command_bytes(command),[event],
          Buffer.from(JSON.stringify({balance_cents:balance+delta})))
      : this.#actor.stage_event(opId,event);
    if (admitted.status === 'committed') reject('UNEXPECTED_DIRECT_COMMIT');
    if (admitted.status !== 'admitted' || admitted.durable !== false) reject('INVALID_ADMISSION');
    this.#pending = {opId,command_hash};
    return {status:'admitted', durable:false, duplicate:!!admitted.duplicate};
  }
  // A trusted persisted-op verification is performed by PolicyActorReference.apply_commit.
  accept_commit(receipt) {
    this.#check_ready();
    if (!this.#pending) reject('NO_PENDING_WRITE');
    const {opId, command_hash} = this.#pending;
    if (!receipt || receipt.opId !== opId) reject('UNMATCHED_RECEIPT');
    const accepted = this.#actor.apply_commit(receipt);
    this.#committed.set(opId,{command_hash,version:accepted.version});
    this.#pending = null;
    return {status:'committed',durable:true,duplicate:false,version:accepted.version};
  }
  // Host-only checkpoint; the actor supplies its private verified state.
  checkpoint_and_compact() {
    this.#check_ready();
    if(this.#pending)reject('PENDING_OUTCOME_MUST_RESOLVE');
    if(typeof this.#actor.checkpoint_and_compact!=='function')
      reject('UNSUPPORTED_CHECKPOINT_PROTOCOL');
    return this.#actor.checkpoint_and_compact();
  }
  // Caller cancellation withdraws only its wait; it does not cancel a possibly
  // committed provider transaction. The pending record stays until resolution.
  cancel_wait() {
    this.#check_ready();
    if (!this.#pending) reject('NO_PENDING_WRITE');
    return {status:'OUTCOME_UNKNOWN', durable:false, requires_reconciliation:true};
  }
  reconcile_pending() {
    this.#check_ready();
    if (!this.#pending) reject('NO_PENDING_WRITE');
    const {opId,command_hash} = this.#pending;
    const resolved = this.#actor.resolve_pending();
    if (resolved.status !== 'committed') return {status:'pending',durable:false};
    this.#committed.set(opId,{command_hash,version:resolved.version});
    this.#pending = null;
    return {status:'committed',durable:true,version:resolved.version};
  }
}
