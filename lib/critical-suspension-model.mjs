// Source-free reference oracle; NOT an Oreslang compiler/runtime implementation.
export class CriticalGateModel {
  constructor(generation = 1, maxWaiters = 8192) {
    if (!Number.isSafeInteger(generation) || generation < 1) throw new TypeError('invalid generation');
    if (!Number.isSafeInteger(maxWaiters) || maxWaiters < 1 || maxWaiters > 8192)
      throw new TypeError('invalid bounded waiter capacity');
    this.maxWaiters = maxWaiters;
    this.generation = generation;
    this.owner = null;
    this.waiters = [];
    this.retired = false;
    this.sequence = 0;
  }
  checkLive(generation) {
    if (this.retired || generation !== this.generation) throw new Error('stale or retired incarnation');
  }
  grant(task) {
    const lease = Object.freeze({ task, generation: this.generation, ticket: ++this.sequence });
    this.owner = lease;
    return lease;
  }
  tryEnter(task, generation = this.generation) {
    this.checkLive(generation);
    // Scheduler continuation identity must exist. In particular, Java
    // CriticalSectionGate rejects null; treating null/undefined as a valid
    // token would make cancellation and duplicate admission ambiguous.
    if (task === null || task === undefined ||
        (typeof task === 'number' && !Number.isFinite(task)))
      throw new TypeError('critical continuation identity required');
    if (this.owner?.task === task)
      throw new Error('recursive critical admission prohibited');
    // Do not silently report "busy" when the very same continuation
    // already owns a pending ticket. A duplicate must fail closed even
    // through the nonqueueing fast-path, matching native gate admission.
    if (this.waiters.some(w => w.pending && w.task === task))
      throw new Error('duplicate continuation ticket prohibited');
    if (this.owner || this.waiters.length) return null;
    return this.grant(task);
  }
  enter(task, generation = this.generation) {
    this.checkLive(generation);
    const fast = this.tryEnter(task, generation);
    if (fast) return { suspended: false, lease: fast, cancel: () => false };
    if (this.waiters.some(w => w.pending && w.task === task))
      throw new Error('duplicate continuation ticket prohibited');
    if (this.waiters.length >= this.maxWaiters)
      throw new Error('critical waiter limit exceeded');
    let resolve, reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    const waiter = { task, generation, resolve, reject, pending: true };
    this.waiters.push(waiter);
    return {
      suspended: true,
      completion,
      cancel: () => {
        if (!waiter.pending) return false;
        waiter.pending = false;
        this.waiters = this.waiters.filter(w => w !== waiter);
        reject(new Error('cancelled while queued'));
        return true;
      }
    };
  }
  release(lease) {
    if (!lease || this.owner !== lease) throw new Error('foreign or double release');
    this.owner = null;
    if (this.retired) return;
    while (this.waiters.length) {
      const next = this.waiters.shift();
      if (!next.pending) continue;
      next.pending = false;
      if (next.generation !== this.generation) {
        next.reject(new Error('stale queued generation'));
        continue;
      }
      next.resolve(this.grant(next.task));
      break;
    }
  }
  retire() {
    if (this.retired) return false;
    this.retired = true;
    for (const waiter of this.waiters) {
      if (!waiter.pending) continue;
      waiter.pending = false;
      waiter.reject(new Error('retired while queued'));
    }
    this.waiters = [];
    // An already-running physical body owns its lease until release;
    // retirement is not proof of native-memory quiescence.
    return true;
  }
}
