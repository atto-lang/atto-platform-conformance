# AttoLang full-AOT execution evidence v2 (candidate)

**Status:** structural, source-free classifier; not a release certificate or a compiler-backed test. Existing `.ores` paths and `ores_*` identifiers remain for compatibility.

## Motivation

Distinguish program-specific guest AOT from a Graal Native Image / .NET NativeAOT that merely packages a guest interpreter, from a Cranelift/LLVM relocatable object that is not linked, from a Wasmtime host without a closed guest module, and from optional JIT-only or hybrid operation.

`lib/aot-execution-evidence-v2.mjs` exports the backward-compatible `classifyAotExecutionEvidence(receipt, trustedExpected)` and the **strict backend-bound** `classifyAotExecutionEvidenceForBackend(receipt, trustedExpected)`. For new backend-specific evidence checks, the caller MUST supply an independently retrieved exact `{sourceCommit, sourceTree, backend}` selector and call the strict entrypoint. Source-only two-field selectors remain accepted by the legacy helper for compatibility; they do **not** establish backend identity. Forge and Cranelift are two distinct lanes, never aliases. A self-reported receipt cannot authenticate GitHub job steps, compiler provenance, toolchain identity, a real guest entrypoint, absence of JIT, independent approval, or release eligibility. **Every classification, including AOT_STRUCTURAL_REVIEW_REQUIRED, carries ok=false and releaseQualified=false. structurallyValid=true is informational and must not be treated as promotion.**

Canonical receipt and selector records must have exactly their declared **own, enumerable string-keyed data fields**. Hidden symbol keys, non-enumerable properties, getters, inherited fields and throwing Proxy traps are denied. A matching synthetic receipt or forged claimed step count remains **structural only**; this validator never authenticates GitHub Actions or releases a backend.

## Admission semantics

- full-aot: linked program-specific native guest executable (or closed guest Wasm module), compiled guest entrypoint and output, full verified-language closure as declared, interpreter/JIT/runtime guest compiler absent, executed JIT-disabled baseline.
- hybrid: same AOT requirements and a JIT-disabled baseline first. Optional optimization JIT may run in a separate mode. Requiring JIT for correctness fails.
- jit: JIT-only guest claims must identify a JIT-only artifact and report actual runtime guest JIT use, **without claiming an AOT JIT-disabled baseline**. These remain JIT_ONLY_STRUCTURAL_REVIEW_REQUIRED and never count as AOT.
- NOT_EXECUTED and UNSUPPORTED are non-promoting. They require **all nine AOT closure flags to be false**, no compiler or guest artifact hashes, no runner assignment and zero executed steps. FALSE is an absence-of-proof state, not evidence that the compiler lacks these features. FAILED with zero steps is malformed; zero-step runner admission must be NOT_EXECUTED rather than a compiler failure.
- The closure flags are macro elimination, resolved imports, finite generics, closed actor handlers, emitted async continuations, static dispatch, effect checks, ownership checks, and absence of a runtime guest compiler.
- Trusted/untrusted source and actor isolation (none/shared/isolated/untrusted) are independent axes. Untrusted code may use explicitly governed JIT; trusted shared and isolated actor programs must be AOT-capable.

## Minimum independent backend proofs

| Backend | AOT artifact and guest behavior | False proof to reject | Separate memory verification |
| --- | --- | --- | --- |
| Java/GraalVM | Native Image with program-specific compiled guest handlers, functions and continuations | Native Image of Truffle guest interpreter alone | GC roots, real off-heap actor arenas |
| LLVM | typed guest MIR -> linked native guest executable, exact guest entrypoint | LLVM object, OresVM host-only execution, ORC fallback | retirement fencing, arena lifecycle, sanitizers |
| .NET NativeAOT | linked program-specific guest native methods and actor code | NativeAOT host that interprets guest source | managed vs native allocations and deterministic drop |
| Wasm | closed compiled guest module instantiated and executed | Wasmtime host alone | linear-memory lifetime and isolate fencing |
| Forge | standalone linked compiled guest executable for the Forge target | inferred parity from Cranelift/LLVM output or an unlinked host model | native ownership, actor heaps and frame retirement |
| Cranelift | linked standalone guest executable | scalar JIT or unlinked object | native ownership and actor heap safety |

Source commit and tree identifiers reject all-zero SHA-1 placeholders; assigned runner names must be bounded, nonblank, canonical and control-character-free. These are basic structural defenses only: receipt assertions still require independent GitHub job/step/readback verification.

## Required promotion sequence

1. Independently retrieve exact source commit and full Git-tree identity, canonical guest fixture bytes and compiler/toolchain digest.
2. Execute actual compiler positives/negatives with nonzero GitHub job steps, check run attempt, runner, output and guest entrypoint. Negative tests include ownership/capability violation, unsupported actor handler lowering, unbounded specialization and source compiler fallback.
3. Hash the linked native executable or closed Wasm module, not only a host runtime or relocatable object; verify program-specific guest functions are in that image.
4. Run the **same program** with guest JIT/interpreter disabled. Confirm no runtime macro expansion/source eval is required. For hybrid, separately compare optimized JIT behavior to JIT-off AOT semantics.
5. Run independent memory/GC, actor quiescence, tenant isolation and realtime evidence before claiming those properties; AOT compilation alone proves none of them.
6. Authenticate GitHub job steps, hashes, build provenance and independent approval outside this untrusted JSON classifier. Do not mirror private source to another organization without explicitly approved private transfer.

## Local source-free test

    node --test tests/aot-execution-evidence-v2.test.mjs tests/aot-stage-evidence-negative-matrix.test.mjs tests/aot-backend-lane-identity-v2.test.mjs tests/aot-stage-execution-boundaries-v2.test.mjs

These Node suites test structural classification, independent backend-lane binding, and adversarial substitution only. They do **not** execute any AttoLang compiler or guest program. Existing v1 validator remains backward-compatible and unmodified.
