/**
 * Source-free, local-only pg model. Trusted host fixture identities only;
 * this module is never a guest authorization API or distributed membership.
 */
const fail = message => { throw new Error("PG_REF_DENIED: " + message); };
const ensure = (condition, message) => { if (!condition) fail(message); };
const validId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
const validGen = value => Number.isSafeInteger(value) && value > 0;

export class PgLocalReference {
  #runtime;
  #isolate;
  #registryId = Symbol('pg-registry-incarnation');
  #groups = new Map();
  #actors = new Map();
  #permissions = new Map();
  #nextIdentity = 1;
  #maxGroups;
  #maxGroupsPerActor;

  constructor({ runtime, isolate, maxGroups = 16, maxGroupsPerActor = 8 }) {
    ensure(validId(runtime) && validId(isolate), 'runtime/isolate identity');
    ensure(Number.isSafeInteger(maxGroups) && maxGroups > 0 && maxGroups <= 4096, 'group quota');
    ensure(Number.isSafeInteger(maxGroupsPerActor) && maxGroupsPerActor > 0 && maxGroupsPerActor <= 4096, 'actor group quota');
    this.#runtime = runtime;
    this.#isolate = isolate;
    this.#maxGroups = maxGroups;
    this.#maxGroupsPerActor = maxGroupsPerActor;
  }
  #serial() {
    ensure(this.#nextIdentity < Number.MAX_SAFE_INTEGER, 'incarnation exhausted');
    return this.#nextIdentity++;
  }
  #actor({runtime, isolate, actor, generation}) {
    ensure(runtime === this.#runtime && isolate === this.#isolate, 'cross-isolate actor');
    ensure(validId(actor) && validGen(generation), 'actor incarnation');
    return actor + ':' + generation;
  }
  #active(identity) {
    const key = this.#actor(identity);
    const registered = this.#actors.get(identity.actor);
    ensure(registered && registered.generation === identity.generation, 'stale/unregistered actor');
    return {key, registered};
  }
  registerActor(identity) {
    const key = this.#actor(identity);
    ensure(!this.#actors.has(identity.actor), 'duplicate actor ID');
    this.#actors.set(identity.actor, {generation: identity.generation, groups:new Set()});
    return key;
  }
  retireActor(identity) {
    const {registered, key} = this.#active(identity);
    for (const groupId of registered.groups) this.#groups.get(groupId)?.members.delete(key);
    this.#actors.delete(identity.actor);
  }
  #permit(group) {
    const cap = Object.freeze({kind:'local-pg-join'});
    this.#permissions.set(cap, {id:group.id, incarnation:group.incarnation, epoch:group.epoch});
    return cap;
  }
  createGroup(id, maxMembers) {
    ensure(validId(id) && !this.#groups.has(id), 'duplicate or invalid group');
    ensure(this.#groups.size < this.#maxGroups, 'group quota exceeded');
    ensure(Number.isSafeInteger(maxMembers) && maxMembers > 0 && maxMembers <= 4096, 'member quota');
    const group = {id, incarnation:this.#serial(), epoch:this.#serial(), maxMembers, members:new Set()};
    this.#groups.set(id, group);
    return this.#permit(group);
  }
  #groupFor(capability) {
    const p = this.#permissions.get(capability);
    ensure(p, 'forged/revoked permit');
    const g = this.#groups.get(p.id);
    ensure(g && g.incarnation === p.incarnation && g.epoch === p.epoch, 'stale group permit');
    return g;
  }
  rotateJoin(capability) {
    const g = this.#groupFor(capability);
    g.epoch = this.#serial();
    this.#permissions.delete(capability);
    return this.#permit(g);
  }
  join(capability, identity) {
    const g = this.#groupFor(capability);
    const {key, registered} = this.#active(identity);
    if (g.members.has(key)) return false;
    ensure(registered.groups.size < this.#maxGroupsPerActor, 'actor membership quota');
    ensure(g.members.size < g.maxMembers, 'group membership quota');
    g.members.add(key);
    registered.groups.add(g.id);
    return true;
  }
  leave(id, identity) {
    const g = this.#groups.get(id);
    const {key, registered} = this.#active(identity);
    if (!g || !g.members.delete(key)) return false;
    registered.groups.delete(id);
    return true;
  }
  closeGroup(id) {
    const g = this.#groups.get(id);
    if (!g) return false;
    for (const member of g.members) {
      const actorId = member.slice(0, member.lastIndexOf(':'));
      this.#actors.get(actorId)?.groups.delete(id);
    }
    this.#groups.delete(id);
    // Revoked permits must not accumulate through repeated room turnover.
    for (const [cap, binding] of this.#permissions)
      if (binding.id === id && binding.incarnation === g.incarnation)
        this.#permissions.delete(cap);
    return true;
  }
  snapshot(id, limit) {
    const g = this.#groups.get(id);
    if (!g) return Object.freeze({status:'GROUP_MISSING',members:Object.freeze([])});
    ensure(Number.isSafeInteger(limit) && limit >= 0, 'snapshot limit');
    if (limit === 0 || g.members.size > limit)
      return Object.freeze({status:'RECIPIENT_LIMIT',members:Object.freeze([])});
    return Object.freeze({status:'OK',runtime:this.#runtime,isolate:this.#isolate,
      group:id,incarnation:g.incarnation,registry:this.#registryId,
      members:Object.freeze([...g.members])});
  }
  isLiveMember(snapshot, member) {
    if (!snapshot || snapshot.status !== 'OK' || snapshot.runtime !== this.#runtime ||
        snapshot.isolate !== this.#isolate || snapshot.registry !== this.#registryId) return false;
    const g = this.#groups.get(snapshot.group);
    return !!g && g.incarnation === snapshot.incarnation &&
      snapshot.members.includes(member) && g.members.has(member);
  }
  broadcast(id, limit, deliver) {
    ensure(typeof deliver === 'function', 'trusted mailbox adapter required');
    const snap = this.snapshot(id,limit);
    if (snap.status !== 'OK') return Object.freeze({status:snap.status,accepted:0,rejected:0,stale:0,snapshotCount:0});
    let accepted=0, rejected=0, stale=0;
    for (const actor of snap.members) {
      if (!this.isLiveMember(snap,actor)) {++stale;continue;}
      // A real runtime checks the authenticated actor generation, STOP,
      // isolate and mailbox quotas in this callback; this model cannot.
      let result=false;
      try { result=deliver(actor); } catch {result=false;}
      if (result === true) ++accepted;
      else ++rejected;
    }
    return Object.freeze({status:'OK',accepted,rejected,stale,snapshotCount:snap.members.length});
  }
  inspectHost() {return Object.freeze({groups:this.#groups.size,actors:this.#actors.size,
    outstandingPermits:this.#permissions.size});}
  status() {return Object.freeze({sourceGuestImplemented:false,clusterPgImplemented:false});}
}
