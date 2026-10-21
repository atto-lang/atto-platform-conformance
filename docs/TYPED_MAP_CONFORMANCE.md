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

The Java/GraalVM reference implementation is tracked in [PR #636](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/636). [GraalVM 25 exact-tree integration](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38169338231) passed 192 selected JUnit tests, including the new Map suite and ownership/actor/mutex regressions. All **four** byte-pinned standalone fixtures were executed using the actual GraalVM Oreslang runtime/compiler: the positive fixture returned `PPGhelloGtrueRGtrue`; the three negative fixtures were separately rejected via `--check` with the expected borrow-escape, immutable receiver, and non-`Copy` read diagnostics. [Full evidence: 192 selected Maven `verify` tests plus 4 source fixtures and 2 manifest checks](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38170085994). The manifest records each exact GraalVM fixture as `verified`, while other backend statuses remain `pending`.

LLVM, WASM, and browser are **pending**, not confirmed. No cross-backend parity is implied. Promote a backend only after running the exact fixture SHA on a pinned compiler build with separately recorded raw logs, output/diagnostic comparison, and evidence links.

See `fixtures/typed-maps/manifest.json` and `tests/typed-maps.test.mjs`.
