# Unified inferred effects v2 — AttoLang reference contract

**Status: SOURCE_FREE_MODEL_NOT_GUEST_EXECUTION.** The 31-case JSON matrix and Python oracle model target effect inference over an already-resolved, closed-world call graph. They are **not** an AttoLang compiler, typed-HIR exporter, trusted effect summary, authority engine, WCET analysis or release proof. All 11 backend status cells are `NOT_EXECUTED` by design.

This is additive to [function effects v1](../../v1/FUNCTION_EFFECTS_V1.md). v1's `with` upper bounds, exceptional effects, `trap`, protected actor state and suspension semantics remain in force. Source semantics are in [atto-spec's unified-effects v1 proposal](https://github.com/atto-lang/atto-spec/blob/feature/unified-inferred-effects-v1-20261121/language/unified-inferred-effects-v1.md).

## What the oracle models

- Exact operation-to-may-effect rows, transitive propagation over direct and *sealed* dynamic targets, cyclic fixed points and a deterministic effect-bound verdict.
- `bound: null` means infer, `bound: []` means explicitly no effects. A declared row may use `io` as a coarse super-effect for legacy compatibility, but `nondet` is independent.
- Pure code can allocate invocation-private memory but cannot observe/mutate external state. Deterministic profile forbids untrusted ambient clock, entropy, environment and file/network observations even through helpers.
- `hard_rt` conservatively rejects allocation, FFI, I/O, suspension, exceptional control, unproven recursion, unknown/unbounded work and other unqualified effects. `work: bounded` is *caller-supplied*, not proven; an `accept` is **only a model compatibility result, never hard-RT certification**.
- `critical_read` rejects state writes, and both `critical_read`/`critical_write` reject a transitive suspension/blocking/spawn/foreign call. Runtime capabilities, actor read/write loans and I/O resource-specific authorization remain independent.
- A call with `sealed: false`, an unresolved target or an unknown primitive fails closed. A sealed target set is trusted **only inside this supplied model**; a real compiler must authenticate and exhaustively prove it.

## Run the source-free checks

```sh
python3 contracts/v2/unified-effects-v2/verify.py
python3 -m unittest discover -s contracts/v2/unified-effects-v2 -p 'test_*.py' -v
```

The suite checks the matrix, exact schema, spoofed backend evidence, illegal operation labels, unknown calls, duplicate cases, transitive bounds, recursion, protected state and ambient clock observation. No source files are compiled or executed.

## What remains for compiler parity

1. Define a typed CFG/HIR/MIR effect summary schema after name/type resolution and macro expansion. Enumerate exception, cancellation, destructor, `finally`, implicit allocation/cooperation, FFI, dynamic dispatch and callbacks; encode no-call versus unknown-call distinctly.
2. Port the inference checker and fixed-point diagnostics into the production compilers; serialize summary metadata for AOT/link-time checking. Do not derive effects from token substring matching or source-free test models.
3. Provide byte-identical `.atto` positive/targeted-reject fixtures for Java, LLVM, .NET, Wasm, Forge, Rust, Cranelift, JavaScript, HDL, self-hosted and real-time targets; never turn generic parse errors into success.
4. Build and test exact current compiler SHA, runtime/stdlib closure, permission enforcement and qualified hard-RT WCET/stack/interrupt budgets on relevant targets. Require genuine executed CI steps and immutable evidence; an unadmitted Actions run is `NOT_EXECUTED`.

This work intentionally does **not** alter v1's parser contract, existing exception spelling, ownership rules, capability policy or published backend results.
