# Actor-owned memory and GC profile admission v1

**Status: declaration-only cross-backend policy, not executed compiler/guest proof.**

Oreslang must distinguish **deterministic actor-owned deallocation** from
**absence of guest tracing GC** and **absence of host-runtime GC**. These are
three separate propositions; neither an arena API nor a successful parser test
promotes the other two.

## Profiles and current audit boundary

| Toolchain | Runtime substrate | Target | What cannot be claimed yet |
| --- | --- | --- | --- |
| Java/Graal | JVM-managed objects plus direct/FFM actor arenas | low/near-zero *guest allocation pressure* | JVM/native-image isolates do not cease tracing |
| LLVM | native C/C++ actor regions, opaque handles and drops | full source-level zero guest tracing; bounded hard-RT actor turns | general class/actor drop lowering, FFI closure and WCET not proven |
| Wasm | bounded private linear memory, presently Node worker host | full source-level zero *Wasm guest tracing* | JS/V8 still GC; host-only arenas are not source lowering |
| Cranelift | Rust-native scalar JIT | future actor-owned no-tracing regions | source actors/heaps unsupported on `main` |
| .NET | `NativeMemory` payload arenas plus managed control metadata | low/near-zero managed allocation pressure | NativeAOT still uses managed GC |
| Forge | native C++ heap/mailbox runtime | no-tracing actor runtime after compiled integration | host prototype is not general source-actor lowering |

An actor's persistent region survives handler turns and carrier migration;
its scratch region is erased and invalidated at every turn exit. A suspension
may retain a *lifetime-only pin*, never raw byte authority. Actor STOP fences
all new access immediately, while actual reclamation waits for the last turn,
reader, callback, FFI, child-process, async-I/O and borrowed view.

Compile-time ownership and runtime reclamation are separate requirements.
Owned values must have generated drop glue on every control-flow edge, with
partial-init/move flags, weak/nonowning cycle edges or explicit region
ownership. Native allocator calls at startup are allowed in a
*no-tracing-GC* profile but require separate budgeting and prefaulting for
hard real time; `malloc` and `free` inside a critical turn are not a valid
unbounded real-time fallback.

## LLVM strict gate

- Enumerate **every source guest allocation** and prove stack/register,
  actor-owned native heap, bounded scratch or explicitly shared domain.
- Inspect exact compiled LLVM IR and the linked image for GC strategy,
  statepoints, safepoints, implicit managed allocation and unexpected calls.
  A string search for `gc.statepoint` alone is insufficient; close the
  transitive runtime and FFI call graph.
- Prove destructor/drop counters, exceptional exits, actor restart and
  callback quiescence on genuine compiled guest runs with ASan/UBSan.
- For hard-RT qualification separately require static budgets, prefault +
  platform page locking, no turn-time OS allocation, and observed WCET under
  the target scheduler, architecture and load.

## Wasm strict gate

- Admit **original, immutable Wasm bytes**, not an opaque precompiled module.
  Deny Wasm-GC/reference opcodes/types, shared memories, unbounded
  `memory.grow`, imports capable of escaping the ownership closure and
  unknown extensions before compilation.
- Compile source-owned classes/arrays/messages to bounded **linear-memory
  offsets** and deterministic drops. Test two guest actors with isolated
  memories and no cross-actor raw views.
- Require an explicit host ABI for interrupt/cancellation, callbacks and
  ownership leases. A JS host wrapper can itself allocate and collect;
  it cannot certify whole-process zero GC. A Rust/Wasmtime host may avoid
  tracing GC but still needs native allocation, FFI and lifecycle audits.

## Evidence admission

The machine-readable
`contracts/actor_gc_profiles_v1.json` carries **13 proof obligations** and
**18 required conformance cases**. The dependency-free Rust source-only verifier locks the reviewed JSON policy at token level, rejecting any changed value or inventory (including duplicate-key and unearned-certification attempts). A deliberate policy change requires a coordinated code review of the embedded baseline. The verifier rejects missing
backends, suppressed cases, host/guest conflation, false full-zero claims or
fabricated certification. Run:

```sh
rustc --edition=2021 -D warnings scripts/verify_actor_gc_profiles_v1.rs -o /tmp/actor-gc-policy
/tmp/actor-gc-policy
rustc --edition=2021 -D warnings --test scripts/verify_actor_gc_profiles_v1.rs -o /tmp/actor-gc-policy-tests
/tmp/actor-gc-policy-tests
```

These tests prove the release *policy* has not been weakened. They do not run
Oreslang toolchains or prove zero GC. Promotion requires exact SHA/tree and
artifact digest, exact target/profile, emitted IR/binary inspection, independently
recorded allocations and drops, leak/UAF/cycle/lease tests, and stepful CI
execution. A failed zero-step source-org Actions run is `NOT_EXECUTED`, not
a negative Oreslang behavior result.

Incremental implementation priority: LLVM compiled drop/arena wiring;
Wasm compiled linear-memory actor lowering and host pin integration;
Java and .NET managed-allocation counters + off-heap representation; Forge
native actor memory; Cranelift remain fail-closed until actor heap compiler
support lands.
