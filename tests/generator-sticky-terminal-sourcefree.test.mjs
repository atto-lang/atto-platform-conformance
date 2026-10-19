import test from "node:test";
import assert from "node:assert/strict";

// Source-free lifecycle reference, NOT executable Oreslang Java/AOT evidence.
// The Java integration regression is GeneratorTerminalFailureStickyTest.
function activation(events) {
  return {
    events: [...events], closed: false, done: false, failure: null, effects: 0,
    next() {
      if (this.closed) return {done: true};
      if (this.failure) throw this.failure;
      if (this.done) return {done: true};
      const event = this.events.shift();
      if (!event) throw Error("missing producer event");
      if (event.kind === "value") {
        this.effects++;
        return {done: false, value: event.value};
      }
      this.done = true;
      if (event.kind === "failure") {
        this.failure = event.error;
        throw this.failure;
      }
      return {done: true};
    },
    close() { this.closed = true; this.done = true; }
  };
}
test("guest producer error stays terminal and observable for 128 subsequent pulls", () => {
  const error = new Error("producer failed");
  const a = activation([{kind:"value",value:9},{kind:"failure",error}]);
  assert.deepEqual(a.next(),{done:false,value:9});
  for(let i=0;i<128;i++)assert.throws(()=>a.next(),e=>e===error);
  assert.equal(a.effects,1);
  a.close();
  assert.deepEqual(a.next(),{done:true});
});
test("normal producer completion is permanently DONE without re-entry", () => {
  const a = activation([{kind:"value",value:4},{kind:"done"}]);
  assert.equal(a.next().value,4);
  for(let i=0;i<128;i++)assert.deepEqual(a.next(),{done:true});
  assert.equal(a.effects,1);
});
test("mutant demonstrates why converting failure into DONE is unsafe", () => {
  const error = new Error("lost");
  const mutant = {done:false};
  function pull() { if(mutant.done)return {done:true};mutant.done=true;throw error; }
  assert.throws(pull,e=>e===error);
  assert.deepEqual(pull(),{done:true});
});
