# Typed open Maps: semantics and backend admission

These fixtures record the intended first-iteration contract for typed, open `Map<string, unknown>` subclasses:

- A `key name: Option<T>;` declaration defines a typed map entry, not a physical class field.
- Known keys are statically checked; arbitrary string keys remain open, but unknown values require narrowing.
- `get` and indexed reads may return only recursively `Copy` values. `remove` transfers ownership of stored non-`Copy` values.
- `put` and `remove` require exclusive mutable receiver access; borrowed references cannot be persisted via method or bracket writes.
- All supported reads/writes/removes pass through synchronous, non-reentrant `on_get`, `on_put`, `on_remove` hooks.
- Overwriting an owned non-`Copy` value requires explicit `remove()` and owner handling first, until an exact-once drop/replacement contract exists.
- Class Map object access requires actor critical-region guarding before relying on cross-turn shared state; that integration is not proven here.

## Evidence and limitations

The Java/GraalVM reference implementation is tracked in [PR #636](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/636). [GraalVM 25 exact-tree integration](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38169338231) passed 192 selected JUnit tests, including the new Map suite and ownership/actor/mutex regressions. The standalone **positive** fixture `known-open-hooks.ores` was independently executed in GraalVM from its exact byte-pinned Git blob and returned `PPGhelloGtrueRGtrue`: [verified runtime plus 192 Java tests](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38169660071). The **three negative fixtures** have only equivalent-source JUnit rejection evidence, not standalone exact-fixture execution. The manifest distinguishes `exactFixtureExecution: verified` for the positive source from `pending` for the negative sources, rather than treating their static hash validation as compiler verification.

LLVM, WASM, and browser are **pending**, not confirmed. No cross-backend parity is implied. Promote a backend only after running the exact fixture SHA on a pinned compiler build with separately recorded raw logs, output/diagnostic comparison, and evidence links.

See `fixtures/typed-maps/manifest.json` and `tests/typed-maps.test.mjs`.
