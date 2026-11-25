import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/state_regions/physical-quiescence-v1.json", import.meta.url),
  "utf8",
));

class PhysicalQuiescenceOracle {
  constructor(capacity = 64) {
    this.capacity = capacity;
    this.pins = new Map();
    this.ticketsEverIssued = new Set();
    this.retiring = false;
    this.closed = false;
    this.guestStarts = 0;
    this.rejectedStarts = 0;
  }
  run([op, id, expected]) {
    switch (op) {
      case "pin":
        if (this.retiring || this.closed || this.pins.size >= this.capacity ||
            this.ticketsEverIssued.has(id)) {
          throw new Error("pin admission rejected");
        }
        this.pins.set(id, { started: false });
        this.ticketsEverIssued.add(id);
        return;
      case "start": {
        const pin = this.pins.get(id);
        if (!pin) throw new Error("unissued or released pin");
        const granted = !this.retiring && !this.closed && !pin.started;
        if (granted) {
          pin.started = true;
          this.guestStarts++;
        } else {
          this.rejectedStarts++;
        }
        assert.equal(granted, expected, "unexpected task entry after region STOP");
        return;
      }
      case "finish":
        if (!this.pins.has(id)) throw new Error("duplicate or foreign completion");
        this.pins.delete(id);
        return;
      case "reject": {
        const pin = this.pins.get(id);
        if (!pin || pin.started) throw new Error("cannot reject a running or missing task");
        this.pins.delete(id);
        return;
      }
      case "retire":
        this.retiring = true;
        return;
      case "close": {
        this.retiring = true;
        const canClose = this.pins.size === 0;
        if (canClose) this.closed = true;
        assert.equal(canClose, id, "reclaimed a region before physical completion");
        return;
      }
      case "mutate": {
        // Lifetime holds deliberately do not act as incompatible read loans.
        const allowed = !this.retiring && !this.closed;
        assert.equal(allowed, id, "lifetime pin incorrectly grants or denies write");
        return;
      }
      default:
        throw new Error("unknown state-region operation: " + op);
    }
  }
  assertSafety() {
    assert.equal(this.closed && this.pins.size > 0, false,
      "physically reclaimed with unretired task/FFI pins");
    assert.ok(this.pins.size <= this.capacity, "pin budget exceeded");
  }
}

test("ten canonical physical quiescence vectors including both actor-IO drain orders", () => {
  assert.equal(contract.contractVersion, "1.0");
  assert.equal(contract.physicalLifetimeVectors.length, 10);
  for (const vector of contract.physicalLifetimeVectors) {
    const model = new PhysicalQuiescenceOracle(vector.capacity ?? 64);
    for (const action of vector.actions) {
      if (action.at(-1) === "error") {
        assert.throws(() => model.run(action), { name: "Error" },
          vector.id + " must reject " + action[0]);
      } else {
        model.run(action);
      }
      model.assertSafety();
    }
    assert.deepEqual(
      { guestStarts: model.guestStarts, rejectedStarts: model.rejectedStarts,
        pins: model.pins.size, closed: model.closed },
      vector.expected, vector.id,
    );
  }
});

test("required compiler gates remain separate from the source-free oracle", () => {
  assert.equal(contract.guestCompilerGates.length, 8);
  const ids = new Set();
  for (const item of contract.guestCompilerGates) {
    assert.ok(!ids.has(item.id), "duplicate fixture ID");
    ids.add(item.id);
    assert.ok(["reject", "allow", "rollback", "defer-release"].includes(item.expected));
    assert.ok(typeof item.reason === "string" && item.reason.length > 15);
  }
  assert.match(contract.status, /never compiler or runner evidence/i);
});

test("retirement/physical-completion orders cannot reclaim live pins", () => {
  for (let mask = 0; mask < 256; mask++) {
    const m = new PhysicalQuiescenceOracle(2);
    m.run(["pin", "A"]);
    m.run(["pin", "B"]);
    if (mask & 1) m.run(["start", "A", true]);
    if (mask & 2) m.run(["start", "B", true]);
    m.run(["retire"]);
    for (let step = 0; step < 8; step++) {
      if ((mask >> (2 + (step % 6))) & 1) {
        if (m.pins.has("A")) m.run(["finish", "A"]);
      } else if (m.pins.has("B")) {
        m.run(["finish", "B"]);
      }
      m.run(["close", m.pins.size === 0]);
      m.assertSafety();
    }
    if (m.pins.has("A")) m.run(["finish", "A"]);
    if (m.pins.has("B")) m.run(["finish", "B"]);
    m.run(["close", true]);
    m.assertSafety();
    assert.equal(m.pins.size, 0);
  }
});
