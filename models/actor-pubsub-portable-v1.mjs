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
  constructor({maxTopics=1024,maxSubscriptions=1024}={}) {
    if (!Number.isSafeInteger(maxTopics) || maxTopics<1 ||
        !Number.isSafeInteger(maxSubscriptions) || maxSubscriptions<1)
      throw new RangeError("positive finite quotas required");
    this.maxTopics=maxTopics;
    this.maxSubscriptions=maxSubscriptions;
    this.topics=new Map(); this.groups=new Map(); this.actors=new Map();
    this.subscriptions=new Map(); this.memberships=new Map();
    this.topicSeq=new Map(); this.nextSub=0; this.nextMembership=0;
    this.closed=false;
  }

  actor(id, generation=1) {
    if (this.closed) return failure("Closed");
    const key=`${id}#${generation}`;
    if (this.actors.has(key)) return failure("AlreadyExists");
    const actor={key,id,generation,alive:true};
    this.actors.set(key,actor);
    return success({actor});
  }

  group(id) {
    if (this.closed) return failure("Closed");
    if (this.groups.has(id)) return failure("AlreadyExists");
    const group={id,closed:false,members:new Set()};
    this.groups.set(id,group);
    return success({group});
  }

  topic(name,type) {
    if (this.closed) return failure("Closed");
    if (!topicName(name)) return failure("InvalidName");
    if (typeof type!=="string" || !type) return failure("InvalidType");
    const existing=this.topics.get(name);
    if (existing && existing.type!==type) return failure("TopicTypeMismatch");
    if (!existing && this.topics.size>=this.maxTopics) return failure("ResourceExhausted");
    if (!existing) { this.topics.set(name,{name,type}); this.topicSeq.set(name,0n); }
    return success({topic:this.topics.get(name)});
  }

  join(group,actor) {
    if (this.closed) return failure("Closed");
    if (!this.isGroup(group) || !this.isActor(actor)) return failure("StaleTarget");
    if (group.members.has(actor.key)) return failure("AlreadyMember");
    group.members.add(actor.key);
    const membership={id:++this.nextMembership,group,actor,active:true};
    this.memberships.set(membership.id,membership);
    return success({membership});
  }

  leave(membership) {
    if (!membership || this.memberships.get(membership.id)!==membership ||
        !membership.active) return failure("StaleMembership");
    membership.active=false;
    membership.group.members.delete(membership.actor.key);
    this.cancelTarget(membership.actor.key,s=>s.kind==="group" && s.target===membership.group);
    return success();
  }

  subscribe(topic,kind,target,capacity=32) {
    if (this.closed) return failure("Closed");
    if (this.topics.get(topic?.name)!==topic) return failure("UnknownTopic");
    if (!Number.isSafeInteger(capacity) || capacity<1) return failure("InvalidCapacity");
    if (kind==="actor" ? !this.isActor(target) : kind==="group" ? !this.isGroup(target) : true)
      return failure("StaleTarget");
    if ([...this.subscriptions.values()].filter(s=>!s.closed).length>=this.maxSubscriptions)
      return failure("ResourceExhausted");
    const sub={id:++this.nextSub,topic,kind,target,capacity,
      closed:false,queues:new Map(),inflight:new Map()};
    this.subscriptions.set(sub.id,sub);
    return success({subscription:sub});
  }

  tryPublish(topic,payload) {
    if (this.closed) return failure("Closed");
    if (this.topics.get(topic?.name)!==topic) return failure("UnknownTopic");
    if (!this.isShared(payload)) return failure("NotShared");
    const slots=[];
    for (const sub of this.subscriptions.values()) {
      if (sub.closed || sub.topic!==topic) continue;
      const keys=sub.kind==="actor" ? [sub.target.key] : [...sub.target.members].sort();
      for (const key of keys) {
        const actor=this.actors.get(key);
        if (!active(actor)) continue;
        const queued=sub.queues.get(key)?.length ?? 0;
        const running=sub.inflight.get(key) ?? 0;
        if (queued+running >= sub.capacity) return failure("Full");
        slots.push({sub,key});
      }
    }
    const old=this.topicSeq.get(topic.name);
    if (old===0xffffffffffffffffn) return failure("SequenceExhausted");
    const seq=old+1n;
    this.topicSeq.set(topic.name,seq);
    for (const {sub,key} of slots) {
      if (!sub.queues.has(key)) sub.queues.set(key,[]);
      sub.queues.get(key).push({sequence:seq,topic:topic.name,
        subscription_id:sub.id,payload});
    }
    return success({receipt:{sequence:seq.toString(),recipients:slots.length}});
  }

  start(subscription,actor) {
    if (!this.isSub(subscription) || subscription.closed) return failure("Closed");
    if (!this.isActor(actor)) return failure("StaleActor");
    const queue=subscription.queues.get(actor.key);
    if (!queue?.length) return failure("Empty");
    const delivery=queue.shift();
    subscription.inflight.set(actor.key,(subscription.inflight.get(actor.key)??0)+1);
    return success({delivery});
  }

  finish(subscription,actor) {
    if (!this.isSub(subscription) || this.actors.get(actor?.key)!==actor)
      return failure("StaleTarget");
    const count=subscription.inflight.get(actor.key)??0;
    if (!count) return failure("NoInFlight");
    if (count===1) subscription.inflight.delete(actor.key);
    else subscription.inflight.set(actor.key,count-1);
    return success();
  }

  unsubscribe(subscription) {
    if (!this.isSub(subscription)) return failure("StaleSubscription");
    if (!subscription.closed) { subscription.closed=true; subscription.queues.clear(); }
    return success({done:this.done(subscription)});
  }

  done(subscription) {
    if (!this.isSub(subscription)) return false;
    return subscription.closed && [...subscription.inflight.values()].every(n=>n===0);
  }

  stopActor(actor) {
    if (!this.isActor(actor)) return failure("StaleActor");
    actor.alive=false;
    for (const m of this.memberships.values())
      if (m.active && m.actor===actor) { m.active=false; m.group.members.delete(actor.key); }
    this.cancelTarget(actor.key,()=>true);
    for (const sub of this.subscriptions.values())
      if (sub.kind==="actor" && sub.target===actor) this.unsubscribe(sub);
    return success();
  }

  closeGroup(group) {
    if (!this.isGroup(group)) return failure("StaleGroup");
    group.closed=true;
    for (const m of this.memberships.values())
      if (m.active && m.group===group) { m.active=false; group.members.delete(m.actor.key); }
    for (const sub of this.subscriptions.values())
      if (sub.kind==="group" && sub.target===group) this.unsubscribe(sub);
    return success();
  }

  close() {
    if (this.closed) return success();
    this.closed=true;
    for (const sub of this.subscriptions.values()) this.unsubscribe(sub);
    for (const group of this.groups.values()) group.closed=true;
    for (const membership of this.memberships.values()) membership.active=false;
    for (const group of this.groups.values()) group.members.clear();
    return success();
  }

  cancelTarget(key,predicate) {
    for (const sub of this.subscriptions.values())
      if (predicate(sub)) sub.queues.delete(key);
  }

  isActor(actor) { return !!actor && this.actors.get(actor.key)===actor && actor.alive; }
  isGroup(group) { return !!group && this.groups.get(group.id)===group && !group.closed; }
  isSub(sub) { return !!sub && this.subscriptions.get(sub.id)===sub; }
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
