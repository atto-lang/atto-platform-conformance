import {types as nodeTypes} from "node:util";

// Deterministic, single-threaded reference oracle for actor-pubsub.portable.v1.
// This is NOT an Oreslang runtime or proof of concurrent linearizability.
const NON_DATA_CAPABILITIES = new WeakSet();
// Deterministic reference-oracle resource limits; production runtimes must
// enforce equivalent bounded admission with their own configured quotas.
const SHARED_GRAPH_MAX_DEPTH = 128;
const SHARED_GRAPH_MAX_NODES = 4096;
const SHARED_GRAPH_MAX_EDGES = 16384;
const failure = (error) => ({ok:false,error});
const success = (value={}) => ({ok:true,...value});
const topicName = (s) => typeof s === "string" && /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/.test(s);
const active = (a) => a && a.alive;
const TOPIC_POLICIES = new Set(["RELIABLE","LATEST","LOSSY"]);
const safeKeys = (value) => {
  // A Proxy can execute arbitrary user callbacks during getPrototypeOf,
  // ownKeys, descriptor inspection, or freeze. Never inspect its traps.
  if (nodeTypes.isProxy(value)) return null;
  // Native internal slots remain mutable even when the visible prototype is
  // replaced with Object.prototype and Object.freeze reports true. Brand
  // checks use Node's native predicates without invoking user-defined tags.
  // This is a reference-oracle guard, not an untrusted-guest security boundary:
  // arbitrary user classes with private fields still require runtime fencing.
  if (nodeTypes.isDate(value) || nodeTypes.isMap(value) ||
      nodeTypes.isSet(value) || nodeTypes.isWeakMap(value) ||
      nodeTypes.isWeakSet(value) || nodeTypes.isRegExp(value) ||
      nodeTypes.isPromise(value) || nodeTypes.isAnyArrayBuffer(value) ||
      nodeTypes.isArrayBufferView(value) || nodeTypes.isBoxedPrimitive(value) ||
      nodeTypes.isNativeError(value) || nodeTypes.isArgumentsObject(value) ||
      nodeTypes.isExternal(value)) return null;
  const isArray=Array.isArray(value);
  const prototype=Object.getPrototypeOf(value);
  if (isArray ? prototype!==Array.prototype :
      prototype!==Object.prototype && prototype!==null) return null;
  // An enormous sparse array can have only one own key ("length"), and would
  // otherwise bypass the graph edge budget while exposing undefined holes.
  if (isArray && value.length>=SHARED_GRAPH_MAX_EDGES) return null;
  const keys=Reflect.ownKeys(value);
  if (isArray && (keys.length!==value.length+1 ||
      keys[value.length]!=="length" ||
      keys.some((k,i)=>i<value.length && k!==String(i)))) return null;
  if (keys.some(k=>typeof k!=="string" ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),"value"))) return null;
  return keys;
};

export function share(value) {
  // Reject an unsafe graph *before* freezing any of its objects. Otherwise
  // a later callback, Proxy, symbol or cycle leaves earlier siblings frozen
  // even though ownership/share admission failed.
  const visiting=new Set(), checked=new Set(), freezeOrder=[];
  let nodes=0, edges=0;
  function validate(v,depth=0) {
    if (v === null || v === undefined)
      throw new TypeError("pubsub payload uses Option<T>, not null/undefined");
    if (typeof v !== "object") {
      if (typeof v === "function" || typeof v === "symbol")
        throw new TypeError("non-Sendable shared payload");
      return;
    }
    if (depth>SHARED_GRAPH_MAX_DEPTH)
      throw new RangeError("shared payload depth quota exceeded");
    if (NON_DATA_CAPABILITIES.has(v))
      throw new TypeError("non-Sendable pubsub/actor-group capability");
    if (visiting.has(v)) throw new TypeError("cyclic shared payload");
    if (checked.has(v)) return;
    const keys=safeKeys(v);
    if (!keys) throw new TypeError("non-Sendable shared payload");
    if (++nodes>SHARED_GRAPH_MAX_NODES ||
        keys.length>SHARED_GRAPH_MAX_EDGES-edges)
      throw new RangeError("shared payload graph quota exceeded");
    edges+=keys.length;
    visiting.add(v);
    try {
      for (const key of keys) validate(Object.getOwnPropertyDescriptor(v,key).value,depth+1);
      checked.add(v);
      freezeOrder.push(v); // child-first; preserves shared DAG aliases
    } finally {
      visiting.delete(v);
    }
  }
  validate(value);
  // All accepted nodes are ordinary objects/arrays with data properties;
  // no user-supplied getters or Proxy traps execute in this commit phase.
  for (const v of freezeOrder) Object.freeze(v);
  return value;
}

export class PubSubReference {
  #topics=new Map();
  #groups=new Map();
  #actors=new Map();
  #subscriptions=new Map();
  #memberships=new Map();
  #topicSeq=new Map();
  #topicStats=new Map();
  #topicHandles=new WeakSet();
  #grantStates=new WeakMap();
  #actorStates=new WeakMap();
  #groupStates=new WeakMap();
  #subscriptionStates=new WeakMap();
  #groupMonitors=new Map();
  #monitorStates=new WeakMap();
  #nextMonitor=0;
  #nextSub=0;
  #nextMembership=0;
  #closed=false;

  get closed() {return this.#closed;}
  get membershipCount() {return this.#memberships.size;}
  get groupMonitorCount() {return this.#groupMonitors.size;}

  // Introspection returns a detached copy, not an authority registry.
  get subscriptionCount() {
    return [...this.#subscriptions.values()].filter(s=>!s.closed).length;
  }

  constructor({maxActors=4096,maxGroups=1024,maxTopics=1024,maxSubscriptions=1024,maxMemberships=4096,maxGroupMonitors=1024,maxGroupMonitorsPerActor=16,maxGroupMonitorQueueCapacity=256}={}) {
    if (!Number.isSafeInteger(maxActors) || maxActors<1 ||
        !Number.isSafeInteger(maxGroups) || maxGroups<1 ||
        !Number.isSafeInteger(maxTopics) || maxTopics<1 ||
        !Number.isSafeInteger(maxSubscriptions) || maxSubscriptions<1 ||
        !Number.isSafeInteger(maxMemberships) || maxMemberships<1 ||
        !Number.isSafeInteger(maxGroupMonitors) || maxGroupMonitors<1 ||
        !Number.isSafeInteger(maxGroupMonitorsPerActor) || maxGroupMonitorsPerActor<1 ||
        !Number.isSafeInteger(maxGroupMonitorQueueCapacity) || maxGroupMonitorQueueCapacity<1)
      throw new RangeError("positive finite quotas required");
    this.maxActors=maxActors;
    this.maxGroups=maxGroups;
    this.maxTopics=maxTopics;
    this.maxSubscriptions=maxSubscriptions;
    this.maxMemberships=maxMemberships;
    this.maxGroupMonitors=maxGroupMonitors;
    this.maxGroupMonitorsPerActor=maxGroupMonitorsPerActor;
    this.maxGroupMonitorQueueCapacity=maxGroupMonitorQueueCapacity;
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
    // Keep stopped actor identities fenced; a new incarnation must use a fresh
    // generation and may not silently reuse an old queue/authority key.
    if (this.#actors.size>=this.maxActors) return failure("ResourceExhausted");
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
    // Closed group identities are tombstones: never recycle their authority.
    if (this.#groups.size>=this.maxGroups) return failure("ResourceExhausted");
    const state={closed:false,members:new Set(),revision:0n};
    // A copied membership view never exposes the authoritative set.
    const group=Object.freeze({
      id,get closed(){return state.closed;},
      get members(){return new Set(state.members);}
    });
    NON_DATA_CAPABILITIES.add(group);
    this.#groupStates.set(group,state);
    this.#groups.set(id,group);
    return success({group});
  }

  topic(name,type,group=null,policy="RELIABLE") {
    if (this.closed) return failure("Closed");
    if (!topicName(name)) return failure("InvalidName");
    if (typeof type!=="string" || !type) return failure("InvalidType");
    if (!TOPIC_POLICIES.has(policy)) return failure("InvalidPolicy");
    if (group!==null && !this.isGroup(group)) return failure("StaleGroup");
    // Group identity and type stay independent of delivery policy. Changing
    // policy requires a new topic identity, never an implicit in-place edit.
    const key=group===null ? name : JSON.stringify(["group",group.id,name]);
    const existing=this.#topics.get(key);
    if (existing && existing.type!==type) return failure("TopicTypeMismatch");
    if (existing && existing.policy!==policy) return failure("TopicPolicyMismatch");
    if (!existing && this.#topics.size>=this.maxTopics) return failure("ResourceExhausted");
    if (!existing) {
      const topic=Object.freeze({key,name,type,group,policy});
      NON_DATA_CAPABILITIES.add(topic);
      this.#topics.set(key,topic);
      this.#topicHandles.add(topic);
      this.#topicSeq.set(key,0n);
      this.#topicStats.set(key,{published:0n,accepted:0n,dropped:0n,coalesced:0n});
    }
    return success({topic:this.#topics.get(key)});
  }

  topicInGroup(group,name,type,policy="RELIABLE") {
    return this.topic(name,type,group,policy);
  }

  // A detached, read-only diagnostic snapshot is not a subscriber ACK and
  // grants no authority to publish, subscribe, or inspect individual queues.
  topicStats(topic) {
    if (this.closed) return failure("Closed");
    if (!this.#topicHandles.has(topic)) return failure("UnknownTopic");
    if (topic.group!==null && !this.isGroup(topic.group)) return failure("StaleGroup");
    const stats=this.#topicStats.get(topic.key);
    return success({stats:Object.freeze({
      policy:topic.policy,sequence:this.#topicSeq.get(topic.key).toString(),
      published:stats.published.toString(),accepted:stats.accepted.toString(),
      dropped:stats.dropped.toString(),coalesced:stats.coalesced.toString()
    })});
  }

  activeMembership(group,actor) {
    for (const entry of this.#memberships.values())
      if (entry.active && entry.capability.group===group && entry.capability.actor===actor)
        return true;
    return false;
  }

  authorizedPublisher(topic,grant) {
    // WeakMap lookup never invokes a forged grant's id getter/Proxy trap.
    const entry=this.#grantStates.get(grant);
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
    const entry={capability:membership,active:true};
    NON_DATA_CAPABILITIES.add(membership);
    this.#memberships.set(membership.id,entry);
    this.#grantStates.set(membership,entry);
    this.#recordMembershipChange(group,"join",actor);
    return success({membership});
  }

  leave(membership) {
    // Only a genuine grant object can be found; never read untrusted id.
    const entry=this.#grantStates.get(membership);
    if (!entry || entry.capability!==membership || !entry.active)
      return failure("StaleMembership");
    entry.active=false;
    this.#memberships.delete(entry.capability.id);
    this.#groupStates.get(membership.group).members.delete(membership.actor.key);
    this.#revokeOwnerMonitors(membership.group,membership.actor);
    this.#recordMembershipChange(membership.group,"leave",membership.actor);
    this.#cancelTarget(membership.actor.key,s=>s.kind==="group" && s.target===membership.group);
    // A group-bound direct subscription cannot survive a leave/rejoin.
    for (const sub of this.#subscriptions.values())
      if (!sub.closed && sub.topic.group===membership.group &&
          sub.kind==="actor" && sub.target===membership.actor)
        this.unsubscribe(sub);
    return success();
  }

  subscribe(topic,kind,target,capacity=32) {
    if (this.closed) return failure("Closed");
    if (!this.#topicHandles.has(topic)) return failure("UnknownTopic");
    if (!Number.isSafeInteger(capacity) || capacity<1 ||
        (topic.policy==="LATEST" && capacity!==1)) return failure("InvalidCapacity");
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
    NON_DATA_CAPABILITIES.add(sub);
    this.#subscriptionStates.set(sub,state);
    this.#subscriptions.set(sub.id,sub);
    return success({subscription:sub});
  }

  tryPublish(topic,payload,publisherGrant=null) {
    if (this.closed) return failure("Closed");
    if (!this.#topicHandles.has(topic)) return failure("UnknownTopic");
    if (topic.group!==null && !this.authorizedPublisher(topic,publisherGrant))
      return failure("UnauthorizedPublisher");
    if (!this.isShared(payload)) return failure("NotShared");

    // This oracle is single-threaded. Production admission must linearize
    // subscriber enumeration, all RELIABLE reservations, and sequence commit.
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
        const state=this.#subscriptionStates.get(sub);
        const queued=state.queues.get(key)?.length ?? 0;
        const running=state.inflight.get(key) ?? 0;
        // Only RELIABLE rejects globally: never reserve a subset of recipients
        // or consume a sequence on Full. LOSSY drops locally; LATEST replaces
        // a pending unread value and never evicts an in-flight delivery.
        if (topic.policy==="RELIABLE" && queued+running >= sub.capacity)
          return failure("Full");
        slots.push({sub,key,queued,running});
      }
    }

    const old=this.#topicSeq.get(topic.key);
    if (old===0xffffffffffffffffn) return failure("SequenceExhausted");
    const seq=old+1n;
    let accepted=0,dropped=0,coalesced=0;
    for (const {sub,key,queued,running} of slots) {
      const state=this.#subscriptionStates.get(sub);
      if (!state.queues.has(key)) state.queues.set(key,[]);
      const queue=state.queues.get(key);
      if (topic.policy==="LOSSY" && queued+running>=sub.capacity) {
        dropped++;
        continue;
      }
      if (topic.policy==="LATEST" && queued>0) {
        // Topic LATEST requires subscription capacity one. Buffer exactly
        // the newest pending value; any running delivery remains untouched.
        queue.length=0;
        coalesced++;
      }
      queue.push({sequence:seq,topic:topic.name,subscription_id:sub.id,payload});
      accepted++;
    }
    this.#topicSeq.set(topic.key,seq);
    const stats=this.#topicStats.get(topic.key);
    stats.published++;
    stats.accepted+=BigInt(accepted);
    stats.dropped+=BigInt(dropped);
    stats.coalesced+=BigInt(coalesced);
    return success({receipt:{
      sequence:seq.toString(),recipients:slots.length,
      accepted,dropped,coalesced,policy:topic.policy
    }});
  }

  start(subscription,actor) {
    if (!this.isSub(subscription) || subscription.closed) return failure("Closed");
    if (!this.isActor(actor)) return failure("StaleActor");
    if (subscription.topic.group!==null &&
        !this.activeMembership(subscription.topic.group,actor))
      return failure("UnauthorizedSubscriber");
    const state=this.#subscriptionStates.get(subscription);
    const running=state.inflight.get(actor.key) ?? 0;
    // LATEST delivers serially to each recipient. A new pending latest value
    // must not overtake an older event currently being processed.
    if (subscription.topic.policy==="LATEST" && running>0) return failure("Busy");
    const queue=state.queues.get(actor.key);
    if (!queue?.length) return failure("Empty");
    const delivery=queue.shift();
    state.inflight.set(actor.key,running+1);
    return success({delivery});
  }

  finish(subscription,actor) {
    if (!this.isSub(subscription) || !this.#actorStates.has(actor))
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
        this.#revokeOwnerMonitors(m.capability.group,actor);
        this.#recordMembershipChange(m.capability.group,"leave",actor);
      }
    this.#cancelTarget(actor.key,()=>true);
    for (const sub of this.#subscriptions.values())
      if (sub.kind==="actor" && sub.target===actor) this.unsubscribe(sub);
    return success();
  }

  closeGroup(group) {
    if (!this.isGroup(group)) return failure("StaleGroup");
    this.#groupStates.get(group).closed=true;
    this.#revokeGroupMonitors(group);
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
    for (const monitor of [...this.#groupMonitors.values()])
      this.#revokeMonitor(monitor);
    for (const sub of this.#subscriptions.values()) this.unsubscribe(sub);
    for (const group of this.#groups.values()) this.#groupStates.get(group).closed=true;
    // Closing the broker revokes the exact affine grant objects, not merely
    // the searchable membership index. Weak-held stale grants must never
    // report a successful leave or become active after shutdown.
    for (const entry of this.#memberships.values()) entry.active=false;
    this.#memberships.clear();
    for (const group of this.#groups.values()) this.#groupStates.get(group).members.clear();
    return success();
  }

  // Erlang pg.monitor analogue, kept intentionally separate from DATA
  // topic subscriptions and supervisor CONTROL notices. A current membership
  // grant is required to observe a group. The snapshot and watch are minted
  // in one oracle step; a production implementation needs one linearization
  // point for initial snapshot + subsequent changes.
  monitorGroup(group,grant,capacity=32) {
    if (this.closed) return failure("Closed");
    if (!this.isGroup(group)) return failure("StaleGroup");
    const membership=this.#grantStates.get(grant);
    if (!membership || !membership.active || membership.capability!==grant ||
        grant.group!==group || !this.isActor(grant.actor))
      return failure("UnauthorizedMonitor");
    if (!Number.isSafeInteger(capacity) || capacity<1 ||
        capacity>this.maxGroupMonitorQueueCapacity)
      return failure("InvalidCapacity");
    if (this.#groupMonitors.size>=this.maxGroupMonitors ||
        this.#nextMonitor>=Number.MAX_SAFE_INTEGER)
      return failure("ResourceExhausted");
    let owned=0;
    for (const monitor of this.#groupMonitors.values()) {
      if (this.#monitorStates.get(monitor).grant.actor===grant.actor)
        owned++;
    }
    if (owned>=this.maxGroupMonitorsPerActor) return failure("ResourceExhausted");
    const state={group,grant,active:true,capacity,queue:[],overflow:false};
    const monitor=Object.freeze({id:++this.#nextMonitor});
    NON_DATA_CAPABILITIES.add(monitor);
    this.#monitorStates.set(monitor,state);
    this.#groupMonitors.set(monitor.id,monitor);
    return success({monitor,members:Object.freeze([...group.members].sort()),
      revision:this.#groupStates.get(group).revision.toString()});
  }

  // Access to a leaked monitor token alone conveys no observation authority:
  // the original, live membership grant must accompany every read/resync.
  #monitorAccess(monitor,grant) {
    const state=this.#monitorStates.get(monitor);
    if (!state || !state.active) return failure("StaleMonitor");
    if (state.grant!==grant || !this.#grantStates.get(grant)?.active)
      return failure("UnauthorizedMonitor");
    return success({state});
  }

  pollGroupMonitor(monitor,grant,afterRevision=null) {
    const access=this.#monitorAccess(monitor,grant);
    if (!access.ok) return access;
    const state=access.state;
    if (state.overflow) return failure("MonitorOverflow");
    if (!state.queue.length) return failure("Empty");
    if (afterRevision!==null) {
      // Strict cursor mode rejects malformed/unbounded external input without
      // consuming a delta; the caller can recover by resnapshotting. BigInt
      // compares decimal strings losslessly, including beyond JS safe ints.
      if (typeof afterRevision!=="string" ||
          !/^(0|[1-9][0-9]{0,255})$/.test(afterRevision))
        return failure("InvalidRevision");
      const expected=BigInt(afterRevision)+1n;
      if (BigInt(state.queue[0].revision)!==expected)
        return failure("RevisionMismatch");
    }
    return success({event:state.queue.shift()});
  }

  resyncGroupMonitor(monitor,grant) {
    const access=this.#monitorAccess(monitor,grant);
    if (!access.ok) return access;
    const state=access.state;
    if (!this.isGroup(state.group)) return failure("StaleGroup");
    state.queue.length=0;
    state.overflow=false;
    return success({members:Object.freeze([...state.group.members].sort()),
      revision:this.#groupStates.get(state.group).revision.toString()});
  }

  unmonitorGroup(monitor,grant) {
    const access=this.#monitorAccess(monitor,grant);
    if (!access.ok) return access;
    this.#revokeMonitor(monitor);
    return success();
  }

  #revokeMonitor(monitor) {
    const state=this.#monitorStates.get(monitor);
    if (!state || !state.active) return;
    state.active=false;
    state.queue.length=0;
    this.#groupMonitors.delete(monitor.id);
  }

  #revokeOwnerMonitors(group,actor) {
    for (const monitor of [...this.#groupMonitors.values()]) {
      const state=this.#monitorStates.get(monitor);
      if (state.group===group && state.grant.actor===actor)
        this.#revokeMonitor(monitor);
    }
  }

  #revokeGroupMonitors(group) {
    for (const monitor of [...this.#groupMonitors.values()])
      if (this.#monitorStates.get(monitor).group===group)
        this.#revokeMonitor(monitor);
  }

  #recordMembershipChange(group,kind,actor) {
    // A membership transition is the revision linearization point. Repeated
    // idempotent joins, failed operations and DATA publications never advance
    // it; even a zero-monitor group retains its monotone revision.
    const groupState=this.#groupStates.get(group);
    groupState.revision++;
    const event=Object.freeze({
      kind,group_id:group.id,actor_key:actor.key,
      revision:groupState.revision.toString()
    });
    for (const monitor of this.#groupMonitors.values()) {
      const state=this.#monitorStates.get(monitor);
      if (!state.active || state.group!==group || state.overflow) continue;
      if (state.queue.length>=state.capacity) {
        // Silent loss is forbidden: clients must explicitly resnapshot.
        state.queue.length=0;
        state.overflow=true;
      } else state.queue.push(event);
    }
  }

  #cancelTarget(key,predicate) {
    for (const sub of this.#subscriptions.values())
      if (predicate(sub)) this.#subscriptionStates.get(sub).queues.delete(key);
  }

  isActor(actor) {
    const state=this.#actorStates.get(actor);
    return !!state && state.alive;
  }
  isGroup(group) {
    const state=this.#groupStates.get(group);
    return !!state && !state.closed;
  }
  isSub(sub) { return !!sub && this.#subscriptionStates.has(sub); }
  isShared(v) {
    // A frozen DAG is Sendable even when two fields reference the same child.
    // Reject back-edges to the current stack (true cycles).
    const visiting=new Set(), checked=new Set();
    let nodes=0, edges=0;
    function check(x,depth=0) {
      if (x===null || x===undefined) return false;
      if (typeof x==="object" && NON_DATA_CAPABILITIES.has(x)) return false;
      if (typeof x!=="object") return typeof x!=="function" && typeof x!=="symbol";
      if (depth>SHARED_GRAPH_MAX_DEPTH) return false;
      if (visiting.has(x)) return false;
      if (checked.has(x)) return true;
      if (nodeTypes.isProxy(x) || !Object.isFrozen(x)) return false;
      const keys=safeKeys(x);
      if (!keys || ++nodes>SHARED_GRAPH_MAX_NODES ||
          keys.length>SHARED_GRAPH_MAX_EDGES-edges) return false;
      edges+=keys.length;
      visiting.add(x);
      try {
        if (!keys.every(k=>check(Object.getOwnPropertyDescriptor(x,k).value,depth+1))) return false;
        checked.add(x);
        return true;
      } finally {
        visiting.delete(x);
      }
    }
    return check(v);
  }
}
