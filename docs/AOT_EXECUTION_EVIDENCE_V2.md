# AttoLang full-AOT execution evidence v2 (candidate)

**Status:** structural, source-free classifier; not a release certificate or a compiler-backed test. Existing `.ores` paths and `ores_*` identifiers remain for compatibility.

## Motivation

Distinguish program-specific guest AOT from a Graal Native Image / .NET NativeAOT that merely packages a guest interpreter, from a Cranelift/LLVM relocatable object that is not linked, from a Wasmtime host without a closed guest module, and from optional JIT-only or hybrid operation.

`lib/aot-execution-evidence-v2.mjs` exports `classifyAotExecutionEvidence(receipt, trustedExpected)`. The caller supplies an independently read source commit/tree selector. A self-reported receipt cannot authenticate GitHub job steps, compiler provenance, toolchain identity, a real guest entrypoint, absence of JIT, independent approval, or release eligibility. **Every classification, including AOT_STRUCTURAL_REVIEW_REQUIRED, carries ok=false and releaseQualified=false. structurallyValid=true is informational and must not be treated as promotion.**

## Admission semantics

- full-aot: linked program-specific native guest executable (or closed guest Wasm module), compiled guest entrypoint and output, full verified-language closure as declared, interpreter/JIT/runtime guest compiler absent, executed JIT-disabled baseline.
- hybrid: same AOT requirements and a JIT-disabled baseline first. Optional optimization JIT may run in a separate mode. Requiring JIT for correctness fails.
- jit: JIT-only guest claims remain JIT_ONLY_STRUCTURAL_REVIEW_REQUIRED and never count as AOT.
- NOT_EXECUTED and UNSUPPORTED are non-promoting. FAILED with zero steps is malformed; zero-step runner admission must be NOT_EXECUTED rather than a compiler failure.
- The closure flags are macro elimination, resolved imports, finite generics, closed actor handlers, emitted async continuations, static dispatch, effect checks, ownership checks, and absence of a runtime guest compiler.
- Trusted/untrusted source and actor isolation (none/shared/isolated/untrusted) are independent axes. Untrusted code may use explicitly governed JIT; trusted shared and isolated actor programs must be AOT-capable.

## Minimum independent backend proofs

| Backend | AOT artifact and guest behavior | False proof to reject | Separate memory verification |
| --- | --- | --- | --- |
| Java/GraalVM | Native Image with program-specific compiled guest handlers, functions and continuations | Native Image of Truffle guest interpreter alone | GC roots, real off-heap actor arenas |
| LLVM | typed guest MIR -> linked native guest executable, exact guest entrypoint | LLVM object, OresVM host-only execution, ORC fallback | retirement fencing, arena lifecycle, sanitizers |
| .NET NativeAOT | linked program-specific guest native methods and actor code | NativeAOT host that interprets guest source | managed vs native allocations and deterministic drop |
| Wasm | closed compiled guest module instantiated and executed | Wasmtime host alone | linear-memory lifetime and isolate fencing |
| Cranelift | linked standalone guest executable | scalar JIT or unlinked object | native ownership and actor heap safety |

## Required promotion sequence

1. Independently retrieve exact source commit and full Git-tree identity, canonical guest fixture bytes and compiler/toolchain digest.
2. Execute actual compiler positives/negatives with nonzero GitHub job steps, check run attempt, runner, output and guest entrypoint. Negative tests include ownership/capability violation, unsupported actor handler lowering, unbounded specialization and source compiler fallback.
3. Hash the linked native executable or closed Wasm module, not only a host runtime or relocatable object; verify program-specific guest functions are in that image.
4. Run the **same program** with guest JIT/interpreter disabled. Confirm no runtime macro expansion/source eval is required. For hybrid, separately compare optimized JIT behavior to JIT-off AOT semantics.
5. Run independent memory/GC, actor quiescence, tenant isolation and realtime evidence before claiming those properties; AOT compilation alone proves none of them.
6. Authenticate GitHub job steps, hashes, build provenance and independent approval outside this untrusted JSON classifier. Do not mirror private source to another organization without explicitly approved private transfer.

## Local source-free test

    node --test tests/aot-execution-evidence-v2.test.mjs

The 35 authored Node cases test structural classification and adversarial substitution only. They do **not** execute any AttoLang compiler or guest program. Existing v1 validator remains backward-compatible and unmodified.


## JIT/AOT claim separation hardening (2026-11-02)

A `mode=jit` receipt with a `jit-only-guest` artifact must declare that the
guest runtime JIT actually executed (`runtimeGuestJitUsed=true`) and cannot
claim a JIT-disabled AOT baseline (`aotBaselineRanWithoutJit=false`). These
are necessary **self-reported structural** constraints, not independently
authenticated proof. An absence of JIT does not become evidence of AOT.

Restricted program-specific full AOT is not complete language support: a
Cranelift scalar executable can prove native guest execution for that
restricted source without proving actor/async/generic/heap/hygienic-macro
closure for the entire AttoLang language. The `full-aot` mode refers to the
compiled admitted **program**, not a global backend feature certificate.

### Related executed native evidence, independently classified

- [Cranelift PR #83](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/83)
  reports standalone scalar guest executables and two restricted typed
  compile-time macro forms at source head
  `4d762d64480275403099590beb4467b4b7c519c6`.
- [Private carrier run 41396633030](https://github.com/scintilla-run/scintilla-e2e/actions/runs/41396633030)
  at destination commit `5be4eca8bb422730ae9a601e70d441be2b9f2cb4`
  has a completed successful `source-native-aot` job with actual executed
  checkout, Git-tree validation, Rust toolchain, native guest tests,
  formatting/Clippy and Node-source-free steps. The PR reports 7/7 Rust
  units, 14/14 native integration and 73/73 separate Node source-free tests.
  This carrier is **not** a pass for this conformance PR's exact head or for
  Java/LLVM/.NET/Wasm macro parity.
- Java source's `.github/private-ci-approved-repositories.txt` currently
  has no approved private destination. Separate successful carrier CI does
  not override independent review, source-repository policy or branch
  protection. Do not mirror this private source tree solely based on GitHub
  minutes or self-reported evidence.

