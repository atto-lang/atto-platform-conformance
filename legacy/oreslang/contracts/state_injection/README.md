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
| Java/GraalVM | [#2427](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2427) rejects unlowered injection; stacked [#2444](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2444) stages validated #instance backing over an ordinary owned class | Execute exact-head JUnit + Graal guest, then build real @Inject provider and handle_state RW lowering |
| LLVM | [#1192](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1192) has draft runtime state-region substrate | Compiler emission plus native real-guest execution, loan provenance and sanitizer evidence |
| WASM | [#252](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/252) delegates state-injection denials to an SHA-pinned real LLVM compiler | Check exact compiler diagnostic, zero IR and no published Wasm artifact; positive state guest still unsupported |
| Cranelift | [#62](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/62) rejects unlowered state injection with a stable diagnostic | Real typed nominal/borrow lowering and compiled JIT guest run |
| .NET | [#315](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/315) rejects unlowered injection before CIL | NativeAOT typed container lifetime and guest execution |
| Forge (optional for this requested five) | Independent C++ backend, not Cranelift | Explicit coverage instead of treating Cranelift as Forge |

Do not merge any draft under the claim of feature parity until exact-head
nonzero-step toolchain checks complete. Do not mirror private source to an
unrelated organization without confirmed source-release/export authorization.

## First restricted Java-only owned instance candidate

[Java #2444](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2444)
now stages a narrower, separately pinned example in
`owned-instance-java-v1.json`. It stores a compiler-checked
`@StateBacked(MutableStateContainer(scope = #instance))` annotation on a
concrete class with ordinary private fields and lexical `rt borrow` calls.
The annotation itself does **not** provide `state { }`, `@Inject`, shared
read/write authority or actor state access. Its candidate stdout is
`7|3|10|true|false|false|false`. No exact-head guest execution has been
confirmed; this does **not** alter the full candidate's 2 positive/14 negative
case requirements or advance any backend status.
