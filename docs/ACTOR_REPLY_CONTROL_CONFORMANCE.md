# Actor reply/callable-return parity gate — proposed source contract

This proposal records the chosen Oreslang language semantics while keeping
compiler support **pending**. Source Git blobs in `manifest.json` must be byte
identical to the fixtures. The Node tests exercise *only fixture admission,
integrity and classification*, not actual Java/GraalVM/LLVM compilation.

Canonical `receive(Message m): void` replies via `self.respond()` and
separately calls `self.done()`. A callable may use `return match` as a
value-producing expression or `do match` with an enclosing-callable return.
No callable return automatically sends a reply.

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

Every actor-reply fixture declares the same `Message` enum. Proposed `match`
examples cover both `Compute` and `Result` alternatives, so a backend that
requires exhaustiveness cannot reject an intended positive case solely for an
unhandled enum alternative. Negative actor fixtures use the same
`@Implements` receiver marker as the positive actor fixture. Tests pin each
fixture to its exact Git blob and separately assert these preconditions.

This is fixture hygiene, **not** confirmation that any compiler accepts the
proposed syntax or that negative cases fail for the claimed diagnostic. Real
backend outcomes remain pending until executable compiler tests are recorded.
