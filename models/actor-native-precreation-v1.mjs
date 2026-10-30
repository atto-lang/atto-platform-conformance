/**
 * Deterministic source-free pre-creation reference model.
 *
 * Only a trusted host broker can own these operations. This JS model
 * performs NO syscalls and is not executable Oreslang backend evidence.
 */
export class NativePrecreationModel {
  #scopes = new Set();
  #pending = new Map();
  #registered = new Map();
  #closed = false;
  #usedHandles = 0;
  #usedBytes = 0;

  constructor(maxHandles = 4, maxBytes = 64) {
    this.#validate(maxHandles, maxBytes);
    this.maxHandles = maxHandles;
    this.maxBytes = maxBytes;
    this.root = this.scope(null, maxHandles, maxBytes);
  }

  #deny(code) { throw Object.assign(new Error(code), {code}); }

  #validate(handles, bytes) {
    if (!Number.isSafeInteger(handles) || handles < 1
        || !Number.isSafeInteger(bytes) || bytes < 0)
      this.#deny('INVALID_BUDGET');
  }

  scope(parent, maxHandles, maxBytes) {
    this.#validate(maxHandles, maxBytes);
    if (parent !== null) {
      if (!this.#scopes.has(parent)) this.#deny('FORGED_SCOPE');
      if (maxHandles > parent.maxHandles || maxBytes > parent.maxBytes)
        this.#deny('WIDENING');
      this.#requireLive(parent);
    }
    const node = {parent, maxHandles, maxBytes,
      handles:0, bytes:0, actorLive:true, revoked:false};
    this.#scopes.add(node);
    return node;
  }

  #lineage(scope) {
    if (!this.#scopes.has(scope)) this.#deny('FORGED_SCOPE');
    const ancestors = [];
    for (let node = scope; node !== null; node = node.parent)
      ancestors.push(node);
    return ancestors;
  }

  #requireLive(scope) {
    for (const node of this.#lineage(scope)) {
      if (!node.actorLive || node.revoked) this.#deny('REVOKED_OR_STOPPED');
    }
  }

  stopActor(scope) {
    if (!this.#scopes.has(scope)) this.#deny('FORGED_SCOPE');
    scope.actorLive = false;
  }

  revoke(scope) {
    if (!this.#scopes.has(scope)) this.#deny('FORGED_SCOPE');
    scope.revoked = true;
  }

  reserve(scope, accountedBytes = 0) {
    if (!Number.isSafeInteger(accountedBytes) || accountedBytes < 0)
      this.#deny('INVALID_BYTES');
    if (this.#closed) this.#deny('SHUTDOWN');
    const lineage = this.#lineage(scope);
    this.#requireLive(scope);
    if (this.#usedHandles >= this.maxHandles
        || accountedBytes > this.maxBytes - this.#usedBytes)
      this.#deny('CONTEXT_QUOTA');
    for (const node of lineage) {
      if (node.handles >= node.maxHandles
          || accountedBytes > node.maxBytes - node.bytes)
        this.#deny('SUBTREE_QUOTA');
    }
    // A trusted native broker serializes these checks with STOP and commit.
    for (const node of lineage) {
      node.handles++;
      node.bytes += accountedBytes;
    }
    this.#usedHandles++;
    this.#usedBytes += accountedBytes;
    const permit = Object.freeze(Object.create(null));
    this.#pending.set(permit, {scope, lineage, accountedBytes});
    return permit;
  }

  attach(permit, resource, callerScope) {
    const record = this.#pending.get(permit);
    if (!record) this.#deny('INVALID_OR_CONSUMED_PERMIT');
    if (!resource || typeof resource !== 'object') this.#deny('INVALID_RESOURCE');
    if (this.#registered.has(resource)) this.#deny('DUPLICATE_RESOURCE');
    // Actor ancestry is a quota intersection, NOT an identity. Even siblings
    // with identical parent permission scopes cannot consume each other's
    // precreation receipts. A real handle is nevertheless retained and
    // quarantined instead of falsely refunding the permit.
    const foreign = callerScope !== record.scope;
    let rejected = this.#closed || foreign;
    for (const node of record.lineage)
      if (!node.actorLive || node.revoked) rejected = true;
    this.#pending.delete(permit);
    this.#registered.set(resource, {...record, quarantined:rejected});
    if (foreign) this.#deny('FOREIGN_ACTOR_INCARNATION');
    return rejected ? 'QUARANTINED' : 'PUBLISHED';
  }

  abort(permit, callerScope) {
    const record = this.#pending.get(permit);
    if (!record) this.#deny('INVALID_OR_CONSUMED_PERMIT');
    // Only the creator's actor-incarnation identity can abort a pending
    // allocation. A foreign sibling cannot refund credits underneath it.
    if (callerScope !== record.scope)
      this.#deny('FOREIGN_ACTOR_INCARNATION');
    this.#pending.delete(permit);
    this.#refund(record);
  }

  #refund(record) {
    if (this.#usedHandles <= 0 || this.#usedBytes < record.accountedBytes)
      this.#deny('ACCOUNTING_UNDERFLOW');
    for (const node of record.lineage)
      if (node.handles <= 0 || node.bytes < record.accountedBytes)
        this.#deny('ACCOUNTING_UNDERFLOW');
    for (const node of record.lineage) {
      node.handles--;
      node.bytes -= record.accountedBytes;
    }
    this.#usedHandles--;
    this.#usedBytes -= record.accountedBytes;
  }

  physicalClose(resource, success = true) {
    const record = this.#registered.get(resource);
    if (!record) this.#deny('INVALID_OR_RETIRED_RESOURCE');
    if (!success) return false;
    this.#registered.delete(resource);
    this.#refund(record);
    return true;
  }

  shutdown() { this.#closed = true; }

  snapshot() {
    return {pending:this.#pending.size, registered:this.#registered.size,
      handles:this.#usedHandles, accountedBytes:this.#usedBytes,
      quarantined:[...this.#registered.values()].filter(x => x.quarantined).length,
      physicallyRetired:this.#pending.size === 0 && this.#registered.size === 0};
  }
}
