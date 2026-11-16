# Oreslang compiler parity: 42 preview references × nine compilers

This is a **non-promoting** contract: no compiler success is claimed. The exact
AttoLang `.atto` preview Git blobs are copied by SHA reference from website
commit `38a19bdc251d6f8db3ffea3b8df0e6c84ca8881c` (manifest Git blob `c23e61a66e387dd08e5d0b9c1e3a076ce9d68bba`), tracked upstream
in [atto-source.rs draft #165](https://github.com/atto-lang/atto-source.rs/pull/165).
The PR body still says 35 but the current pinned manifest has **42** entries.

The nine target backends are: java, llvm, wasm, forge, net, cranelift, rs, js, hdl.
Each gets 42 positive compiler-and-guest cases and eight safety-negative
semantic rejection cases. **450 decisions** must be evidenced, and omissions
are invalid. Priority families: Arc/Atomic/Send, higher-order lambdas, diamond
inheritance, defer/recover, channels, and async/await/iterators.

AttoLang syntax is *not* automatically Oreslang syntax. Translate each
reference source to an independently reviewed `.ores` native fixture and
pin its Git blob SHA; a parser-reject-only run is **not** positive execution.
Positive acceptance requires compiled artifact hash, real guest execution,
checked oracle and executed assertions. For Java/GraalVM, LLVM, .NET NativeAOT,
and Forge, require full native AOT. For Wasm, require actual Worker execution.
For semantic negatives, require an ownership/type/effect/inheritance diagnostic,
not a generic unsupported syntax failure. No compiler feature gets credit merely
because of a host reference model. Hardware/HDL target limitations must be
reported explicitly rather than silently excluded. Race/cancellation tests,
native sanitizers and independent exact-head review remain necessary.

Use `node bin/verify-playground-compiler-parity.mjs receipt.json` to validate
report *shape*. It cannot authenticate a CI log or source tree: it **always**
returns `parityCertified:false` and `evidenceAuthenticated:false`, including
when `fullEvidenceShape:true`. A report that marks 50 cases NOT_EXECUTED is a
valid incomplete inventory, **not a passing compiler**.
