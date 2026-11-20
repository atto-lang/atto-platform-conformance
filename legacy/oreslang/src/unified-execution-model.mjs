// Deterministic reference oracle. NOT an Oreslang VM or runtime implementation.
export class UnifiedExecutionModel {
  constructor({reductionBudget = 4, queueCapacity = 32, controlCapacity = 4} = {}) {
    for (const [name, value] of Object.entries({reductionBudget, queueCapacity, controlCapacity})) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(name);
    }
    this.reductionBudget = reductionBudget;
    this.queueCapacity = queueCapacity;
    this.controlCapacity = controlCapacity;
    this.tasks = new Map();
    this.ready = [];
    this.control = [];
    this.active = null;
    this.actorActive = new Set();
    this.actorTurns = new Map(); // Retained across carrier release and I/O waits.
    this.events = [];
  }
  hasDataCredit() {
    return this.ready.length + (this.active?.queueKind === 'data' ? 1 : 0) < this.queueCapacity;
  }
  hasControlCredit() {
    return this.control.length + (this.active?.queueKind === 'control' ? 1 : 0) < this.controlCapacity;
  }
  // Each suspended task owns at most one completion/cancellation latch. A
  // one-shot reactor event must survive full DATA and CONTROL queues; it is
  // promoted automatically when a bounded queue credit becomes available.
  drainPendingWakes() {
    for (const task of this.tasks.values()) {
      if (task.state !== 'suspended' || !task.pendingWake) continue;
      const owner = task.actor !== null && this.actorTurns.get(task.actor)?.[0] === task.id;
      const controlEligible = task.actor === null || owner;
      const useControl = controlEligible && this.hasControlCredit() &&
        (task.cancelRequested || (owner && !this.hasDataCredit()));
      if (!useControl && !this.hasDataCredit()) continue;
      task.pendingWake = false;
      task.state = 'queued';
      (useControl ? this.control : this.ready).push(task.id);
    }
  }
  submit({id, actor = null, generation = 1, steps, captures = []}) {
    if (typeof id !== 'string' || !id || this.tasks.has(id)) throw new Error('invalid/duplicate task identity');
    if (actor !== null && (typeof actor !== 'string' || !actor)) throw new Error('invalid actor identity');
    if (!Number.isSafeInteger(generation) || generation <= 0) throw new Error('invalid generation');
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('missing steps');
    if (!Array.isArray(captures) || captures.some(x => !['take', 'copy', 'share'].includes(x)))
      throw new Error('unproven capture / borrow escape');
    this.drainPendingWakes(); // A completed I/O has priority over new admission.
    if (!this.hasDataCredit()) return false;
    const normalized = steps.map(step => {
      if (step?.kind === 'cpu' && Number.isSafeInteger(step.cost) && step.cost > 0)
        return {...step};
      if (step?.kind === 'io' && typeof step.token === 'string' && step.token)
        return {...step};
      if (step?.kind === 'done') return {kind:'done'};
      throw new Error('unsupported step');
    });
    const task = {id, actor, generation, steps:normalized, pc:0, state:'queued',
      terminal:null, physicallyRetired:false, dispatches:0, wakes:0, cancelRequested:false,
      waitEpoch:0, waitTicket:null};
    this.tasks.set(id, task);
    if (actor !== null) {
      if (!this.actorTurns.has(actor)) this.actorTurns.set(actor, []);
      this.actorTurns.get(actor).push(id);
    }
    this.ready.push(id);
    return true;
  }
  dispatch() {
    if (this.active) throw new Error('carrier still executing');
    this.drainPendingWakes();
    // Do not dispatch younger same-actor messages while their owner is suspended.
    let queue, index = -1, queueKind;
    for (const [candidate, kind] of [[this.control, 'control'], [this.ready, 'data']]) {
      const found = candidate.findIndex(id => {
        const task = this.tasks.get(id);
        if (!task || task.state !== 'queued') throw new Error('stale/duplicate queue ticket');
        return task.actor === null || this.actorTurns.get(task.actor)?.[0] === id;
      });
      if (found !== -1) { queue = candidate; index = found; queueKind = kind; break; }
    }
    if (index === -1) return null;
    const [id] = queue.splice(index, 1);
    const task = this.tasks.get(id);
    const actorKey = task.actor === null ? null : `${task.actor}:${task.generation}`;
    if (actorKey && this.actorActive.has(actorKey)) throw new Error('actor physical turn overlap');
    if (actorKey) this.actorActive.add(actorKey);
    task.state = 'running'; task.dispatches++;
    this.active = {id, actorKey, queueKind, next:'queued'};
    this.events.push(`enter:${id}`);
    if (task.cancelRequested) {
      task.terminal = 'cancelled'; this.active.next = 'terminal';
    } else {
      let left = this.reductionBudget;
      while (left > 0) {
        const step = task.steps[task.pc];
        if (!step || step.kind === 'done') {
          task.terminal = 'success'; this.active.next = 'terminal'; break;
        }
        if (step.kind === 'io') {
          task.waitToken = step.token;
          // Fence delayed completions when a descriptor/token is reused.
          task.waitTicket = ++task.waitEpoch;
          task.pc++; this.active.next = 'suspended'; break;
        }
        const charge = Math.min(left, step.cost);
        step.cost -= charge; left -= charge;
        this.events.push(`cpu:${id}:${charge}`);
        if (step.cost === 0) task.pc++;
        if (left === 0) this.events.push(`budget:${id}`);
      }
    }
    return {id, next:this.active.next, terminal:task.terminal,
      waitTicket:this.active.next === 'suspended' ? task.waitTicket : null};
  }
  release() {
    if (!this.active) throw new Error('no active carrier');
    const {id, actorKey, next, queueKind} = this.active;
    const task = this.tasks.get(id);
    if (actorKey) this.actorActive.delete(actorKey);
    this.active = null;
    if (task.cancelRequested && next !== 'terminal') {
      task.terminal = 'cancelled'; task.state = 'terminal';
    } else {
      task.state = next;
    }
    if (task.state === 'suspended' && task.pendingWake) {
      task.pendingWake = false;
      task.state = 'queued';
    }
    if (task.state === 'queued') {
      if (queueKind === 'control') {
        if (this.control.length >= this.controlCapacity) throw new Error('control queue overflow');
        this.control.push(id);
      } else {
        if (this.ready.length >= this.queueCapacity) throw new Error('ready queue overflow');
      // A preempted actor message must retain its logical place ahead of
      // younger messages for that actor, without starving ready peer actors.
      if (task.actor === null) {
        this.ready.push(id);
      } else {
        const sameActor = this.ready.filter(
          otherId => this.tasks.get(otherId)?.actor === task.actor);
        const peers = this.ready.filter(
          otherId => this.tasks.get(otherId)?.actor !== task.actor);
        this.ready = [...peers, id, ...sameActor];
      }
      }
    } else if (task.state === 'terminal') {
      task.pendingWake = false;
      task.waitToken = null;
      task.waitTicket = null;
      task.physicallyRetired = true;
      if (task.actor !== null) {
        const turns = this.actorTurns.get(task.actor);
        if (!turns || turns[0] !== id) throw new Error('actor logical turn mismatch');
        turns.shift();
        if (turns.length === 0) this.actorTurns.delete(task.actor);
      }
    }
    this.events.push(`exit:${id}`);
    this.drainPendingWakes();
    return task.state;
  }
  wake({id, generation, token, ticket}) {
    const task = this.tasks.get(id);
    // A reactor publishes one durable completion bit, never guest execution.
    const finishingRegistration = task?.state === 'running' && this.active?.id === id &&
      this.active.next === 'suspended';
    if (!task || task.generation !== generation || task.waitToken !== token ||
        !Number.isSafeInteger(ticket) || ticket <= 0 || task.waitTicket !== ticket ||
        task.cancelRequested || task.pendingWake ||
        (!finishingRegistration && task.state !== 'suspended'))
      return false;
    task.waitToken = null;
    task.waitTicket = null;
    task.pendingWake = true;
    task.wakes++;
    this.events.push(`wake:${id}`);
    // If both lanes are saturated, retain the completion in this task until
    // release() frees a credit. No reactor callback retry is required.
    if (!finishingRegistration) this.drainPendingWakes();
    return true;
  }
  cancel(id) {
    const task = this.tasks.get(id);
    if (!task || task.physicallyRetired || task.terminal !== null || task.cancelRequested) return false;
    task.cancelRequested = true;
    if (task.state === 'suspended') {
      task.waitToken = null;
      task.waitTicket = null;
      task.pendingWake = true;
      this.drainPendingWakes();
    }
    this.events.push(`cancel:${id}`);
    return true;
  }
  inspect(id) {
    const task = this.tasks.get(id);
    if (!task) return null;
    const {state, terminal, physicallyRetired, dispatches, wakes, cancelRequested} = task;
    return {state, terminal, physicallyRetired, dispatches, wakes, cancelRequested};
  }
}
