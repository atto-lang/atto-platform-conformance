# AttoLang dispatch parity: source corpus and evidence admission v1

**Status: SOURCE_CONTRACT_ONLY.** This corpus adds no independent compiled guest run, no Graal Native Image, no NativeAOT, no Wasm artifact, no Forge binary, and no benchmark claim.

## Existing work; do not duplicate
- Shared policy [oreslang-common-source #265](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/265) defines `DIRECT`, `STATIC_WITNESS`, `CLOSED_INDIRECT`, `ACTOR_MESSAGE` and the post-macro verification obligations.
- [LLVM #1663](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1663) has direct-class candidate guest and native test harness. Its private exact-blob run is **not** an exact-root-tree source-org acceptance run, and the source runner's zero-step job is **NOT_EXECUTED**. Independent approval is missing.
- [Java #2814](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2814) stages dispatch plan integration; [Java #2827](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2827) pins override-safe JVM guest semantics. Neither proves Graal Native Image full AOT.
- [.NET #467](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/467) rejects forged CIL indirect opcodes for static helpers. Nominal method compilation is not yet implemented as full NativeAOT.

## Compiled test boundary
The first two fixtures copy the validated **source text** from LLVM #1663: concrete mutable receiver and overload both must return exit code 42 at **O0 and O2**, and their **exact direct-call callee identities** must appear in compiler-emitted IR/metadata. Four negative fixtures reject wrong arity, unknown target, duplicate slot even if unused, and private access **before emitting IR or artifacts**. Compiler-specific diagnostic text may differ; the adapter must map into the stable diagnostic class.

These common `.atto` fixtures are *candidate inputs*: only LLVM #1663 currently describes an executed implementation slice; the conformance repo is **not** claiming all five backends accept their syntax. Unsupported features must report `NOT_IMPLEMENTED` without guest execution or partial CIL/IR claims.

The other three categories remain **nonpromoted** pending compiler-aware positive and negative fixtures: generic trait witness and instantiation budget; closed virtual table/override fallback; actor message admission, generation fencing, and physical mailbox isolation.

## Receipt trust boundary
`node --test test/static-dispatch-aot-parity-v1.test.mjs` runs source/receipt-shape tests only. `node tools/verify-static-dispatch-aot-v1.mjs path/to/candidate.json` can only produce `CANDIDATE_FORMAT_VALID_REQUIRES_INDEPENDENT_ATTESTATION` and `verified=false`; JSON fields are **untrusted claims**. Do not turn its success into a CI/merge pass.

A trusted verifier must independently fetch the exact job attempt and **nonempty executed steps**, authenticate the source head and root tree, hash compiler binary and sealed `.atto` input blobs, inspect emitted direct targets, check emitted artifacts, and execute AOT guest binaries at both optimization levels with runtime JIT/compilation disabled. A source-org `steps=[]`, `runner_id=0`, missing check, or incomplete root provenance is **NOT_EXECUTED**, even if a private alternate-org subset succeeds. Private cross-org source copying additionally requires separate security authorization and an approved private destination; blob integrity is not approval.

## Promotion gate
Do not merge a backend dispatch PR until (1) independent approval, (2) all applicable branch checks with real steps, (3) exact target identity and closed-world override/ABI/borrow/effect evidence, (4) positive **compiled guest** and negative rejection receipts, (5) bounded specialization and full AOT artifact evidence for the claimed backend. Keep JIT profiling devirtualization separate from proven static uniqueness. Benchmarks must report cold/warm runtime, compilation time, artifact bytes and both direct/virtual controls on matched toolchains.
