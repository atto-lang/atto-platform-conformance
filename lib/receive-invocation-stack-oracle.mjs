// Source-free reference oracle only. NOT a compiler, native scheduler or guest proof.
// Distinct logical stack identity belongs to each receive invocation / independently
// scheduled Task, not to its shared carrier thread.
export class ReceiveStackViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "ReceiveStackViolation";
  }
}

export class ReceiveStackOracle {
  constructor() {
    this.actors = new Map();
    this.stacks = new Map();
    this.tickets = new WeakMap();
    this.frameTickets = new WeakMap();
    this.wakeTickets = new WeakMap();
    this.nextStackId = 0;
    this.nextFrameId = 0;
  }

  require(condition, message) {
    if (!condition) throw new ReceiveStackViolation(message);
  }

  boundedInt(n) { return Number.isSafeInteger(n) && n > 0; }

  actor(id, options = {}) {
    const limits = {
      messageConcurrency: options.messageConcurrency ?? 1,
      maxFramesPerStack: options.maxFramesPerStack ?? 8,
      maxBytesPerStack: options.maxBytesPerStack ?? 128,
      maxActorStackBytes: options.maxActorStackBytes ?? 512,
      maxTasks: options.maxTasks ?? 8
    };
    this.require(typeof id === "string" && id.length > 0 && !this.actors.has(id),
      "fresh actor ID required");
    for (const [key, value] of Object.entries(limits))
      this.require(this.boundedInt(value), "invalid " + key);
    this.actors.set(id, { id, generation: 1, state: "ALIVE", limits,
      stackIds: new Set(), bytes: 0, retiredCount: 0 });
  }

  a(id) {
    const actor = this.actors.get(id);
    this.require(actor, "unknown actor");
    return actor;
  }

  authorize(ticket) {
    const claim = ticket && typeof ticket === "object" ? this.tickets.get(ticket) : null;
    this.require(claim, "forged or foreign stack ticket");
    const actor = this.a(claim.actorId);
    this.require(actor.generation === claim.generation, "stale actor generation");
    const stack = this.stacks.get(claim.id);
    this.require(stack && !stack.retired && stack.actorId === actor.id,
      "retired or foreign stack");
    return { actor, stack };
  }

  mintStack(actor, kind, parentId = null, carrier = "worker-1") {
    const id = ++this.nextStackId;
    const stack = { id, actorId: actor.id, generation: actor.generation, kind,
      parentId, carrier, state: "ACTIVE", frames: [], bytes: 0,
      children: new Set(), retired: false, cleaned: false };
    const ticket = Object.freeze({ owner: actor.id, generation: actor.generation, stack: id, kind });
    this.stacks.set(id, stack);
    this.tickets.set(ticket, { actorId: actor.id, generation: actor.generation, id });
    actor.stackIds.add(id);
    if (parentId !== null) this.stacks.get(parentId).children.add(id);
    return ticket;
  }

  liveStacks(actor, kind) {
    return [...actor.stackIds].map(id => this.stacks.get(id))
      .filter(s => s && !s.retired && s.kind === kind);
  }

  receive(actorId, carrier = "worker-1") {
    const actor = this.a(actorId);
    this.require(actor.state === "ALIVE", "actor failed or closed");
    this.require(typeof carrier === "string" && carrier.length > 0, "invalid carrier");
    this.require(this.liveStacks(actor, "receive").length < actor.limits.messageConcurrency,
      "receive concurrency slot occupied, including suspended receives");
    return this.mintStack(actor, "receive", null, carrier);
  }

  spawnTask(parentTicket, carrier = "worker-1") {
    const { actor, stack: parent } = this.authorize(parentTicket);
    this.require(actor.state === "ALIVE" && parent.state === "ACTIVE",
      "parent stack cannot spawn a Task");
    this.require(this.liveStacks(actor, "task").length < actor.limits.maxTasks,
      "task stack quota exceeded");
    this.require(typeof carrier === "string" && carrier.length > 0, "invalid carrier");
    return this.mintStack(actor, "task", parent.id, carrier);
  }

  active(ticket) {
    const { actor, stack } = this.authorize(ticket);
    this.require(actor.state === "ALIVE" && stack.state === "ACTIVE",
      "stack not active or actor poisoned");
    return { actor, stack };
  }

  failActor(actor, reason) {
    actor.state = "FAILED";
    actor.failure = reason;
    for (const id of actor.stackIds) {
      const stack = this.stacks.get(id);
      if (stack && !stack.retired) stack.state = "POISONED";
    }
  }

  push(ticket, name, bytes = 8, locals = {}) {
    const { actor, stack } = this.active(ticket);
    this.require(typeof name === "string" && name.length > 0, "invalid frame name");
    this.require(this.boundedInt(bytes), "invalid frame byte charge");
    this.require(locals && Object.getPrototypeOf(locals) === Object.prototype,
      "frame locals must be a plain value record");
    if (stack.frames.length >= actor.limits.maxFramesPerStack ||
        stack.bytes + bytes > actor.limits.maxBytesPerStack ||
        actor.bytes + bytes > actor.limits.maxActorStackBytes) {
      this.failActor(actor, "logical stack quota exceeded");
      throw new ReceiveStackViolation("logical stack quota exceeded: actor terminal");
    }
    const frame = { id: ++this.nextFrameId, name, bytes, locals: new Map(Object.entries(locals)) };
    stack.frames.push(frame);
    stack.bytes += bytes;
    actor.bytes += bytes;
    const frameTicket = Object.freeze({ stack: stack.id, frame: frame.id });
    this.frameTickets.set(frameTicket, { id: frame.id, stack: stack.id, generation: actor.generation });
    return frameTicket;
  }

  frame(ticket, frameTicket) {
    const { stack } = this.active(ticket);
    const claim = frameTicket && typeof frameTicket === "object"
      ? this.frameTickets.get(frameTicket) : null;
    this.require(claim && claim.stack === stack.id && claim.generation === stack.generation,
      "foreign, forged or stale frame ticket");
    const top = stack.frames.at(-1);
    this.require(top && top.id === claim.id, "frame not at top or already retired");
    return { stack, frame: top };
  }

  get(ticket, frameTicket, key) {
    return this.frame(ticket, frameTicket).frame.locals.get(key);
  }

  set(ticket, frameTicket, key, value) {
    this.frame(ticket, frameTicket).frame.locals.set(key, value);
  }

  pop(ticket, frameTicket) {
    const { stack, frame } = this.frame(ticket, frameTicket);
    const actor = this.a(stack.actorId);
    stack.frames.pop();
    stack.bytes -= frame.bytes;
    actor.bytes -= frame.bytes;
  }

  suspend(ticket) {
    const { stack } = this.active(ticket);
    stack.state = "SUSPENDED";
    const witness = Object.freeze({ wake: stack.id, generation: stack.generation });
    this.wakeTickets.set(witness, { stackId: stack.id, generation: stack.generation, used: false });
    return witness;
  }

  resume(ticket, witness, carrier) {
    const { actor, stack } = this.authorize(ticket);
    const claim = witness && typeof witness === "object" ? this.wakeTickets.get(witness) : null;
    this.require(actor.state === "ALIVE" && stack.state === "SUSPENDED",
      "stack is not suspended");
    this.require(claim && claim.stackId === stack.id && claim.generation === stack.generation,
      "foreign or forged wake ticket");
    this.require(!claim.used, "duplicate wake ticket");
    this.require(typeof carrier === "string" && carrier.length > 0, "invalid carrier");
    claim.used = true;
    stack.carrier = carrier; // Carrier change does not change the logical stack identity.
    stack.state = "ACTIVE";
    return ticket;
  }

  cancel(ticket) {
    const { stack } = this.authorize(ticket);
    this.require(stack.state !== "CANCEL_REQUESTED", "duplicate cancellation");
    stack.state = "CANCEL_REQUESTED"; // Not physical retirement.
  }

  unwind(ticket) {
    const { actor, stack } = this.authorize(ticket);
    this.require(!stack.cleaned, "duplicate physical cleanup");
    actor.bytes -= stack.bytes;
    stack.bytes = 0;
    stack.frames.length = 0;
    stack.cleaned = true;
    stack.state = "CLEANED";
  }

  retire(ticket) {
    const { actor, stack } = this.authorize(ticket);
    this.require(stack.frames.length === 0 && stack.bytes === 0,
      "live stack frames require physical cleanup");
    this.require([...stack.children].every(id => this.stacks.get(id)?.retired),
      "structured child task not physically retired");
    stack.retired = true;
    stack.state = "RETIRED";
    actor.stackIds.delete(stack.id);
    actor.retiredCount++;
  }

  restart(actorId) {
    const actor = this.a(actorId);
    this.require(actor.state === "FAILED", "restart requires failed incarnation");
    this.require(actor.stackIds.size === 0 && actor.bytes === 0,
      "physical stack retirement required before restart");
    actor.generation++;
    actor.state = "ALIVE";
    actor.failure = null;
    return actor.generation;
  }

  stats(actorId) {
    const actor = this.a(actorId);
    return Object.freeze({ generation: actor.generation, state: actor.state,
      liveReceives: this.liveStacks(actor, "receive").length,
      liveTasks: this.liveStacks(actor, "task").length,
      totalStackBytes: actor.bytes, retired: actor.retiredCount });
  }
}
