# Error-pattern matching: 100-case cross-backend compiler matrix (v1)

This contract contains **100 byte-distinct, self-contained Oreslang programs**,
with **55 expected accepts** and **45 expected rejects**. It mirrors the Java
compiler matrix in the stacked Java branch
`audit/error-pattern-100-case-matrix-20261022`, whose parent is draft
[PR #1909](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1909).
The portable inputs use a **local, open Error-like hierarchy**, so they do not
depend on the unmerged imported `std/error` taxonomy in Java
[PR #811](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/811).

## Coverage and meaning

| Contract | Cases | Compiler obligation |
| --- | ---: | --- |
| Ordered subtype arms | 20 | Specific type precedes unguarded ancestor; otherwise reject dead arm |
| Guarded ancestor arms | 10 | A guard does not prove unconditional shadowing |
| Open error hierarchy | 15 | Enumerating named leaves cannot exhaust an open error root |
| Root/wildcard/binding fallbacks | 15 | Explicit irrefutable coverage is accepted |
| Nested `Result<int, Error>` | 20 | `Ok` and complete open `Err` payload must both be covered |
| Nominal interface vs shape | 10 | `code()` method lookalike does not implement `CodedError` |
| Positive + complemented types | 10 | `T` and `!T` partition; `!T` alone is insufficient |
| **Total** | **100** | 55 accept, 45 reject |

**Scope guard:** Matching an `Error`-typed value, including `Result.Err`,
does **not** catch a thrown or raised effect. A user `match` cannot intercept
`panic`, actor forced cancellation, host-fatal failure, or supervisor CONTROL.
Typed exceptional handlers, their signatures, traces and continuation semantics
require separate exact-source tests.

## Source integrity and materialization

```sh
node bin/verify-error-pattern-matrix.mjs
node bin/verify-error-pattern-matrix.mjs --materialize=/absolute/new/directory
npm test
```

The verifier checks counts, unique IDs, unique complete programs, positive /
negative expectations, diagnostic substrings, per-backend admission metadata and
bounded paths. The optional emitter creates exactly 100 `.ores` files in a
**new, nonexisting directory**, with an `index.json` containing SHA-256
digests and expectations. Reusing a directory is rejected. No shell is used.
These hashes attest to the materialized bytes, **not** any compiler run.

For each target (Java/GraalVM, LLVM, Wasm, .NET and JavaScript), execute a
real compiler in non-executing check mode on **every exact materialized source**
file. Compare the exit verdict to `expect`, confirm rejected diagnostics,
and store raw command, binary hash, source-tree commit, fixture hash, runtime,
host/toolchain, and logs. Promote a backend only after all 100 verdicts have
passed on an exact compiler revision. Verify actual positive runtime dispatch
separately; compiler admission alone is insufficient to claim full semantic
parity. If a backend has no working frontend, mark it unsupported/pending rather
than treating parser stubs or fake checkers as passing.

## Admission status

The checked-in manifest records `confirmedBackends: []` for **every** case.
All five target backends are pending. The Node validator and its unit tests
validate **inventory and fixture materialization only**; neither proves
Oreslang source compilation. Java's reference tests are authored but no
exact-head Maven/JDK 25 execution is claimed for this particular matrix.
No code from the private Java/LLVM repositories is mirrored or published by
this change.

Before integrating the real `std/error` taxonomy, reconcile conflicting
Java #811 with current main, retain stable nominal identities and codes, then
extend imported cross-module and native backend tests. The error match engine
must not infer identity from numeric codes or equivalent method shapes.
