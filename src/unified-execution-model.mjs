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
    this.events = [];
  }
  hasDataCredit() {
    return this.ready.length + (this.active ? 1 : 0) < this.queueCapacity;
  }
  submit({id, actor = null, generation = 1, steps, captures = []}) {
    if (typeof id !== 'string' || !id || this.tasks.has(id)) throw new Error('invalid/duplicate task identity');
    if (!Number.isSafeInteger(generation) || generation <= 0) throw new Error('invalid generation');
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('missing steps');
    if (!Array.isArray(captures) || captures.some(x => !['take', 'copy', 'share'].includes(x)))
      throw new Error('unproven capture / borrow escape');
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
      terminal:null, physicallyRetired:false, dispatches:0, wakes:0, cancelRequested:false};
    this.tasks.set(id, task);
    this.ready.push(id);
    return true;
  }
  dispatch() {
    if (this.active) throw new Error('carrier still executing');
    const queue = this.control.length ? this.control : this.ready;
    const id = queue.shift();
    if (!id) return null;
    const task = this.tasks.get(id);
    if (!task || task.state !== 'queued') throw new Error('stale/duplicate queue ticket');
    const actorKey = task.actor === null ? null : `${task.actor}:${task.generation}`;
    if (actorKey && this.actorActive.has(actorKey)) throw new Error('actor physical turn overlap');
    if (actorKey) this.actorActive.add(actorKey);
    task.state = 'running'; task.dispatches++;
    this.active = {id, actorKey, next:'queued'};
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
          task.pc++; this.active.next = 'suspended'; break;
        }
        const charge = Math.min(left, step.cost);
        step.cost -= charge; left -= charge;
        this.events.push(`cpu:${id}:${charge}`);
        if (step.cost === 0) task.pc++;
        if (left === 0) this.events.push(`budget:${id}`);
      }
    }
    return {id, next:this.active.next, terminal:task.terminal};
  }
  release() {
    if (!this.active) throw new Error('no active carrier');
    const {id, actorKey, next} = this.active;
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
      if (this.ready.length >= this.queueCapacity) throw new Error('ready queue overflow');
      this.ready.push(id);
    } else if (task.state === 'terminal') {
      task.physicallyRetired = true;
    }
    this.events.push(`exit:${id}`);
    return task.state;
  }
  wake({id, generation, token}) {
    const task = this.tasks.get(id);
    // A reactor may only publish a bounded ticket; never execute source here.
    const finishingRegistration = task?.state === 'running' && this.active?.id === id &&
      this.active.next === 'suspended';
    if (!task || task.generation !== generation || task.waitToken !== token ||
        task.cancelRequested || task.pendingWake ||
        (!finishingRegistration && (task.state !== 'suspended' || !this.hasDataCredit())))
      return false;
    task.waitToken = null;
    if (finishingRegistration) task.pendingWake = true;
    else { task.state = 'queued'; this.ready.push(id); }
    task.wakes++;
    this.events.push(`wake:${id}`);
    return true;
  }
  cancel(id) {
    const task = this.tasks.get(id);
    if (!task || task.physicallyRetired || task.cancelRequested) return false;
    if (task.state === 'suspended') {
      if (this.control.length >= this.controlCapacity) return false;
      task.waitToken = null;
      task.state = 'queued';
      this.control.push(id);
    }
    task.cancelRequested = true;
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
