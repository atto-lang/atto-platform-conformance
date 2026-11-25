// Source-free actor region/quiescence reference model. NOT backend runtime proof.

// Multiple suspended message lifetimes allowed; at most one executing guest turn.

class ActorMessageMemoryOracle {
  #owner; #incarnation; #limit; #quota; #messages = new Map();
  #issuedMessage = new WeakMap(); #issuedScratch = new WeakMap(); #issuedLease = new WeakMap();
  #executing = null; #next = 1; #reserved = 0; #retiring = false; #reclaimed = false;
  constructor({actor, incarnation, maxOutstanding=1, maxBytes=65536}) {
    if (!Number.isSafeInteger(actor) || actor <= 0 || !Number.isSafeInteger(incarnation) || incarnation <= 0 ||
        !Number.isSafeInteger(maxOutstanding) || maxOutstanding <= 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new RangeError("invalid actor ownership domain");
    this.#owner = actor; this.#incarnation = incarnation;
    this.#limit = maxOutstanding; this.#quota = maxBytes;
  }
  get allocatedBytes() { return this.#reserved; }
  get physicallyReclaimed() { return this.#reclaimed; }
  get outstanding() { return this.#messages.size; }
  #requireMessage(message) {
    if (!message || this.#issuedMessage.get(message) !== true) throw new Error("unissued message");
    const s = this.#messages.get(message);
    if (!s || s.epoch !== message.epoch) throw new Error("stale message");
    return s;
  }
  admit() {
    if (this.#retiring) throw new Error("actor retiring");
    if (this.#messages.size >= this.#limit) throw new Error("message admission limit");
    if (this.#next >= Number.MAX_SAFE_INTEGER) throw new Error("epoch exhausted");
    const message = Object.freeze({actor:this.#owner,incarnation:this.#incarnation,epoch:this.#next++});
    this.#messages.set(message, {epoch:message.epoch,phase:"ready",bytes:0,blocks:[],leases:0});
    this.#issuedMessage.set(message,true);
    return message;
  }
  enter(message, carrier) {
    const s = this.#requireMessage(message);
    if (this.#executing || !["ready","suspended"].includes(s.phase) ||
        !Number.isSafeInteger(carrier) || carrier <= 0)
      throw new Error("single-flight guest execution or invalid resume");
    const turn = Object.freeze({message,carrier});
    this.#executing = turn;
    s.phase = "running";
    return turn;
  }
  #requireTurn(turn) {
    if (!turn || this.#executing !== turn) throw new Error("wrong or expired guest turn");
    const s = this.#requireMessage(turn.message);
    if (s.phase !== "running") throw new Error("not running");
    return s;
  }
  scratch(turn, bytes) {
    const s = this.#requireTurn(turn);
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.#quota - this.#reserved)
      throw new RangeError("scratch quota exceeded");
    const handle = Object.freeze({message:turn.message, block:s.blocks.length});
    const block = new Uint8Array(bytes);
    s.blocks.push(block);
    s.bytes += bytes;
    this.#reserved += bytes;
    this.#issuedScratch.set(handle,true);
    return handle;
  }
  #requireScratch(turn, handle) {
    const s = this.#requireTurn(turn);
    if (!handle || this.#issuedScratch.get(handle) !== true ||
        handle.message !== turn.message || !s.blocks[handle.block])
      throw new Error("foreign/stale scratch");
    return s.blocks[handle.block];
  }
  read(turn, handle) { return this.#requireScratch(turn,handle).slice(); }
  write(turn, handle, bytes) {
    const block = this.#requireScratch(turn,handle);
    if (!(bytes instanceof Uint8Array) || bytes.length !== block.length) throw new TypeError("scratch shape");
    block.set(bytes);
  }
  lease(turn) {
    const s = this.#requireTurn(turn);
    s.leases++;
    const lease = Object.freeze({message:turn.message});
    this.#issuedLease.set(lease, true);
    return lease;
  }
  releaseLease(lease) {
    if (!lease || this.#issuedLease.get(lease) !== true) throw new Error("forged/double lease");
    const s = this.#requireMessage(lease.message);
    if (s.leases <= 0) throw new Error("lease invariant");
    this.#issuedLease.set(lease,false);
    s.leases--;
    this.#reap(lease.message,s);
  }
  suspend(turn) {
    const s = this.#requireTurn(turn);
    s.phase = "suspended";
    this.#executing = null; // scratch survives suspension and carrier migration.
  }
  complete(turn) {
    const s = this.#requireTurn(turn);
    s.phase = "draining";
    this.#executing = null;
    this.#reap(turn.message,s);
  }
  #reap(message,s) {
    if (s.phase !== "draining" || s.leases !== 0) return;
    for (const block of s.blocks) block.fill(0);
    this.#reserved -= s.bytes;
    s.blocks.length = 0;
    s.phase = "done";
    this.#messages.delete(message);
    if (this.#retiring && this.#messages.size === 0) this.#reclaimed = true;
  }
  stop() {
    this.#retiring = true;
    if (this.#messages.size === 0) this.#reclaimed = true;
    return this.#reclaimed;
  }
}

export { ActorMessageMemoryOracle };

