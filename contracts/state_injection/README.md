# Candidate v1 — injected mutable state containers (not executable parity)

Status: **proposed syntax and source-free verification only**. Neither `@StateBacked`
nor `@Inject` currently has verified code generation and semantics on all
required Oreslang backends. Every backend in `candidate-v1.json` is
`not-executed`.

## Distinct annotations and ownership

- `@StateBacked(MutableStateContainer(scope = #instance))` requests
  compiler-owned storage. It never silently turns a local class into shared
  mutable global state. For a singleton, the lifetime is the singleton scope.
- `@Inject(SessionState, scope = #instance)` resolves a **typed existing**
  dependency. It must not allocate an unrelated container with the same
  logical name. Missing/ambiguous providers and duplicate backing annotations
  are semantic errors.
- The injection handle may be immutable while its heap graph is mutable.
  Scoped `critical-read` and `critical-write` govern all aliases into the
  graph regardless of stack/heap placement. Runtime identity and generation
  provenance must be minted by the scheduler, not guest code.
- Critical scopes cannot leak references, raw pointers or borrows; cannot
  suspend or trigger new actor admission; and do not permit unchecked
  reentrant read-to-write upgrades.
- For actor-backed storage, actor-domain isolation and lifecycle quiescence
  still apply. Reader/writer exclusion alone is insufficient for safe
  retirement, cancellation and callback completion.
- The compiler is responsible for explicit errors when a backend cannot
  lower these annotations. The annotation may **not** be silently discarded.

## Source oracles and execution

`candidate-v1.json` holds **two positive exact-source programs** and
**14 negative exact-source programs**. These programs are a future acceptance
corpus; they are not asserted to parse, compile or execute today. Positive
controls must compile and produce exact output before negative cases may be
credited as semantic denials. Parser-only rejection of everything is not
feature support.

Run source-free contract tests with:

```sh
node --test tests/state-injection-evidence-v1.test.mjs
```

`tools/state-injection-evidence-v1.mjs` checks **receipt shape only**:
source UTF-8 SHA-256, exact compiler commit shape, step counts, positive guest
output, and reason-specific compiler negative outcomes with no emitted artifact.
A well-shaped receipt is **not authentic CI evidence**. Promotion additionally
requires corroborated raw GitHub Actions job/step logs, exact compiler and
guest blob identity, runtime execution, backend-native output artifacts and
compiler error text. No synthetic receipt, model test or zero-step workflow
may advance the status.

## Backends and immediate gates

| Backend | Current admission work | Next gate |
| --- | --- | --- |
| Java/GraalVM | [#2427](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2427) rejects unlowered annotations; [#2317](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2317) contains owned-borrow candidate tests | Typed annotation AST, owned-region HIR, actual guest compile/run |
| LLVM | [#1192](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1192) has draft runtime state-region substrate | Compiler emission plus native real-guest execution, loan provenance and sanitizer evidence |
| WASM | Uses an externally pinned LLVM compiler; no independent actor frontend | Reject or execute identical source using real LLVM frontend + wasm binary, never a fake compiler |
| Cranelift | [#62](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/62) rejects unlowered state injection with a stable diagnostic | Real typed nominal/borrow lowering and compiled JIT guest run |
| .NET | [#315](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/315) rejects unlowered injection before CIL | NativeAOT typed container lifetime and guest execution |
| Forge (optional for this requested five) | Independent C++ backend, not Cranelift | Explicit coverage instead of treating Cranelift as Forge |

Do not merge any draft under the claim of feature parity until exact-head
nonzero-step toolchain checks complete. Do not mirror private source to an
unrelated organization without confirmed source-release/export authorization.
