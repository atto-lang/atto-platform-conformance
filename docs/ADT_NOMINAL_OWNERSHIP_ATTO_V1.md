# AttoLang nominal ADT / ownership contract v1

This is a **new .atto-first, contract-only** corpus of 12 nominal enum source cases.
It is additive to the historical `.ores` enum-semantics-v1/v2 manifests in the
conformance repository; **do not rewrite or re-certify** those manifests through
this change. This suite is a source integrity test, **not** executable compiler,
GraalVM guest, native LLVM, .NET NativeAOT, Forge, Cranelift or Wasm proof.

The expected cases specify a canonical closed tagged-sum model: case identity
is (nominal owner, variant, positive unique case tag), payloads are checked
before construction and unboxed recursion is rejected. Guarded arms cannot
establish exhaustive coverage. Move-only nominal payloads must not be consumed
twice. The three positive expected-stdout examples must be compiled and run
using a real current compiler, with no host-only evaluator substitute.

Run the host inventory check via:

```sh
node --test tests/adt-nominal-ownership-v1.test.mjs
```

Do not promote `confirmedBackends` or `executableParityCertified` from this
test. The actual six-backend gate requires a pinned PR head SHA + Git tree,
nonzero job steps, a real compiler executable hash, executed positive
`.atto` stdout, and semantic compile-time rejects for negatives. A generic
"unsupported enum" refusal counts as **NOT_IMPLEMENTED**, not a negative pass.

Additional integration gates, not claimed here: active-case-only tracing/drop,
exactly-once owned payload reclamation on cancellation, source enum namespaces
across imports, actor send serialization schema binding, wire decoding unknown
tag rejection, tenant/actor generation fencing, and native AOT execution.
