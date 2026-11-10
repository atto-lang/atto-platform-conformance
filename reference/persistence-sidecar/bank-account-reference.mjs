// Source-free COMMAND ADAPTER for the existing PolicyActorReference + BatchPersistenceSidecar.
// NOT compiled AttoLang, a supervisor, an async provider or production idempotency.
// v1 deliberately fails closed on snapshots/compaction: a durable command index is required first.
import {createHash} from 'node:crypto';

const reject = (code) => { throw new Error(code); };
const int = (x) => Number.isSafeInteger(x);
const canon = (command) => JSON.stringify([command.kind, command.amount_cents]);
const hash = (command) => createHash('sha256').update(canon(command)).digest('hex');

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
  constructor({actor, sidecar, tenantId, actorId, stateName = 'main', epoch}) {
    if (!actor || !sidecar || typeof tenantId !== 'string' || !tenantId ||
        typeof actorId !== 'string' || !actorId || typeof stateName !== 'string' || !stateName ||
        !int(epoch) || epoch < 1) reject('INVALID_ACTIVATION');
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
  // Refuse snapshots until a durable command-dedupe index survives compaction.
  restore() {
    if (this.#ready || this.#pending) reject('INVALID_RECOVERY_STATE');
    this.#actor.restore();
    const loaded = this.#sidecar.loadFenced(this.#scope);
    if (loaded.snapshot !== null) reject('DURABLE_DEDUPE_INDEX_REQUIRED');
    if (!int(loaded.version) || loaded.version < 0 || !Array.isArray(loaded.events)) reject('INVALID_JOURNAL');
    let balance = 0, sequence = 0;
    const seen = new Map();
    for (const entry of loaded.events) {
      if (entry.version !== sequence + 1 || entry.schemaVersion !== 1 ||
          typeof entry.opId !== 'string' || !entry.opId || seen.has(entry.opId) ||
          !Buffer.isBuffer(entry.payload)) reject('INVALID_JOURNAL');
      let event;
      try { event = JSON.parse(entry.payload.toString('utf8')); }
      catch { reject('INVALID_JOURNAL'); }
      balance = apply_bank_event({balance_cents:balance}, event).balance_cents;
      sequence = entry.version;
      seen.set(entry.opId, {command_hash:event.command_hash, version:sequence});
    }
    if (sequence !== loaded.version || sequence !== this.#actor.version ||
        this.#actor.handle_state('critical-read', s => s.balance_cents) !== balance)
      reject('INVALID_JOURNAL');
    this.#committed = seen;
    this.#ready = true;
    return {status:'ready',version:sequence,balance_cents:balance};
  }
  submit(opId, input) {
    this.#check_ready();
    if (typeof opId !== 'string' || !opId || opId.length > 128) reject('INVALID_OPERATION_ID');
    const command = validate_bank_command(input), command_hash = hash(command);
    const prior = this.#committed.get(opId);
    if (prior) {
      if (prior.command_hash !== command_hash) reject('OP_ID_CONFLICT');
      return {status:'committed', durable:true, duplicate:true, version:prior.version};
    }
    if (this.#pending) {
      if (this.#pending.opId === opId && this.#pending.command_hash === command_hash)
        return {status:'pending', durable:false, duplicate:true};
      reject('WRITE_ALREADY_PENDING');
    }
    const balance = this.balance_cents;
    const delta = command.kind === 'deposit' ? command.amount_cents : -command.amount_cents;
    if (!int(balance + delta)) return {status:'rejected',code:'AMOUNT_OVERFLOW',durable:false};
    if (balance + delta < 0) return {status:'rejected',code:'INSUFFICIENT_FUNDS',durable:false};
    const event = {kind:command.kind === 'deposit' ? 'money_deposited':'money_withdrawn',
      amount_cents:command.amount_cents,command_hash,schema_version:1};
    const admitted = this.#actor.stage_event(opId,event);
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
