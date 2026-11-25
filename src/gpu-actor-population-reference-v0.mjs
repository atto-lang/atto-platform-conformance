/**
 * Host-only deterministic reference model for proposed AttoLang GPU actor populations.
 * NOT a compiler, GPU provider, concurrent scheduler or physical-device proof.
 * The token identity here is a test oracle, not a production security capability.
 */
const asInt = (v, min, max, label) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new RangeError(`INVALID_${label}`);
  return v;
};
const fail = code => { throw new Error(code); };

export class GpuActorPopulationReference {
  #actors;
  #capacity;
  #nextTicket = 0;
  #deviceLost = false;
  #notifications = [];
  #roundRobin = 0;
  constructor({ actorCount, mailboxCapacity = 4, initialValue = 0 } = {}) {
    asInt(actorCount, 1, 4096, 'ACTOR_COUNT');
    this.#capacity = asInt(mailboxCapacity, 1, 1024, 'MAILBOX_CAPACITY');
    asInt(initialValue, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'INITIAL_VALUE');
    this.#actors = Array.from({ length: actorCount }, () => ({
      generation: 1, value: initialValue, queue: [], nextSequence: 1,
      active: null, closing: false, closed: false
    }));
  }
  #get(id) {
    asInt(id, 0, this.#actors.length - 1, 'ACTOR_ID');
    return this.#actors[id];
  }
  send(actorId, delta) {
    const actor = this.#get(actorId);
    asInt(delta, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'DELTA');
    if (this.#deviceLost) fail('DEVICE_LOST');
    if (actor.closed || actor.closing) fail('ACTOR_CLOSED');
    if (actor.queue.length >= this.#capacity) fail('MAILBOX_FULL');
    const sequence = actor.nextSequence++;
    actor.queue.push({ sequence, delta });
    return Object.freeze({ actorId, generation: actor.generation, sequence });
  }
  dispatch(maxActors = this.#actors.length) {
    asInt(maxActors, 1, this.#actors.length, 'DISPATCH_LIMIT');
    if (this.#deviceLost) fail('DEVICE_LOST');
    const jobs = [];
    for (let step = 0; step < this.#actors.length && jobs.length < maxActors; step++) {
      const id = (this.#roundRobin + step) % this.#actors.length;
      const actor = this.#actors[id];
      if (actor.closed || actor.closing || actor.active || !actor.queue.length) continue;
      const message = actor.queue.shift();
      const after = actor.value + message.delta;
      const invalid = !Number.isSafeInteger(after);
      const ticket = Object.freeze({
        id: ++this.#nextTicket, actorId: id, generation: actor.generation,
        sequence: message.sequence
      });
      actor.active = { ticket, after, invalid, cancelRequested: false };
      jobs.push(ticket);
    }
    // Prevent repeatedly favoring low-index actors on every batch.
    if (jobs.length) this.#roundRobin = (jobs.at(-1).actorId + 1) % this.#actors.length;
    return jobs;
  }
  requestClose(actorId) {
    const actor = this.#get(actorId);
    if (actor.closed) return false;
    actor.closing = true;
    actor.queue.length = 0;
    if (actor.active) actor.active.cancelRequested = true;
    else actor.closed = true;
    return true;
  }
  complete(ticket, { deviceSuccess = true, fenceObserved = true } = {}) {
    if (!ticket || typeof ticket !== 'object' || typeof deviceSuccess !== 'boolean' || typeof fenceObserved !== 'boolean') fail('INVALID_COMPLETION');
    const actor = this.#get(ticket.actorId);
    const active = actor.active;
    if (!active || ticket !== active.ticket || ticket.generation !== actor.generation) fail('STALE_OR_FORGED_TICKET');
    if (!fenceObserved) fail('DEVICE_NOT_QUIESCENT');
    const reason = this.#deviceLost ? 'DEVICE_LOST'
      : active.cancelRequested ? 'CANCELLED'
      : !deviceSuccess ? 'KERNEL_FAILED'
      : active.invalid ? 'ARITHMETIC_OVERFLOW' : null;
    if (!reason) actor.value = active.after;
    actor.active = null;
    if (actor.closing || this.#deviceLost) actor.closed = true;
    const result = Object.freeze({ ...ticket, committed: reason === null, error: reason });
    return result;
  }
  loseDevice() {
    if (this.#deviceLost) return false;
    this.#deviceLost = true;
    for (let actorId = 0; actorId < this.#actors.length; actorId++) {
      const actor = this.#actors[actorId];
      if (actor.closed) continue;
      actor.closing = true;
      actor.queue.length = 0;
      if (actor.active) actor.active.cancelRequested = true;
      else actor.closed = true;
      this.#notifications.push(Object.freeze({ actorId, generation: actor.generation, type: 'SUPERVISOR_CONTROL_DEVICE_LOST' }));
    }
    return true;
  }
  restart(actorId, initialValue = 0) {
    const actor = this.#get(actorId);
    asInt(initialValue, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'INITIAL_VALUE');
    if (!actor.closed || actor.active) fail('DEVICE_NOT_QUIESCENT');
    if (this.#deviceLost) fail('DEVICE_LOST');
    actor.generation++;
    actor.value = initialValue;
    actor.queue = [];
    actor.nextSequence = 1;
    actor.closing = false;
    actor.closed = false;
    return actor.generation;
  }
  snapshot() {
    return Object.freeze({
      deviceLost: this.#deviceLost,
      actors: this.#actors.map(a => Object.freeze({
        generation: a.generation, value: a.value, pending: a.queue.length,
        active: !!a.active, closing: a.closing, closed: a.closed,
        nextSequence: a.nextSequence
      })),
      notifications: this.#notifications.slice()
    });
  }
}
