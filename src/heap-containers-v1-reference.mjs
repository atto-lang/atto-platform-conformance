/*
 * Bounded, source-free semantic oracle for heap ownership and resizable vectors.
 * NOT a guest runtime, backend compiler, atomic implementation or borrow checker.
 */
function ensure(ok, reason) {
  if (!ok) throw new Error("HEAP_CONTAINERS_DENIED: " + reason);
}
function scalar(value) {
  ensure(value === null || typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length <= 256), "scalar fixture only");
  return value;
}
const internal = Symbol("owned-control");

export class BoxReference {
  #control;
  #handleLive = true;
  constructor(value, control, authorization) {
    if (control !== undefined) {
      ensure(authorization === internal, "forged owner");
      this.#control = control;
    } else {
      this.#control = { value: scalar(value), readers: 0, writer: false,
        dropped: false, drops: 0 };
    }
  }
  #check() {
    ensure(this.#handleLive && !this.#control.dropped, "moved or dropped Box");
  }
  borrow(mode = "read") {
    this.#check();
    ensure(mode === "read" || mode === "write", "borrow mode");
    const c = this.#control;
    if (mode === "read") {
      ensure(!c.writer, "shared borrow conflicts with writer");
      c.readers++;
    } else {
      ensure(!c.writer && c.readers === 0, "exclusive loan conflicts");
      c.writer = true;
    }
    let active = true;
    return Object.freeze({
      read() { ensure(active && !c.dropped, "expired loan"); return c.value; },
      write(value) {
        ensure(active && mode === "write" && !c.dropped, "write needs exclusive loan");
        c.value = scalar(value);
      },
      close() {
        ensure(active, "loan double-close");
        active = false;
        if (mode === "read") c.readers--;
        else c.writer = false;
      }
    });
  }
  move() {
    this.#check();
    ensure(this.#control.readers === 0 && !this.#control.writer, "move with live loan");
    this.#handleLive = false;
    return new BoxReference(undefined, this.#control, internal);
  }
  drop() {
    this.#check();
    const c = this.#control;
    ensure(c.readers === 0 && !c.writer, "drop with live loan");
    this.#handleLive = false;
    c.dropped = true;
    c.value = null;
    c.drops++;
  }
  inspect() {
    return Object.freeze({ handleLive: this.#handleLive,
      dropped: this.#control.dropped, drops: this.#control.drops });
  }
}

export class VectorReference {
  #values = [];
  #capacity = 0;
  #epoch = 0;
  #readers = 0;
  #writer = false;
  #limit;
  constructor(maxCapacity = 4096) {
    ensure(Number.isSafeInteger(maxCapacity) &&
      maxCapacity >= 0 && maxCapacity <= 4096, "vector capacity budget");
    this.#limit = maxCapacity;
  }
  get length() { return this.#values.length; }
  get capacity() { return this.#capacity; }
  get epoch() { return this.#epoch; }
  #exclusive() { ensure(this.#readers === 0 && !this.#writer, "vector loan active"); }
  #index(index) {
    ensure(Number.isSafeInteger(index) && index >= 0 &&
      index < this.#values.length, "vector index out of bounds");
  }
  reserve(minCapacity) {
    this.#exclusive();
    ensure(Number.isSafeInteger(minCapacity) && minCapacity >= 0 &&
      minCapacity <= this.#limit, "vector capacity overflow or quota");
    if (minCapacity <= this.#capacity) return;
    this.#capacity = Math.min(this.#limit,
      Math.max(minCapacity, this.#capacity === 0 ? 1 : this.#capacity * 2));
    this.#epoch++;
  }
  push(value) {
    this.#exclusive();
    // Validate before touching capacity or relocation epoch. In particular,
    // an invalid element must not grow storage then throw halfway through.
    const accepted = scalar(value);
    ensure(this.length < this.#limit, "vector length quota");
    this.reserve(this.length + 1);
    this.#values.push(accepted);
  }
  pop() {
    this.#exclusive();
    return this.#values.length ? { present: true, value: this.#values.pop() } :
      { present: false };
  }
  get(index) {
    ensure(!this.#writer, "vector read conflicts with exclusive loan");
    this.#index(index);
    return this.#values[index];
  }
  set(index, value) {
    this.#exclusive();
    this.#index(index);
    this.#values[index] = scalar(value);
  }
  borrow(index, mode = "read") {
    this.#index(index);
    ensure(mode === "read" || mode === "write", "vector borrow mode");
    if (mode === "read") {
      ensure(!this.#writer, "shared element loan conflicts");
      this.#readers++;
    } else {
      ensure(!this.#writer && this.#readers === 0, "exclusive element loan conflicts");
      this.#writer = true;
    }
    const epoch = this.#epoch;
    let active = true;
    const self = this;
    return Object.freeze({
      read() { ensure(active && self.#epoch === epoch, "stale element view"); return self.#values[index]; },
      write(value) {
        ensure(active && mode === "write" && self.#epoch === epoch, "element write needs live exclusive loan");
        self.#values[index] = scalar(value);
      },
      close() {
        ensure(active, "element loan double-close");
        active = false;
        if (mode === "read") self.#readers--;
        else self.#writer = false;
      }
    });
  }
}

export class GuardedCellReference {
  #value;
  #readers = 0;
  #writer = false;
  constructor(value) { this.#value = scalar(value); }
  with_write(callback) {
    ensure(!this.#writer && this.#readers === 0 &&
      typeof callback === "function", "mutex contention or callback");
    this.#writer = true;
    let active = true;
    const guard = Object.freeze({
      read: () => {
        ensure(active && this.#writer, "expired write guard");
        return this.#value;
      },
      write: value => {
        ensure(active && this.#writer, "expired write guard");
        this.#value = scalar(value);
      }
    });
    try {
      const result = callback(guard);
      ensure(!(result && typeof result.then === "function"),
        "suspending while holding synchronous guard");
      ensure(result !== guard, "cannot return write guard from callback");
      return result;
    } finally {
      // Revocation is essential: a closure can otherwise retain this guard
      // and mutate after the lock is released, even in a single JS turn.
      active = false;
      this.#writer = false;
    }
  }
  with_read(callback) {
    ensure(!this.#writer && typeof callback === "function",
      "read conflicts with writer");
    this.#readers++;
    let active = true;
    const view = Object.freeze({
      read: () => {
        ensure(active && !this.#writer, "expired read guard");
        return this.#value;
      }
    });
    try {
      const result = callback(view.read());
      ensure(!(result && typeof result.then === "function"),
        "suspending while holding synchronous read guard");
      ensure(result !== view, "cannot return read guard");
      return result;
    } finally {
      active = false;
      this.#readers--;
    }
  }
}

export class ArcReference {
  #control;
  #live = true;
  #activeGuards = 0;
  constructor(value, control, authorization) {
    if (control !== undefined) {
      ensure(authorization === internal, "forged Arc");
      this.#control = control;
    } else {
      ensure(value instanceof GuardedCellReference ||
        value === scalar(value), "Arc payload must be scalar or guarded");
      this.#control = { value, strong: 1, weak: 0, dropped: false };
    }
  }
  #check() { ensure(this.#live && !this.#control.dropped, "dropped Arc handle"); }
  clone() {
    this.#check();
    ensure(this.#control.strong < Number.MAX_SAFE_INTEGER, "strong count overflow");
    this.#control.strong++;
    return new ArcReference(undefined, this.#control, internal);
  }
  read() {
    this.#check();
    const referent = this.#control.value;
    if (!(referent instanceof GuardedCellReference)) return referent;
    // A saved view is checked on use and cannot keep an Arc alive secretly.
    // Each synchronous callback pins the originating live Arc handle.
    const invoke = (method, callback) => {
      this.#check();
      this.#activeGuards++;
      try { return referent[method](callback); }
      finally { this.#activeGuards--; }
    };
    return Object.freeze({
      with_write: callback => invoke("with_write", callback),
      with_read: callback => invoke("with_read", callback)
    });
  }
  downgrade() {
    this.#check();
    this.#control.weak++;
    return new WeakReferenceOracle(this.#control, internal);
  }
  drop() {
    this.#check();
    ensure(this.#activeGuards === 0, "cannot drop Arc during active guard");
    this.#live = false;
    const c = this.#control;
    c.strong--;
    if (c.strong === 0) { c.value = null; c.dropped = true; }
  }
  get strongCount() { this.#check(); return this.#control.strong; }
}

export class WeakReferenceOracle {
  #control;
  #live = true;
  constructor(control, authorization) {
    ensure(authorization === internal, "forged Weak");
    this.#control = control;
  }
  upgrade() {
    ensure(this.#live, "dropped Weak");
    const c = this.#control;
    if (c.strong === 0) return null;
    ensure(c.strong < Number.MAX_SAFE_INTEGER, "strong count overflow");
    c.strong++;
    return new ArcReference(undefined, c, internal);
  }
  drop() {
    ensure(this.#live, "Weak double drop");
    this.#live = false;
    this.#control.weak--;
  }
}
