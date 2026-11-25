// A source-free oracle for logical-continuation ownership decisions.
// NOT a guest compiler, runtime mutex, or backend conformance attestation.
export class BorrowViolation extends Error {
  constructor(message) { super(message); this.name = "BorrowViolation"; }
}
export class BorrowOracle {
  constructor() {
    this.principals = new Map();
    this.regions = new Map();
    this.guards = new Map();
    this.activeTurns = new Map();
    this.scopes = new Map();
    this.nextGuard = 0;
  }
  deny(message) { throw new BorrowViolation(message); }
  require(test, message) { if (!test) this.deny(message); }
  principal(id, kind = "task") {
    this.require(!this.principals.has(id), "duplicate principal");
    this.require(kind === "task" || kind === "actor", "unknown principal kind");
    this.principals.set(id, { kind, canceled: false, retired: false, carrier: null, loans: new Map() });
  }
  p(id) {
    const p = this.principals.get(id);
    this.require(p && !p.retired, "unknown or retired principal");
    return p;
  }
  region(id, owner, { immutable = false, send = false, sync = false, actorState = false } = {}) {
    this.require(!this.regions.has(id), "duplicate region");
    const p = this.p(owner);
    this.require(!actorState || p.kind === "actor", "sealed actor state needs actor owner");
    this.regions.set(id, { owner, immutable, send, sync, actorState, generation: 1,
      readonly: new Set(), guarded: new Set(), loans: new Map(),
      readers: new Set(), writer: null });
  }
  r(id) {
    const region = this.regions.get(id);
    this.require(region, "unknown allocation");
    return region;
  }
  turnStart(actor, turnId, carrier) {
    this.require(this.p(actor).kind === "actor", "only an actor owns a mailbox turn");
    this.require(!this.activeTurns.has(actor), "actor turn overlap");
    this.activeTurns.set(actor, turnId);
    this.p(actor).carrier = carrier;
  }
  turnEnd(actor, turnId) {
    this.require(this.activeTurns.get(actor) === turnId, "stale actor turn");
    this.require(![...this.guards.values()].some(g => g.principal === actor), "live guard on turn exit");
    this.activeTurns.delete(actor);
  }
  authority(id, region) {
    const principal = this.p(id);
    this.require(!principal.canceled, "canceled principal");
    if (principal.kind === "actor") this.require(this.activeTurns.has(id), "actor turn not admitted");
    if (region.actorState && region.owner !== id) this.deny("sealed actor state cannot be inherited");
    return principal;
  }
  move(regionId, from, to, expectedGeneration) {
    const r = this.r(regionId);
    this.authority(from, r);
    this.p(to);
    this.require(r.owner === from && r.send, "no owned Send authority");
    this.require(r.generation === expectedGeneration, "stale generation");
    this.require(!r.loans.size && !r.readers.size && !r.writer, "live loan or guard");
    this.require(!r.readonly.size && !r.guarded.size, "shared region cannot be moved");
    this.require(!r.actorState, "actor private state is not transferable");
    r.owner = to;
    r.generation++;
    return r.generation;
  }
  share(regionId, from, to, mode) {
    const r = this.r(regionId);
    this.authority(from, r);
    this.p(to);
    this.require(r.owner === from && !r.actorState, "no shared ownership authority");
    this.require(!r.loans.size && !r.readers.size && !r.writer, "outstanding region access");
    if (mode === "read") {
      this.require(r.immutable && r.sync && !r.guarded.size,
        "immutable Sync backing proof and no guarded writers required");
      r.readonly.add(to);
    } else if (mode === "guarded") {
      this.require(r.send && r.sync, "synchronized Send+Sync region required");
      this.require(!r.immutable && !r.readonly.size,
        "guarded mutable region cannot mix with readonly publication");
      r.guarded.add(from);
      r.guarded.add(to);
    } else this.deny("unknown share mode");
  }
  openScope(owner, scopeId) {
    this.p(owner);
    this.require(typeof scopeId === "string" && scopeId.length > 0 && !this.scopes.has(scopeId),
      "new exact TaskScope identity required");
    this.scopes.set(scopeId, {owner, open:true, children:new Set()});
  }
  sealScope(owner, scopeId) {
    const scope = this.scopes.get(scopeId);
    this.require(scope && scope.owner === owner, "foreign TaskScope");
    scope.open = false;
    return this.scopeQuiescent(scopeId);
  }
  scopeQuiescent(scopeId) {
    const scope = this.scopes.get(scopeId);
    this.require(scope, "unknown TaskScope");
    return [...scope.children].every(child => this.principals.get(child)?.retired === true);
  }
  scopedRead(regionId, owner, child, scopeId) {
    const r = this.r(regionId);
    this.authority(owner, r);
    const task = this.p(child);
    this.require(task.kind === "task", "scoped child must be a Task");
    this.require(r.owner === owner && !r.actorState && r.sync, "owned Sync referent required");
    this.require(!r.writer && !r.readers.size && !r.guarded.size, "conflicting or guarded region");
    const scope = this.scopes.get(scopeId);
    this.require(scope && scope.owner === owner && scope.open,
      "registered live lexical TaskScope required");
    this.require(!r.loans.has(child), "duplicate scoped loan");
    scope.children.add(child);
    r.loans.set(child, { scopeId, generation: r.generation });
    task.loans.set(regionId, { scopeId, generation: r.generation });
  }
  cancel(id) { this.p(id).canceled = true; } // cancellation request != physical retirement
  retire(id) {
    const p = this.p(id);
    this.require(![...this.guards.values()].some(g => g.principal === id), "retire with live guard");
    for (const [regionId, loan] of p.loans) {
      const r = this.r(regionId);
      this.require(r.loans.get(id)?.generation === loan.generation, "loan lifetime corrupted");
      r.loans.delete(id);
    }
    p.loans.clear();
    p.retired = true;
  }
  use(id, regionId, mode) {
    const r = this.r(regionId);
    const p = this.authority(id, r);
    this.require(mode === "read" || mode === "write", "invalid access mode");
    const guard = [...this.guards.values()].find(g => g.principal === id && g.regionId === regionId);
    if (guard) {
      this.require(guard.mode === "write" || mode === "read", "write under read guard");
      return "GUARDED";
    }
    if (r.owner === id) {
      this.require(mode !== "write" || !r.immutable, "immutable backing cannot be written");
      this.require(!r.guarded.size, "shared mutable region requires critical guard");
      this.require(mode === "read" || (!r.loans.size && !r.readonly.size), "write conflicts with live read loan");
      return "LOCK_FREE";
    }
    if (mode === "read" && r.readonly.has(id) && r.immutable && r.sync) return "LOCK_FREE";
    const loan = p.loans.get(regionId);
    if (mode === "read" && loan && r.loans.get(id)?.generation === r.generation) return "SCOPED_READ";
    this.deny("no access capability; carrier thread or actor ancestry grants nothing");
  }
  enterCritical(id, regionId, mode) {
    const r = this.r(regionId);
    this.authority(id, r);
    this.require(mode === "read" || mode === "write", "invalid guard mode");
    this.require(r.guarded.has(id), "no explicit synchronized handle");
    this.require(![...this.guards.values()].some(g => g.principal === id && g.regionId === regionId),
      "nested critical/upgrade fails closed");
    if (mode === "read") this.require(!r.writer, "writer active");
    else this.require(!r.writer && !r.readers.size, "reader/writer active");
    const ticket = "logical-guard-" + (++this.nextGuard);
    if (mode === "read") r.readers.add(ticket);
    else r.writer = ticket;
    this.guards.set(ticket, { principal: id, regionId, mode });
    return ticket;
  }
  exitCritical(id, ticket) {
    const guard = this.guards.get(ticket);
    this.require(guard && guard.principal === id, "foreign or released guard");
    const r = this.r(guard.regionId);
    if (guard.mode === "read") this.require(r.readers.delete(ticket), "reader ticket missing");
    else {
      this.require(r.writer === ticket, "writer ticket mismatch");
      r.writer = null;
    }
    this.guards.delete(ticket);
  }
  suspend(id) {
    this.p(id);
    this.require(![...this.guards.values()].some(g => g.principal === id),
      "guard cannot cross suspension or scheduler safepoint");
  }
  migrateCarrier(id, carrier) {
    this.suspend(id);
    this.p(id).carrier = carrier; // carrier is never an authorization key
  }
}
