# Actor reply/callable-return parity gate — proposed source contract

This proposal records the chosen Oreslang language semantics while keeping
compiler support **pending**. Source Git blobs in `manifest.json` must be byte
identical to the fixtures. The Node tests exercise *only fixture admission,
integrity and classification*, not actual Java/GraalVM/LLVM compilation.

Canonical `receive(Message m): void` dispatches with **`do match m over`**,
because it performs messaging effects without needing any match expression
value. Its arms use `self.respond()`, `self.forward()`, `self.send()`
as appropriate and explicitly finish the delivery with `self.done()`.

Plain `match m over` is **value-producing**, and `return match` is used
when that value is consumed as a callable return. A procedural `do match`
may also contain a `return` from an enclosing value-returning callable.
Neither form implicitly responds to an actor message; `receive(...): void`
must not return a `Message.Result` value.

`self.forward(target, value)` transfers one outstanding reply correlation;
`self.send(target, value)` sends an unrelated one-way message. Neither
`self.done()` nor a method's bare `return` should invent a response.
`self.done()` finishes the delivery; `self.end()` is an existing, separate
actor lifecycle operation. Double response/forward and non-void returns
from `receive(...): void` are rejected by the intended compiler/runtime.

**The status of every language backend remains pending.** The executable
JavaScript host-reference protocol is in Wasm PR #16, but does not satisfy any
real compiler/guest/browser actor backend evidence gate.

## Fixture diagnostic isolation

Every actor-reply fixture declares the same `Message` enum. The canonical
actor example uses `do match`; value-producing callable examples use
`return match` or procedural `do match` with a callable return. These
examples cover both `Compute` and `Result` alternatives, so a backend that
requires exhaustiveness cannot reject an intended positive case solely for an
unhandled enum alternative. Negative actor fixtures use the same
`@Implements` receiver marker as the positive actor fixture. Tests pin each
fixture to its exact Git blob and separately assert these preconditions.

This is fixture hygiene, **not** confirmation that any compiler accepts the
proposed syntax or that negative cases fail for the claimed diagnostic. Real
backend outcomes remain pending until executable compiler tests are recorded.

## Procedural syntax audit gates

The canonical actor `receive` fixture is checked by a lightweight,
comment/string-aware lexical scanner (`tests/helpers/actor-receive-fixture.mjs`).
It requires `do match` as the only receiver body statement, two exhaustive
`Compute` / `Result` arms, an exactly-once terminal `self.done()` in
each arm, a `Compute` reply before `done()`, and no reply on the one-way
`Result` arm. Adversarial test mutations cover comments and strings that
pretend to contain `do match`, omitted/duplicate `done()` calls, late
responses, and a callable `return` in the receiving arm.

The distinct negative fixture `invalid-do-match-void-return.ores` asserts
that even a **procedural** `do match` cannot return a `Message.Result`
value from `receive(...): void`. That is separate from the negative
`return match` fixture. This scanner verifies only canonical test source
hygiene; it does **not** parse or typecheck arbitrary Oreslang programs.
The actual compiler backends must establish their own grammar, type, effect,
message-reply and control-flow proofs before any admission is promoted.
