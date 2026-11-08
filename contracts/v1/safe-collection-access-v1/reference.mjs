// Executable *source-free* AttoLang collection borrow reference model.
// This is NOT an AttoLang compiler, guest runtime, or proof of backend parity.
export const MAX_DENSE_LENGTH = 0xffff_fffe;

export class CollectionFault extends Error {
  constructor(code) { super(code); this.name = "CollectionFault"; this.code = code; }
}
function fail(code) { throw new CollectionFault(code); }
function bound(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_DENSE_LENGTH) fail("E_COLLECTION_CAPACITY");
  return n;
}
function signedIndex(index) {
  // Accept exact i64-like integers; never coerce a negative or large integer
  // into an unsigned 32-bit word. JS Number above 2^53 is not exact.
  if (typeof index === "bigint") return index;
  if (typeof index === "number" && Number.isSafeInteger(index)) return BigInt(index);
  fail("E_INDEX_TYPE");
}
const None = Object.freeze({ variant: "None" });
function Some(value) { return Object.freeze({ variant: "Some", value }); }

export class CollectionLoanModel {
  #loans = new Map();
  #nextId = 1;
  #epoch = 1;
  #generation = 1;
  #retired = false;

  constructor({ owner = "actor-A", length = 0, capacity = length,
                immutable = false, copyable = false } = {}) {
    this.length = bound(length);
    this.capacity = bound(capacity);
    if (this.capacity < this.length) fail("E_COLLECTION_CAPACITY");
    this.owner = owner;
    this.immutable = immutable;
    this.copyable = copyable;
  }

  get epoch() { return this.#epoch; }
  get generation() { return this.#generation; }
  get loanCount() { return this.#loans.size; }

  #check(actor) {
    if (this.#retired) fail("E_OWNER_RETIRED");
    if (actor !== this.owner) fail("E_ACTOR_ISOLATION");
  }

  #slot(index) {
    const i = signedIndex(index);
    return i < 0n || i >= BigInt(this.length) ? null : Number(i);
  }

  #newLoan(actor, index, kind) {
    this.#check(actor);
    const slot = this.#slot(index);
    if (slot === null) return None; // Failed get never mints a loan.
    if (kind === "WRITE") {
      if (this.immutable) fail("E_IMMUTABLE");
      if (this.#loans.size) fail("E_LOAN_CONFLICT");
    } else if ([...this.#loans.values()].some(loan => loan.kind === "WRITE")) {
      fail("E_LOAN_CONFLICT");
    }
    const loan = Object.freeze({ id: this.#nextId++, actor,
      index: slot, kind, generation: this.#generation, epoch: this.#epoch });
    this.#loans.set(loan.id, loan);
    return Some(loan);
  }

  get(actor, index) { return this.#newLoan(actor, index, "READ"); }
  getMut(actor, index) { return this.#newLoan(actor, index, "WRITE"); }

  #loan(actor, loan) {
    this.#check(actor);
    if (!loan || this.#loans.get(loan.id) !== loan ||
        loan.actor !== actor || loan.generation !== this.#generation ||
        loan.epoch !== this.#epoch) fail("E_STALE_LOAN");
    return loan;
  }

  useRead(actor, loan) { return this.#loan(actor, loan).index; }
  useWrite(actor, loan) {
    const active = this.#loan(actor, loan);
    if (active.kind !== "WRITE") fail("E_LOAN_READ_ONLY");
    return active.index;
  }

  release(actor, loan) {
    const active = this.#loan(actor, loan);
    this.#loans.delete(active.id);
  }

  #exclusive(actor) {
    this.#check(actor);
    if (this.immutable) fail("E_IMMUTABLE");
    if (this.#loans.size) fail("E_LOAN_CONFLICT");
  }

  reserve(actor, capacity) {
    const target = bound(capacity);
    this.#check(actor);
    if (this.immutable) fail("E_IMMUTABLE");
    if (target <= this.capacity) return; // No relocation/no invalidation.
    this.#exclusive(actor);
    this.capacity = target;
    this.#epoch++;
  }

  push(actor) {
    this.#exclusive(actor);
    if (this.length === MAX_DENSE_LENGTH) fail("E_COLLECTION_CAPACITY");
    const nextLength = this.length + 1;
    if (nextLength > this.capacity) {
      this.capacity = Math.min(MAX_DENSE_LENGTH,
        Math.max(nextLength, this.capacity ? this.capacity * 2 : 1));
    }
    this.length = nextLength;
    this.#epoch++; // Conservative whole-root invalidation.
  }

  pop(actor) {
    this.#exclusive(actor);
    if (!this.length) return None;
    this.length--;
    this.#epoch++;
    return Some({ movedElementAt: this.length });
  }

  getCopy(actor, index) {
    this.#check(actor);
    if (!this.copyable) fail("E_COPY_REQUIRED");
    const slot = this.#slot(index);
    return slot === null ? None : Some({ ownedCopyOfIndex: slot });
  }

  // Indexing is bounds checked; a miss is a contained actor trap, never UB.
  checkedIndex(actor, index) {
    this.#check(actor);
    const slot = this.#slot(index);
    if (slot === null) fail("E_INDEX_BOUNDS");
    return slot;
  }

  suspend(actor) {
    this.#check(actor);
    if (this.#loans.size) fail("E_LOAN_SUSPEND");
  }

  escapeLoan(actor, loan) {
    this.#loan(actor, loan);
    fail("E_LOAN_ESCAPE");
  }

  immutableShare(actor) {
    this.#check(actor);
    if (!this.immutable) fail("E_SHARE_NOT_FROZEN");
    return Object.freeze({ immutable: true, generation: this.#generation });
  }

  moveOwner(actor, newActor) {
    this.#exclusive(actor);
    if (newActor === actor || !newActor) fail("E_INVALID_TRANSFER");
    this.owner = newActor;
    this.#generation++;
    this.#epoch++;
  }

  retire(actor) {
    this.#check(actor);
    if (this.#loans.size) fail("E_LOAN_CONFLICT");
    this.#retired = true;
    this.#generation++;
    this.#epoch++;
  }
}
