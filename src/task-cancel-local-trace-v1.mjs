// Source-free reference model. NOT a compiler, scheduler, or guest runtime.
const primitive = value => (
  (typeof value === 'string' && value.length <= 256) ||
  (typeof value === 'boolean') ||
  (typeof value === 'number' && Number.isSafeInteger(value))
);
export class TaskBoundaryModel {
  #issuedTasks = new WeakSet();
  #issuedActors = new WeakSet();
  #next = 1;
  #tls = new Map();
  #events = [];
  #droppedTraceEvents = 0;
  #record(task, kind, extra = {}) {
    // Telemetry pressure must never abort cancellation, cleanup, or admission.
    // A dropped-event count makes this trace explicitly incomplete/non-certifying.
    if (this.#events.length >= 256) {
      this.#droppedTraceEvents++;
      return;
    }
    this.#events.push(Object.freeze({
      sequence: this.#events.length + 1, kind, task: task.id,
      traceId: task.traceId, spanId: task.spanId,
      parentSpanId: task.parentSpanId, ...extra,
    }));
  }
  actor(id, generation = 1) {
    if (typeof id !== 'string' || !id || !Number.isSafeInteger(generation) || generation < 1)
      throw new Error('INVALID_ACTOR');
    const handle = { id, generation, values: new Map() };
    this.#issuedActors.add(handle);
    return handle;
  }
  #actor(actor) {
    if (!actor || !this.#issuedActors.has(actor)) throw new Error('UNAUTHENTICATED_ACTOR');
  }
  #task(task) {
    if (!task || !this.#issuedTasks.has(task)) throw new Error('UNAUTHENTICATED_TASK');
  }
  #create(actor, parent, locals) {
    const id = this.#next++;
    const task = {
      id, actor, parent, children: new Set(), locals,
      traceId: parent?.traceId ?? 'trace-' + id,
      spanId: 'span-' + id, parentSpanId: parent?.spanId ?? null,
      running: false, carrier: null, cancelled: false, retired: false,
      leases: [], cleanupErrors: [],
    };
    this.#issuedTasks.add(task);
    if (parent) parent.children.add(task);
    this.#record(task, 'admit');
    return task;
  }
  root(actor) {
    this.#actor(actor);
    return this.#create(actor, null, new Map());
  }
  child(parent, inherit = []) {
    this.#task(parent);
    if (parent.cancelled || parent.retired) throw new Error('SCOPE_SEALED');
    if (!Array.isArray(inherit) || inherit.length > 32 ||
        inherit.some(key => typeof key !== 'string' || !parent.locals.has(key)) ||
        new Set(inherit).size !== inherit.length)
      throw new Error('INVALID_SNAPSHOT');
    // Copies only scalar immutable values; mutable aliases/authority never propagate.
    const locals = new Map(inherit.map(key => {
      const value = parent.locals.get(key);
      if (!primitive(value)) throw new Error('NON_SEND_SNAPSHOT');
      return [key, value];
    }));
    const created = this.#create(parent.actor, parent, locals);
    this.#record(parent, 'spawn', { childSpanId: created.spanId });
    return created;
  }
  enter(task, carrier) {
    this.#task(task);
    if (task.cancelled || task.retired || task.running || typeof carrier !== 'string' || !carrier)
      throw new Error('TASK_NOT_ADMITTED');
    task.running = true;
    task.carrier = carrier;
    this.#record(task, 'resume', { carrier });
  }
  suspend(task) {
    this.#task(task);
    if (!task.running) throw new Error('NOT_RUNNING');
    task.running = false;
    task.carrier = null;
    this.#record(task, 'await');
  }
  taskSet(task, key, value) {
    this.#task(task);
    if (!task.running || task.cancelled || task.retired ||
        typeof key !== 'string' || !key || !primitive(value))
      throw new Error('INVALID_TASK_LOCAL_WRITE');
    if (!task.locals.has(key) && task.locals.size >= 32) throw new Error('LOCAL_QUOTA');
    task.locals.set(key, value);
  }
  taskGet(task, key) {
    this.#task(task);
    if (!task.running || task.cancelled || task.retired) throw new Error('NO_TASK_CONTEXT');
    return task.locals.get(key);
  }
  actorSet(task, key, value, criticalWrite = false) {
    this.#task(task);
    if (!task.running || task.cancelled || task.retired || !criticalWrite ||
        typeof key !== 'string' || !key || !primitive(value))
      throw new Error('ACTOR_WRITE_NOT_AUTHORIZED');
    this.#actor(task.actor);
    task.actor.values.set(key, value);
  }
  actorGet(task, key) {
    this.#task(task);
    if (!task.running || task.cancelled || task.retired) throw new Error('NO_ACTOR_TURN');
    this.#actor(task.actor);
    return task.actor.values.get(key);
  }
  threadSet(carrier, key, value) {
    if (typeof carrier !== 'string' || !carrier || !primitive(value)) throw new Error('BAD_THREAD_LOCAL');
    if (!this.#tls.has(carrier)) this.#tls.set(carrier, new Map());
    this.#tls.get(carrier).set(key, value);
  }
  threadGet(carrier, key) { return this.#tls.get(carrier)?.get(key); }
  acquire(task, name, release, { transferable = false } = {}) {
    this.#task(task);
    if (!task.running || task.cancelled || task.retired || transferable !== true ||
        typeof release !== 'function' || typeof name !== 'string' || !name)
      throw new Error('UNSAFE_LEASE');
    const lease = { task, name, release, released: false };
    task.leases.push(lease);
    return lease;
  }
  release(task, lease) {
    this.#task(task);
    if (!task.running || task.cancelled || lease?.task !== task || lease.released)
      throw new Error('FOREIGN_OR_RETIRED_LEASE');
    lease.released = true;
    lease.release();
  }
  cancel(task) {
    this.#task(task);
    if (task.retired || task.cancelled) return false;
    // Iterative propagation avoids unbounded host recursion on a deep Task tree.
    const pending = [task];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current.retired || current.cancelled) continue;
      current.cancelled = true; // revoke work, NEVER unlock a physically running task
      this.#record(current, 'cancel-request');
      for (const child of current.children) pending.push(child);
    }
    return true;
  }
  retire(task) {
    this.#task(task);
    if (task.retired) throw new Error('DOUBLE_RETIRE');
    if (task.running || [...task.children].some(child => !child.retired))
      throw new Error('NOT_PHYSICALLY_QUIESCENT');
    // Only runtime-verified transferable logical leases can retire here.
    for (const lease of [...task.leases].reverse()) {
      if (lease.released) continue;
      lease.released = true;
      try { lease.release(); }
      catch (error) { task.cleanupErrors.push(error); }
    }
    task.locals.clear();
    task.retired = true;
    this.#record(task, 'physical-retirement', { cleanupFailures: task.cleanupErrors.length });
    return this.done(task);
  }
  done(task) {
    this.#task(task);
    return Object.freeze({
      quiescent: task.retired,
      success: task.retired && task.cleanupErrors.length === 0,
      cleanupFailures: task.cleanupErrors.length,
      cancelled: task.cancelled,
    });
  }
  events() { return Object.freeze([...this.#events]); }
  droppedTraceEvents() { return this.#droppedTraceEvents; }
  traceComplete() { return this.#droppedTraceEvents === 0; }
}
