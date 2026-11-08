# Immutable container snapshots + `critical` publication — v1 candidate

**Status: source-language contract and source-free reference tests only.**
No Java/GraalVM, LLVM, .NET NativeAOT, Wasm or Forge source compiler is
certified by this document. Run real, byte-identical `.atto` fixtures to
establish backend parity. This contract complements compressed32 actor heap
contract #157 and demand allocation #606.

## Semantics

The canonical portable core/std data containers
`PersistentMap<K,V>`, `PersistentSet<T>` and `PersistentList<T>` are
*transitively immutable* values. Their update APIs (`with`, `without`,
`insert`, `remove`, `append`...) return **new roots** via path-copy/
structural sharing. Callers holding earlier roots observe their unchanged
contents even after concurrent publication of a new version. A frozen wrapper
over a mutable map, array, reference, closure or FFI pointer is **not** enough.

**Thread-safe immutable reads do not need a lock** after a snapshot is safely
published and its lifetime is pinned. A read of the *root+revision pair* must
be atomic, for example under `critical`. A single published immutable root is
shareable only when reachable elements satisfy transitively frozen
`Sendable` rules and the root has a separately granted shared-region
capability. It may not contain an actor-local raw 32-bit offset; two actors
may independently have the same ref32 word but different objects.

**Updates use critical publication, not mutable shared container writes.**

1. Take an immutable snapshot `(root, revision)` with a validated lifetime
   pin; release the critical section. This pin does not authorize cross-actor
   heap reads.
2. Compute a new persistent root *outside* `critical`, allocating and
   structurally sharing through the correct explicit shared-region owner.
   If construction fails or is cancelled, the published root stays intact.
3. Enter `critical`: compare current revision to expected revision; if
   equal, publish new root and increment revision atomically. A failed compare
   changes neither root nor revision. The critical body cannot suspend, await,
   wait for backpressure, block on I/O/FFI, or run an unbounded retry.
4. On conflict, leave the critical section, release the abandoned candidate
   and reconstruct from a fresh snapshot. Keep old roots alive while any
   reader holds a lifetime pin or hazard/epoch lease. Reclaim only on reader
   quiescence, with an explicit memory budget.
5. A `suspends fnc` may acquire `critical` (contention may queue its task),
   but the **body never suspends**. `critical suspends fnc` and
   `suspends critical fnc` are invalid declaration shapes. The actor turn
   nonreentrancy guarantee is separate from the shared-container critical
   admission. A `critical fnc` cannot suspend.

The following is **illustrative AttoLang API shape**, *not compiler-tested
guest source*. `FrozenMap` and `SharedSnapshotRoot` are target
portable-library types that require compiler/runtime work:

```atto
suspends fnc update_prices(store: SharedSnapshotRoot<FrozenMap<string, int>>,
                           key: string, price: int) -> bool {
  const previous = store.snapshot();
  const candidate = previous.root.with(key, price);
  critical {
    return store.publish_if_revision(previous.revision, candidate);
  }
}
```

The `snapshot()` and `publish_if_revision()` primitives must be
typed-effect and capability checked. Implement the portable map/set/list
algorithms in `.atto`; use host code only for checked arena allocation,
atomic root publication, read-pin accounting and native platform integration.
The compiler must refuse unsupported constructs instead of silently
substituting CLR/JVM managed-map mutation or an unguarded native pointer.

## Source/compiler negative suite

- A borrowed mutable list/map or closure cannot be frozen implicitly.
- A raw actor-local ref32 may not appear in a cross-actor shared snapshot.
- `await`, `select` suspension and blocking I/O in a critical body are
  compile-time errors.
- Both declaration orders mixing `critical` with `suspends` are rejected.
- Revisions must never wrap, and no stale root may be republished.
- `Sendable` is distinct from `Serializable`; a valid shared snapshot
  is not automatically a wire value.
- Lifetime/loan revocation on actor shutdown, cancellation and hot reload
  must be generation fenced.

## Verification / evidence

Manifest: `contracts/immutable-containers-critical-v1.json`.
Reference tests: `tests/immutable-containers-critical-v1.test.mjs`.
They exercise model path-copy, stale-writer rejection, one-winner
publication, snapshot lease retirement, nested mutable rejection, and
critical effect constraints. These **Node tests do not prove actual
parallelism or compiler execution**. Add real two-carrier, two-writer
stress, native race/TSan where available, exact-head AOT execution and
negative compiler tests across all five backends before a PASS claim.
