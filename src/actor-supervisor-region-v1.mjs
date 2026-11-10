/**
 * AttoLang actor/supervisor memory protocol -- SOURCE-FREE reference oracle.
 * This is NOT an AttoLang compiler borrow checker, production lock, or guest proof.
 * No user-data references are ever exported by this model.
 */
const same = (a, b) => a?.role === b?.role && a?.id === b?.id;
const sameExecution = (a, b) => same(a, b) && a?.executionId === b?.executionId;
const key = (p) => JSON.stringify([p.role, p.id, p.executionId]);

function principal(p) {
  if (!p || !['actor', 'supervisor'].includes(p.role) ||
      typeof p.id !== 'string' || p.id.length === 0) {
    throw new TypeError('expected named actor or supervisor principal');
  }
  if (p.executionId !== undefined && (typeof p.executionId !== 'string' || !p.executionId.length)) {
    throw new TypeError('invalid logical execution ID');
  }
  return Object.freeze({ role: p.role, id: p.id, executionId: p.executionId ?? 'default' });
}

function ensure(ok, message) {
  if (!ok) throw new Error(message);
}

/**
 * Finite lexical-loan oracle for compiler negative fixtures. Each operation has
 * the form ['init', name, role], ['read'|'write', name, loanId, role],
 * ['release', loanId], ['move', name, newRole], ['owner-use', name, role],
 * ['grant', root, grantId, recipientRole, mode, issuingOwnerRole],
 * ['await', role], ['escape', loanId].
 *
 * The compiler must eventually prove equivalent properties over typed MIR/CFG,
 * paths, projections, exceptions, and nested async control flow.
 */
export function checkBorrowTrace(ops) {
  const roots = new Map();
  const aliases = new Map();
  const loans = new Map();
  // A loan ID is a linear identity, not a reusable variable name. Recycling
  // released IDs permits old references to alias unrelated fresh loans.
  const seenLoans = new Set();
  const grants = new Map();
  const seenGrants = new Set();
  let ended = false;
  const fail = (at, why) => ({ ok: false, at, why });
  const resolve = (root) => aliases.get(root)?.base ?? root;
  const aliasesOf = (root) => [...aliases.values()].filter(alias => alias.base === root);
  if (!Array.isArray(ops)) return fail(-1, 'trace must be an array');
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!Array.isArray(op) || typeof op[0] !== 'string') return fail(i, 'invalid operation');
    if (ended) return fail(i, 'operation after end');
    const [kind, root, arg, role] = op;
    if (kind === 'init') {
      if (roots.has(root) || aliases.has(root) || typeof root !== 'string' || !root.length ||
          !['actor', 'supervisor'].includes(arg)) return fail(i, 'invalid or duplicate owner');
      roots.set(root, arg);
    } else if (kind === 'alias' || kind === 'project') {
      // Conservative root-sensitive model. Until compiler field-disjointness
      // proof exists, all projections are treated as overlapping one root.
      const base = resolve(root);
      if (!roots.has(base) || typeof arg !== 'string' || !arg.length ||
          roots.has(arg) || aliases.has(arg)) return fail(i, 'invalid or duplicate alias');
      if ([...loans.values()].some(l => l.root === base && l.kind === 'write')) {
        return fail(i, 'cannot create shared alias during exclusive writer loan');
      }
      // A live alias is a scoped, immutable view, not merely a spelling of
      // its root. Even without an explicit read op it prevents exclusive
      // mutation and cannot cross suspension/transfer.
      aliases.set(arg, { base, role: roots.get(base) });
    } else if (kind === 'drop-alias') {
      if (!aliases.delete(root)) return fail(i, 'missing or already-dropped alias');
    } else if (kind === 'read' || kind === 'write') {
      const base = resolve(root);
      const owner = roots.get(base);
      if (!owner || typeof arg !== 'string' || !arg.length || seenLoans.has(arg) ||
          !['actor', 'supervisor'].includes(role)) return fail(i, 'missing root or invalid loan');
      if (role === owner && op[4] !== undefined) {
        return fail(i, 'owner loan must not present delegated grant');
      }
      // A cross-boundary loan consumes a typed grant previously issued by
      // the current owner; a boolean/attestation is not a proof.
      let grant;
      if (role !== owner) {
        grant = grants.get(op[4]);
        if (!grant || grant.used || grant.root !== base ||
            grant.recipient !== role || grant.mode !== kind) {
          return fail(i, 'cross-boundary loan requires live typed grant');
        }
      }
      for (const l of loans.values()) {
        if (l.root === base && (kind === 'write' || l.kind === 'write')) {
          return fail(i, 'conflicting read/write loans');
        }
      }
      if (kind === 'write' && aliasesOf(base).length) {
        return fail(i, 'conflicting writer with live immutable aliases');
      }
      // Failed overlap admission never burns the grant; only successful loan
      // issuance consumes a one-use authorization.
      if (grant) grant.used = true;
      seenLoans.add(arg);
      loans.set(arg, { root: base, role, kind });
    } else if (kind === 'grant') {
      const owner = roots.get(root);
      if (!owner || typeof arg !== 'string' || !arg.length || seenGrants.has(arg) ||
          !['actor', 'supervisor'].includes(role) || role === owner ||
          !['read', 'write'].includes(op[4]) || op[5] !== owner) {
        return fail(i, 'only current owner may issue typed delegation');
      }
      seenGrants.add(arg);
      grants.set(arg, { root, recipient: role, mode: op[4], used: false });
    } else if (kind === 'release') {
      const loan = loans.get(root);
      if (!loan) return fail(i, 'missing or already-released loan');
      if (op.length > 2 && (arg !== loan.role || !['actor', 'supervisor'].includes(arg))) {
        return fail(i, 'loan can only be released by borrower role');
      }
      loans.delete(root);
    } else if (kind === 'move') {
      if (!roots.has(root) || !['actor', 'supervisor'].includes(arg)) {
        return fail(i, 'invalid ownership transfer');
      }
      if (roots.get(root) === arg) return fail(i, 'ownership move must change owner');
      if ([...loans.values()].some(l => l.root === root)) {
        return fail(i, 'transfer with outstanding loans');
      }
      if (aliasesOf(root).length) {
        return fail(i, 'transfer with outstanding aliases');
      }
      roots.set(root, arg);
      for (const [grantId, grant] of grants) {
        if (grant.root === root) grants.delete(grantId);
      }
    } else if (kind === 'owner-use') {
      const base = resolve(root);
      if (!roots.has(base) || roots.get(base) !== arg) return fail(i, 'non-owner raw access');
      const mode = role ?? 'read';
      if (mode !== 'read' && mode !== 'write') return fail(i, 'invalid raw access mode');
      if ([...loans.values()].some(l => l.root === base &&
          (mode === 'write' || l.kind === 'write'))) {
        return fail(i, 'conflicting owner raw access with outstanding loan');
      }
      if (mode === 'write' && aliasesOf(base).length) {
        return fail(i, 'conflicting owner raw write with immutable aliases');
      }
    } else if (kind === 'await') {
      if (!['actor', 'supervisor'].includes(root)) return fail(i, 'invalid suspension role');
      if ([...loans.values()].some(l => l.role === root)) {
        return fail(i, 'borrow crosses suspension');
      }
      if ([...aliases.values()].some(a => a.role === root)) {
        return fail(i, 'immutable alias crosses suspension');
      }
    } else if (kind === 'escape') {
      // No reference to a loan, live OR released, may escape to an actor,
      // channel, task, callback or continuation. A stale loan is not safe.
      return fail(i, 'loan escapes lexical lifetime (live or released)');
    } else if (kind === 'end') {
      if (loans.size !== 0) return fail(i, 'unreleased loan');
      if (aliases.size !== 0) return fail(i, 'undropped alias');
      ended = true;
    } else return fail(i, 'unknown operation');
  }
  if (loans.size !== 0) return fail(ops.length, 'unreleased loan');
  if (aliases.size !== 0) return fail(ops.length, 'undropped alias');
  return { ok: true };
}

export class ActorSupervisorRegionV1 {
  #actor;
  #supervisor;
  #generation;
  #ownerEpoch = 1;
  #owner;
  #stopped = false;
  #reclaimed = false;
  #active = new Map();
  #pending = [];
  #capabilities = new Map();
  #reserved = new Set();
  #maxPending;
  #maxDelegations;
  #maxActiveReaders;
  #nextTicket = 0;
  #activeActorTurn = false;

  constructor({ actorId, supervisorId, generation = 1, maxPending = 16,
    maxDelegations = 64, maxActiveReaders = 1024 }) {
    this.#actor = principal({ role: 'actor', id: actorId });
    this.#supervisor = principal({ role: 'supervisor', id: supervisorId });
    ensure(Number.isSafeInteger(generation) && generation > 0, 'invalid generation');
    ensure(Number.isSafeInteger(maxPending) && maxPending >= 0, 'invalid queue bound');
    ensure(Number.isSafeInteger(maxDelegations) && maxDelegations >= 0,
      'invalid delegation bound');
    ensure(Number.isSafeInteger(maxActiveReaders) && maxActiveReaders >= 1,
      'invalid active reader bound');
    this.#generation = generation;
    this.#maxPending = maxPending;
    this.#maxDelegations = maxDelegations;
    this.#maxActiveReaders = maxActiveReaders;
    this.#owner = this.#mintOwner(this.#actor);
  }

  #mintOwner(p) {
    return Object.freeze({ kind: 'owner', principal: p,
      generation: this.#generation, epoch: this.#ownerEpoch });
  }

  get owner() { return this.#owner; } // Opaque symbolic token; NOT guest-exposable.
  get generation() { return this.#generation; }
  get stats() {
    return Object.freeze({ generation: this.#generation,
      owner: this.#owner?.principal.role ?? null,
      activeReaders: [...this.#active.keys()].filter(t => t.mode === 'read').length,
      activeWriters: [...this.#active.keys()].filter(t => t.mode === 'write').length,
      pending: this.#pending.length,
      outstandingDelegations: this.#capabilities.size,
      stopped: this.#stopped,
      reclaimed: this.#reclaimed, activeActorTurn: this.#activeActorTurn });
  }

  #validOwner(token) { return token === this.#owner && !this.#reclaimed; }
  #operational() { ensure(!this.#stopped && !this.#reclaimed, 'region sealed'); }

  beginActorTurn(actorToken) {
    this.#operational();
    ensure(this.#validOwner(actorToken) && same(actorToken.principal, this.#actor),
      'actor turn needs actor owner authority');
    ensure(!this.#activeActorTurn, 'actor is non-reentrant');
    this.#activeActorTurn = true;
  }

  endActorTurn(actorToken) {
    ensure(this.#validOwner(actorToken) && same(actorToken.principal, this.#actor) &&
      this.#activeActorTurn, 'foreign or duplicate actor turn exit');
    this.#activeActorTurn = false;
  }

  /** Owner hands out a one-use SCOPED loan capability, never its raw state. */
  delegate(ownerToken, recipient, mode) {
    this.#operational();
    ensure(this.#validOwner(ownerToken), 'only current semantic owner can delegate');
    recipient = principal(recipient);
    ensure(mode === 'read' || mode === 'write', 'invalid access mode');
    ensure((same(recipient, this.#actor) || same(recipient, this.#supervisor)) &&
      !same(recipient, ownerToken.principal), 'recipient must be the other participant');
    ensure(this.#capabilities.size < this.#maxDelegations, 'delegation capacity exhausted');
    const cap = Object.freeze({ kind: 'scoped-loan', mode, recipient,
      generation: this.#generation, ownerEpoch: this.#ownerEpoch });
    this.#capabilities.set(cap, { used: false });
    return cap;
  }

  /**
   * `principal` is an authenticated *logical execution* in the real runtime.
   * This source-free reference uses stable role+id to exercise admission only.
   * Actual runtime must additionally authenticate logical execution generation/slot.
   */
  acquire(who, mode, { ownerToken = null, grant = null } = {}) {
    this.#operational();
    who = principal(who);
    ensure(mode === 'read' || mode === 'write', 'invalid access mode');
    ensure(same(who, this.#actor) || same(who, this.#supervisor), 'foreign participant');
    let delegated = false;
    if (this.#validOwner(ownerToken) && same(ownerToken.principal, who)) {
      ensure(grant === null, 'owner cannot also consume delegated grant');
    } else {
      const record = this.#capabilities.get(grant);
      ensure(record && !record.used && grant.generation === this.#generation &&
        grant.ownerEpoch === this.#ownerEpoch && sameExecution(grant.recipient, who) &&
        grant.mode === mode, 'missing, forged, stale or consumed grant');
      delegated = true;
    }
    const k = key(who);
    ensure(!this.#reserved.has(k), 'recursive or upgrading loan forbidden');
    const immediate = this.#pending.length === 0 && this.#canGrant(mode);
    if (!immediate) {
      ensure(this.#pending.length < this.#maxPending, 'bounded admission queue full');
    }
    ensure(this.#nextTicket < Number.MAX_SAFE_INTEGER, 'ticket serial exhausted');
    // All validation and capacity checks precede state mutation. In
    // particular, a failed queued acquisition must NOT consume its grant.
    const ticket = Object.freeze({ kind: 'ticket', serial: ++this.#nextTicket,
      who, mode, generation: this.#generation, ownerEpoch: this.#ownerEpoch });
    this.#reserved.add(k);
    if (immediate) {
      this.#active.set(ticket, true);
    } else {
      this.#pending.push(ticket);
    }
    if (delegated) this.#capabilities.delete(grant);
    return ticket;
  }

  #canGrant(mode) {
    if (mode === 'write') return this.#active.size === 0;
    return this.#active.size < this.#maxActiveReaders &&
      ![...this.#active.keys()].some(t => t.mode === 'write');
  }

  #promote() {
    if (this.#stopped) return;
    while (this.#pending.length > 0) {
      const head = this.#pending[0];
      if (!this.#canGrant(head.mode)) return;
      this.#pending.shift();
      this.#active.set(head, true);
      if (head.mode === 'write' ||
          this.#pending[0]?.mode === 'write') return;
    }
  }

  #known(ticket, who) {
    who = principal(who);
    ensure(ticket?.kind === 'ticket' && sameExecution(ticket.who, who) &&
      ticket.generation === this.#generation && ticket.ownerEpoch === this.#ownerEpoch &&
      (this.#active.has(ticket) || this.#pending.includes(ticket)),
    'invalid, foreign, duplicate or stale loan');
  }

  granted(ticket, who) {
    this.#known(ticket, who);
    return this.#active.has(ticket);
  }

  access(ticket, who, mode) {
    this.#known(ticket, who);
    ensure(!this.#stopped && !this.#reclaimed && this.#active.has(ticket),
      'no logical access while queued or after STOP');
    ensure(ticket.mode === mode || (ticket.mode === 'write' && mode === 'read'),
      'write requires exclusive writer loan');
    return true;
  }

  /** Active loans cannot be cancelled/revoked as if physically released. */
  cancelQueued(ticket, who) {
    this.#known(ticket, who);
    const i = this.#pending.indexOf(ticket);
    if (i === -1) return false;
    this.#pending.splice(i, 1);
    this.#reserved.delete(key(ticket.who));
    this.#promote();
    return true;
  }

  release(ticket, who) {
    this.#known(ticket, who);
    ensure(this.#active.has(ticket), 'queued loan must cancel, not release');
    this.#active.delete(ticket);
    this.#reserved.delete(key(ticket.who));
    this.#promote();
    return true;
  }

  assertMaySuspend(who) {
    who = principal(who);
    ensure(same(who, this.#actor) || same(who, this.#supervisor),
      'foreign participant cannot certify suspension');
    ensure(!this.#reserved.has(key(who)), 'loan live or queued across suspend');
    this.#operational();
    return true;
  }

  transfer(ownerToken, recipient) {
    this.#operational();
    ensure(this.#validOwner(ownerToken), 'only semantic owner may transfer');
    recipient = principal(recipient);
    ensure((same(recipient, this.#actor) || same(recipient, this.#supervisor)) &&
      !same(recipient, ownerToken.principal), 'transfer must change participant');
    ensure(this.#active.size === 0 && this.#pending.length === 0 &&
      this.#reserved.size === 0 && !this.#activeActorTurn,
      'ownership transfer requires physical quiescence');
    ensure(this.#ownerEpoch < Number.MAX_SAFE_INTEGER, 'owner epoch exhausted');
    this.#ownerEpoch++;
    this.#capabilities.clear();
    this.#owner = this.#mintOwner(recipient);
    return this.#owner;
  }

  /** Supervisor has lifecycle CONTROL, not implicit actor memory authority. */
  stop(supervisor) {
    supervisor = principal(supervisor);
    ensure(same(supervisor, this.#supervisor), 'only supervisor may issue STOP');
    ensure(!this.#reclaimed, 'already reclaimed');
    this.#stopped = true;
    this.#capabilities.clear();
    for (const ticket of this.#pending) this.#reserved.delete(key(ticket.who));
    this.#pending = [];
  }

  physicallyQuiescent() {
    return this.#stopped && this.#active.size === 0 &&
      this.#pending.length === 0 && !this.#activeActorTurn &&
      this.#reserved.size === 0;
  }

  reclaim(supervisor) {
    supervisor = principal(supervisor);
    ensure(same(supervisor, this.#supervisor), 'only supervisor may reclaim');
    ensure(this.physicallyQuiescent(), 'cannot reclaim while physical loans or turns live');
    this.#reclaimed = true;
    this.#owner = null;
  }

  restart(supervisor) {
    supervisor = principal(supervisor);
    ensure(same(supervisor, this.#supervisor) && this.#reclaimed,
      'restart requires supervisor and prior physical reclamation');
    ensure(this.#generation < Number.MAX_SAFE_INTEGER, 'actor generation exhausted');
    ensure(this.#ownerEpoch < Number.MAX_SAFE_INTEGER, 'owner epoch exhausted');
    this.#generation++;
    this.#ownerEpoch++;
    this.#stopped = false;
    this.#reclaimed = false;
    this.#owner = this.#mintOwner(this.#actor);
    return this.#owner;
  }
}
