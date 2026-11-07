# Executable backend conformance review gate: AOT and zero-GC controlled dynamism v1

**TARGET / proposal only — no backend implementation or parity proven.** Canonical language-spec amendment: https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/18. Organization contributor policy: https://github.com/ores-truffle-oreslang/.github/pull/38.

## Full guest AOT is not host AOT

Require an explicit mode: interpreter/JIT/hybrid, host-only AOT, **sealed full guest AOT**, or governed precompiled-module AOT with versioned ABI, capabilities and generation fencing. In sealed AOT every reachable guest function, method target, proxy, generic specialization, reflection descriptor and async/closure state machine is compiled before execution. Reject runtime eval, source/bytecode compilation, class/method injection, monkey-patching, unrestricted reflection, open-ended proxy target selection and hidden interpreter/JIT fallback before emitting executable IR.

Finite compile-time dispatch, inheritance, typed proxy wrappers for known classes/interfaces, typeclasses, hygienic macros, runtime data values and statically compiled closures are allowed. Maintain static-versus-instance separation, privacy, effects and reachability. An unsupported feature must fail closed rather than being shadow-implemented in a host interpreter.

## Zero GC is not zero allocation

State separately whether managed host GC exists, whether **guest-owned** memory requires tracing GC, and whether the **entire process** has no GC. GraalVM Native Image, .NET NativeAOT and browser JS may retain a tracing collector; Wasm linear-memory ownership does not remove host GC. Native AOT does not guarantee fixed-time drops, hard real time or leak freedom.

Every allocation/actor heap/task frame/closure environment needs provenance, explicit take/copy/borrow/share checking, bounded admission, fallible allocation and exactly-once drop across return, await, cancellation, restart and outstanding I/O. Long-lived actors must reclaim temporary allocations while alive. Strong cycles require weak/region strategies; channels/pub-sub transfer only Sendable data, not closures, functions, raw pointers or borrowed actor state. Preserve no implicit conversions or operator overloading, no percent/caret/caret-caret operator reintroduction, and no automatic nested Option/Future flattening.

## Executable backend conformance review gate

Require same pinned canonical .atto fixtures across independent compilers, emitted artifacts and executed guest outputs. A Node fixture/schema checker or host model cannot certify a backend. Link source and compiler head/tree/fixture blob, job/runner/steps and generated executable hash; separately measure GC/allocator and reject fallback.

## Required positive, negative and stress matrix

| Compile and execute positive | Reject before IR or stress at runtime |
| --- | --- |
| Statically generated known-class proxy, virtual dispatch and separate static facade | runtime eval, unknown proxy class, private escalation, method-tree-shake omission |
| Finite static reflection registry, macro/generic specialization | runtime method/class injection, unregistered reflection/ABI, fallback to interpreter/JIT |
| Move-safe closure and task frame across valid suspension | escaping borrow, use-after-take, double-drop, function/closure sent through channel |
| Actor-owned allocator and bounded memory churn while actor remains live | strong cycle with no lifetime strategy, quota/OOM, restart with pending I/O, stale generation |
| Actual native/wasm/target guest artifact and executed output | parser-only, host/mock fixture, JSON-only receipt, steps=[] or steps=null |

For each backend, capture source head/tree SHA, unchanged canonical .atto fixture blob, compiler binary digest, emitted artifact hash, nonzero executed runner/job steps and appropriate guest/allocator/GC evidence. Never label unauthenticated or zero-step work as a pass. Track Java/GraalVM, LLVM, .NET NativeAOT, Wasm, Forge and Cranelift separately; JS/Rust/HDL subset claims have profile-specific limits.

This is additive to Rust-only tooling, source-first .atto libraries, private-source transfer approval, branch protection and independent security review.
