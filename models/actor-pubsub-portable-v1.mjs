// Deterministic, single-threaded reference oracle for actor-pubsub.portable.v1.
// This is NOT an Oreslang runtime or proof of concurrent linearizability.
const failure = (error) => ({ok:false,error});
const success = (value={}) => ({ok:true,...value});
const topicName = (s) => typeof s === "string" && /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/.test(s);
const active = (a) => a && a.alive;
const safeKeys = (value) => {
  if (!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null) return null;
  const keys=Reflect.ownKeys(value);
  if (keys.some(k=>typeof k!=="string" ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),"value"))) return null;
  return keys;
};

export function share(value) {
  // Repeated immutable references are valid DAG edges, not cycles.
  // Track the active recursion path separately from completed objects.
  const visiting=new Set(), checked=new Set();
  function freeze(v) {
    if (v === null) return v;
    if (typeof v !== "object") {
      // Helpers must never bless an executable/symbol payload, even when
      // publication independently performs a second MessageData check.
      if (typeof v === "function" || typeof v === "symbol")
        throw new TypeError("non-Sendable shared payload");
      return v;
    }
    if (visiting.has(v)) throw new TypeError("cyclic shared payload");
    if (checked.has(v)) return v;
    const keys=safeKeys(v);
    if (!keys) throw new TypeError("non-Sendable shared payload");
    visiting.add(v);
    try {
      for (const key of keys) freeze(Object.getOwnPropertyDescriptor(v,key).value);
      Object.freeze(v);
      checked.add(v);
      return v;
    } finally {
      visiting.delete(v);
    }
  }
  return freeze(value);
}

export class PubSubReference {
  #topics=new Map();
  #groups=new Map();
  #actors=new Map();
  #subscriptions=new Map();
  #memberships=new Map();
  #topicSeq=new Map();
  #actorStates=new WeakMap();
  #groupStates=new WeakMap();
  #subscriptionStates=new WeakMap();
  #nextSub=0;
  #nextMembership=0;
  #closed=false;

  get closed() {return this.#closed;}
  get membershipCount() {return this.#memberships.size;}

  // Introspection returns a detached copy, not an authority registry.
  get subscriptionCount() {
    return [...this.#subscriptions.values()].filter(s=>!s.closed).length;
  }

  constructor({maxTopics=1024,maxSubscriptions=1024,maxMemberships=4096}={}) {
    if (!Number.isSafeInteger(maxTopics) || maxTopics<1 ||
        !Number.isSafeInteger(maxSubscriptions) || maxSubscriptions<1 ||
        !Number.isSafeInteger(maxMemberships) || maxMemberships<1)
      throw new RangeError("positive finite quotas required");
    this.maxTopics=maxTopics;
    this.maxSubscriptions=maxSubscriptions;
    this.maxMemberships=maxMemberships;
    Object.freeze(this);
  }

  actor(id, generation=1) {
    if (this.closed) return failure("Closed");
    // Encode identity components injectively: delimiter concatenation can
    // alias (id="tenant#1", generation=2) with other malformed identities.
    // A generation must be an actual positive integer, never a string.
    if (typeof id!=="string" || id.length===0 || id.length>256 ||
        !Number.isSafeInteger(generation) || generation<1)
      return failure("InvalidActorIdentity");
    const key=JSON.stringify([id,generation]);
    if (this.#actors.has(key)) return failure("AlreadyExists");
    const state={alive:true};
    const actor=Object.freeze({key,id,generation,get alive(){return state.alive;}});
    this.#actorStates.set(actor,state);
    this.#actors.set(key,actor);
    return success({actor});
  }

  group(id) {
    if (this.closed) return failure("Closed");
    if (typeof id!=="string" || !id.length || id.length>256)
      return failure("InvalidGroup");
    if (this.#groups.has(id)) return failure("AlreadyExists");
    const state={closed:false,members:new Set()};
    // A copied membership view never exposes the authoritative set.
    const group=Object.freeze({
      id,get closed(){return state.closed;},
      get members(){return new Set(state.members);}
    });
    this.#groupStates.set(group,state);
    this.#groups.set(id,group);
    return success({group});
  }

  topic(name,type,group=null) {
    if (this.closed) return failure("Closed");
    if (!topicName(name)) return failure("InvalidName");
    if (typeof type!=="string" || !type) return failure("InvalidType");
    if (group!==null && !this.isGroup(group)) return failure("StaleGroup");
    // The original PS001-PS020 broker-global topics remain a legacy oracle.
    // Group-scoped topics cannot alias either those or another group.
    const key=group===null ? name : JSON.stringify(["group",group.id,name]);
    const existing=this.#topics.get(key);
    if (existing && existing.type!==type) return failure("TopicTypeMismatch");
    if (!existing && this.#topics.size>=this.maxTopics) return failure("ResourceExhausted");
    if (!existing) {
      this.#topics.set(key,Object.freeze({key,name,type,group}));
      this.#topicSeq.set(key,0n);
    }
    return success({topic:this.#topics.get(key)});
  }

  topicInGroup(group,name,type) { return this.topic(name,type,group); }

  activeMembership(group,actor) {
    for (const entry of this.#memberships.values())
      if (entry.active && entry.capability.group===group && entry.capability.actor===actor)
        return true;
    return false;
  }

  authorizedPublisher(topic,grant) {
    const entry=this.#memberships.get(grant?.id);
    return !!entry && entry.capability===grant && entry.active &&
      grant.group===topic.group && this.isGroup(grant.group) &&
      this.isActor(grant.actor);
  }

  join(group,actor) {
    if (this.closed) return failure("Closed");
    if (!this.isGroup(group) || !this.isActor(actor)) return failure("StaleTarget");
    // The immutable grant is a capability; public members Set is only a view.
    if (this.activeMembership(group,actor)) return success({alreadyMember:true});
    if (this.#memberships.size>=this.maxMemberships ||
        this.#nextMembership>=Number.MAX_SAFE_INTEGER)
      return failure("ResourceExhausted");
    this.#groupStates.get(group).members.add(actor.key);
    const membership=Object.freeze({id:++this.#nextMembership,group,actor});
    this.#memberships.set(membership.id,{capability:membership,active:true});
    return success({membership});
  }

  leave(membership) {
    const entry=this.#memberships.get(membership?.id);
    if (!entry || entry.capability!==membership || !entry.active)
      return failure("StaleMembership");
    entry.active=false;
    this.#memberships.delete(membership.id);
    this.#groupStates.get(membership.group).members.delete(membership.actor.key);
    this.cancelTarget(membership.actor.key,s=>s.kind==="group" && s.target===membership.group);
    // A group-bound direct subscription cannot survive a leave/rejoin.
    for (const sub of this.#subscriptions.values())
      if (!sub.closed && sub.topic.group===membership.group &&
          sub.kind==="actor" && sub.target===membership.actor)
        this.unsubscribe(sub);
    return success();
  }

  subscribe(topic,kind,target,capacity=32) {
    if (this.closed) return failure("Closed");
    if (this.#topics.get(topic?.key ?? topic?.name)!==topic) return failure("UnknownTopic");
    if (!Number.isSafeInteger(capacity) || capacity<1) return failure("InvalidCapacity");
    if (kind==="actor" ? !this.isActor(target) : kind==="group" ? !this.isGroup(target) : true)
      return failure("StaleTarget");
    if (topic.group!==null && (kind==="actor"
      ? !this.activeMembership(topic.group,target)
      : target!==topic.group)) return failure("UnauthorizedSubscriber");
    // A live (topic, target) edge is unique. Calling subscribe twice must
    // not mint a second registration or consume another quota. Capacity
    // changes require an explicit unsubscribe and fresh registration.
    for (const existing of this.#subscriptions.values()) {
      if (!existing.closed && existing.topic===topic &&
          existing.kind===kind && existing.target===target) {
        if (existing.capacity!==capacity) return failure("SubscriptionConflict");
        return success({subscription:existing,alreadySubscribed:true});
      }
    }
    if (this.#subscriptions.size>=this.maxSubscriptions ||
        this.#nextSub>=Number.MAX_SAFE_INTEGER)
      return failure("ResourceExhausted");
    const state={closed:false,queues:new Map(),inflight:new Map()};
    const sub=Object.freeze({
      id:++this.#nextSub,topic,kind,target,capacity,
      get closed(){return state.closed;}
    });
    this.#subscriptionStates.set(sub,state);
    this.#subscriptions.set(sub.id,sub);
    return success({subscription:sub});
  }

  tryPublish(topic,payload,publisherGrant=null) {
    if (this.closed) return failure("Closed");
    if (this.#topics.get(topic?.key ?? topic?.name)!==topic) return failure("UnknownTopic");
    if (topic.group!==null && !this.authorizedPublisher(topic,publisherGrant))
      return failure("UnauthorizedPublisher");
    if (!this.isShared(payload)) return failure("NotShared");
    const slots=[];
    for (const sub of this.#subscriptions.values()) {
      if (sub.closed || sub.topic!==topic) continue;
      const keys=sub.kind==="actor" ? [sub.target.key] : [...this.#memberships.values()]
        .filter(m=>m.active && m.capability.group===sub.target &&
          this.isActor(m.capability.actor))
        .map(m=>m.capability.actor.key).sort();
      for (const key of keys) {
        const actor=this.#actors.get(key);
        if (!active(actor)) continue;
        const queued=this.#subscriptionStates.get(sub).queues.get(key)?.length ?? 0;
        const running=this.#subscriptionStates.get(sub).inflight.get(key) ?? 0;
        if (queued+running >= sub.capacity) return failure("Full");
        slots.push({sub,key});
      }
    }
    const old=this.#topicSeq.get(topic.key ?? topic.name);
    if (old===0xffffffffffffffffn) return failure("SequenceExhausted");
    const seq=old+1n;
    this.#topicSeq.set(topic.key ?? topic.name,seq);
    for (const {sub,key} of slots) {
      if (!this.#subscriptionStates.get(sub).queues.has(key)) this.#subscriptionStates.get(sub).queues.set(key,[]);
      this.#subscriptionStates.get(sub).queues.get(key).push({sequence:seq,topic:topic.name,
        subscription_id:sub.id,payload});
    }
    return success({receipt:{sequence:seq.toString(),recipients:slots.length}});
  }

  start(subscription,actor) {
    if (!this.isSub(subscription) || subscription.closed) return failure("Closed");
    if (!this.isActor(actor)) return failure("StaleActor");
    if (subscription.topic.group!==null &&
        !this.activeMembership(subscription.topic.group,actor))
      return failure("UnauthorizedSubscriber");
    const queue=this.#subscriptionStates.get(subscription).queues.get(actor.key);
    if (!queue?.length) return failure("Empty");
    const delivery=queue.shift();
    this.#subscriptionStates.get(subscription).inflight.set(actor.key,(this.#subscriptionStates.get(subscription).inflight.get(actor.key)??0)+1);
    return success({delivery});
  }

  finish(subscription,actor) {
    if (!this.isSub(subscription) || this.#actors.get(actor?.key)!==actor)
      return failure("StaleTarget");
    const count=this.#subscriptionStates.get(subscription).inflight.get(actor.key)??0;
    if (!count) return failure("NoInFlight");
    if (count===1) this.#subscriptionStates.get(subscription).inflight.delete(actor.key);
    else this.#subscriptionStates.get(subscription).inflight.set(actor.key,count-1);
    return success();
  }

  unsubscribe(subscription) {
    if (!this.isSub(subscription)) return failure("StaleSubscription");
    if (!subscription.closed) {
      const state=this.#subscriptionStates.get(subscription);
      state.closed=true;
      state.queues.clear();
      // Weak-held retired handles continue to support finish()/done() and
      // reject start(), without growing the active-subscription registry.
      this.#subscriptions.delete(subscription.id);
    }
    return success({done:this.done(subscription)});
  }

  done(subscription) {
    if (!this.isSub(subscription)) return false;
    return subscription.closed && [...this.#subscriptionStates.get(subscription).inflight.values()].every(n=>n===0);
  }

  stopActor(actor) {
    if (!this.isActor(actor)) return failure("StaleActor");
    this.#actorStates.get(actor).alive=false;
    for (const [id,m] of this.#memberships)
      if (m.active && m.capability.actor===actor) {
        m.active=false;
        this.#memberships.delete(id);
        this.#groupStates.get(m.capability.group).members.delete(actor.key);
      }
    this.cancelTarget(actor.key,()=>true);
    for (const sub of this.#subscriptions.values())
      if (sub.kind==="actor" && sub.target===actor) this.unsubscribe(sub);
    return success();
  }

  closeGroup(group) {
    if (!this.isGroup(group)) return failure("StaleGroup");
    this.#groupStates.get(group).closed=true;
    for (const [id,m] of this.#memberships)
      if (m.active && m.capability.group===group) {
        m.active=false;
        this.#memberships.delete(id);
        this.#groupStates.get(group).members.delete(m.capability.actor.key);
      }
    for (const sub of this.#subscriptions.values())
      if ((sub.kind==="group" && sub.target===group) || sub.topic.group===group)
        this.unsubscribe(sub);
    return success();
  }

  close() {
    if (this.closed) return success();
    this.#closed=true;
    for (const sub of this.#subscriptions.values()) this.unsubscribe(sub);
    for (const group of this.#groups.values()) this.#groupStates.get(group).closed=true;
    this.#memberships.clear();
    for (const group of this.#groups.values()) this.#groupStates.get(group).members.clear();
    return success();
  }

  cancelTarget(key,predicate) {
    for (const sub of this.#subscriptions.values())
      if (predicate(sub)) this.#subscriptionStates.get(sub).queues.delete(key);
  }

  isActor(actor) { return !!actor && this.#actors.get(actor.key)===actor && actor.alive; }
  isGroup(group) { return !!group && this.#groups.get(group.id)===group && !group.closed; }
  isSub(sub) { return !!sub && this.#subscriptionStates.has(sub); }
  isShared(v) {
    // A frozen DAG is Sendable even when two fields reference the same child.
    // Reject back-edges to the current stack (true cycles).
    const visiting=new Set(), checked=new Set();
    function check(x) {
      if (x===null || typeof x!=="object") return typeof x!=="function" && typeof x!=="symbol";
      if (visiting.has(x)) return false;
      if (checked.has(x)) return true;
      if (!Object.isFrozen(x)) return false;
      const keys=safeKeys(x);
      if (!keys) return false;
      visiting.add(x);
      try {
        if (!keys.every(k=>check(Object.getOwnPropertyDescriptor(x,k).value))) return false;
        checked.add(x);
        return true;
      } finally {
        visiting.delete(x);
      }
    }
    return check(v);
  }
}
