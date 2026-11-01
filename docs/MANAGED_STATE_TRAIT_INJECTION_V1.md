# Managed state trait injection v1 — design and regression candidate

**Status: source-free reference policy, NOT compiler execution or five-backend parity.**

Contract: `contracts/managed-state-trait-injection-v1.json`; reference oracle:
`src/managed-state-trait-injection-v1.mjs`; tests:
`node --test tests/managed-state-trait-injection-v1.test.mjs` (Node 22).

## Proposed syntax — not yet admitted Oreslang grammar

```oreslang
define trait Stateful<S> as
    requires state: MutableStateContainer<S>
end

define singleton Counter with Stateful<Counter.State> as
    state {
        let count: int = 0
    }

    increment() -> int ::
        return handle_state(critical-write |s| -> {
            s.count += 1
            s.count
        })
    end
end
```

Alternate provider-backed implementation (choose one binding, never both):

```oreslang
define singleton Counter with Stateful<CounterState> as
    @Inject
    state: MutableStateContainer<CounterState>
end
```

**Grammar review required:** `requires state`, `@Inject`, and singleton `with`
are proposals. Reconcile existing Java trait field ownership and `with`/`is`
grammar (Java #104) before enabling source admission. Do not turn these
samples into a claimed positive compiler fixture until a real compiler runs.

## Precise compiler obligations

1. The trait requires a state slot without allocating its own instance storage,
   minting a capability, or granting direct field access. Existing storage-carrying
   traits must be treated as a distinct feature and reconciled explicitly.
2. A class owns exactly one container per instance. A singleton owns exactly
   one container per runtime application/isolation domain. No process-global
   cross-isolate mutable reference is implicitly created.
3. `state {}` synthesizes a nominal state schema and compiler-owned private
   container. Provider injection must have an exact nominal type, an authorized
   compile-time provider, complete initialization, and the correct owner scope.
   Missing, double-bound, uninitialized or untrusted providers fail closed.
4. Singleton initialization has a single completed publication and sticky
   failure. Cycles, self-escape, and partially published state are forbidden.
5. `critical-read` permits non-mutating concurrent reads; `critical-write`
   permits exclusive mutation. Guarded loans may not be returned, captured
   into closures/Futures, placed in `Box`/`Arc`/vectors, or carried across
   suspension. Runtime provenance is generation-fenced.
6. Neither traits nor annotations enable actor/supervisor injection in this
   v1 candidate: actor state remains sealed; supervisor CONTROL authority
   remains runtime-owned and unforgeable. Later actor-state adapters need
   an explicit separately verified ownership/capability contract.
7. Writer fairness, cancellation races, poisoned arbiters, reentrancy,
   quiescence and teardown need actual runtime tests before shared mutation
   can be claimed. Heap vs stack placement does not weaken borrow checking.


## Trait composition reconciliation blocker

The Java draft #104 currently uses `with Trait<T>` for composition and
`is Interface` for interface conformance, rather than canonical
`implements Trait<T>`. This document therefore proposes `with` for
required-state trait composition. It is not yet an accepted singleton grammar.

More importantly, its `TraitComposer` describes initialized fields flattened
into consuming classes, but `TraitClassInterfaceDelineationTest` requires
`define trait Stateful as private let int count = 0; ... end` to be
rejected as `storage-free`. These are mutually inconsistent without a
distinct classification. The proposed `Stateful<S>` **requirement-only**
contract must be a storage-free obligation; a future **state-owning trait**
is a different compile-time composition feature with collision, constructor,
visibility and lifetime rules. Do not change existing source semantics
silently, and require positive + negative real compiler tests before merging.

## Evidence / merge gates

All 32 positive/negative policy vectors are **source-free**, not .ores
compiler fixtures. For Java/GraalVM, LLVM, WASM, Cranelift and .NET
NativeAOT, the required evidence starts at `NOT_EXECUTED`. Forge is a
separate optional target, NOT an alias of Cranelift.

To promote: identical byte-pinned source tests, a real frontend diagnostic
for negative cases, actual compiled positive guest stdout/exit, exact Git
head and executable compiler hash, nonempty CI job steps, backend-specific
runtime/IR inspection and ASan/UBSan for native backends. Syntax denial
or host-only success can never count as guest execution.

Related: oreslang-platform-conformance #293 declaration taxonomy and
singleton/shared-table v1 on main; oreslang-compilers-parity-testing #12;
Java source #2296 and #104, LLVM #1194, WASM #187, .NET #261,
Cranelift #59. This PR does not alter mandatory manifests, mutate those
compiler branches, or export private source to runner organizations.
