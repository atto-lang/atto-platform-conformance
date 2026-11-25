/** Source-free model of trusted transport generation and close ownership. */
export class TransportLifetimeOracle {
  #generation; #max; #live = new Set(); #closing = false; #retired = false;
  constructor(generation, max = 10) {
    if (!Number.isSafeInteger(generation) || generation <= 0 ||
        !Number.isSafeInteger(max) || max < 1 || max > 65536)
      throw new RangeError("invalid bounded transport identity");
    this.#generation = generation;
    this.#max = max;
  }
  acquire(generation) {
    if (generation !== this.#generation || this.#closing || this.#retired ||
        this.#live.size === this.#max) return null;
    const permit = Object.freeze({generation: this.#generation});
    this.#live.add(permit);
    return permit;
  }
  verify(permit) {
    if (!permit || permit.generation !== this.#generation ||
        !this.#live.has(permit) || this.#retired)
      throw new Error("foreign, stale or retired transport permit");
  }
  release(permit) {
    this.verify(permit);
    this.#live.delete(permit);
    if (this.#closing && this.#live.size === 0) this.#retired = true;
  }
  close() {
    this.#closing = true;
    if (this.#live.size === 0) this.#retired = true;
  }
  state() {
    return Object.freeze({generation: this.#generation, active: this.#live.size,
      closing: this.#closing, retired: this.#retired});
  }
  invariant() {
    return this.#live.size <= this.#max &&
      !(this.#retired && this.#live.size > 0) && (!this.#retired || this.#closing);
  }
}
