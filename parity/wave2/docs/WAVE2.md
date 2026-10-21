# Cross-backend Oreslang parity — wave 2 (tasks 6–10)

**State:** normative *target* fixtures and receipt-consistency tooling; **no backend implementation or five-backend runtime parity proven.** This draft sits beside wave-one PR #47 (not on top of it), and does not alter the original scalar admission harness.

## Five tasks

| Task | Area | Source oracle or semantic boundary | Evidence required to complete |
| --- | --- | --- | --- |
| 6 | Numeric/value semantics | Full i64 precision above 2^53; exact operator precedence | Actual guest returns 1 and 42; narrow integer success does not imply floats, decimals, tuples, arrays or matrices |
| 7 | Value/procedural dispatch | `match` arm value returns 43 after caller continues; `do match` returns 42 from function | Real guest compiled and executed. Switch forms in shared PR #20 are an additional open extension |
| 8 | Closures and receiver | Explicit `lex[base]` yields printed 7; implicit `self` inside class lambda rejects with a capture/scope diagnostic | Guest callback plus source type-checker negative; receiver environment must not be implicitly retained |
| 9 | Ownership/borrow | Borrow ended in lexical `block` before await prints 71; borrowed value live over await rejects with ownership diagnostic | Fresh compiled guest output and ownership rejection after parsing; run across implicit cooperation as later milestone |
| 10 | Effects/critical state | exclusive `critical` writes through sealed `handle_state` and `using state.write` admitted; mutation under `using state.read` rejected even if signature allows `state.write` | Real compiler/type/ownership/effect checks; follow up with executed actor state and exclusive-write scheduling tests |

## Reused and independently developed source

- Numeric contracts: Java [#1033](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1033), [#1040](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1040); LLVM [#427](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/427), [#459](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/459); .NET #34 and Forge #27 only fail-close unsupported fractional literals.
- Dispatch return destinations: [common-source #20](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/20). Both dispatch fixture sources reproduce its value and procedural examples, retaining distinct expected returns.
- Receiver/capture: [Java #1087](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1087), [LLVM #479](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/479), .NET #40, Forge #36 and Wasm #38. Explicit/implicit capture sources follow Java's on-branch regression tests.
- Borrow suspension: [Java #740](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/740). The two `ownership-*.ores` fixtures preserve the actual upstream Git blobs: `b98aa02b6c4c9f4daa2cf07d85279e4311a64d49` and `e33a48c741b8ead1d7de1458e15c4988a202d197`.
- State capabilities: [Java #760](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/760). The two `effects-*.ores` sources preserve exact upstream blobs `5738ca8b68ed43d8f6e22152970f569506b14b8a` and `2a611a093ce56c654bdca70c5dde9fda7a778187`.

The `candidate` matrix in `manifest.json` identifies an **intended test target** only, *not a verified implementation*. For example, .NET/Forge/Wasm are candidates for only the two narrow numeric probes in this wave, not for closure/effect/borrow semantics. Wasm must use real pinned LLVM source compilation before any claims.

## Evidence integrity

`src/gate.mjs` validates (1) every checked-in fixture's Git blob, (2) a strict report shape with declared 40-hex source commit and 64-hex adapter binary digest, (3) exact intended backend/case coverage, and (4) normalized execution, compiler acceptance, or category-specific rejection results.

**No report self-attests source↔binary linkage.** Even when all expected oracles match, the result is labeled `ORACLE_MATCH_UNATTESTED` and `verified:false`, `authenticityAttested:false`, and `semanticParityCertified:false`. JSON receipts can be forged; authoritative execution requires separate review of GitHub Jobs API, executed steps, raw logs, binary hashes, exact source/tree pins, and guest artifacts.

The gate intentionally rejects an accepted compile substituted for required guest execution, wrong numerical results, incorrect error-category text, compiler crashes, missing records, duplicate case IDs and tampered source blobs. The checked-in unit tests use **synthetic reports** to test those conditions; they do not run the source compilers.

## Commands

```sh
node --test parity/wave2/tests/gate.test.mjs
node parity/wave2/bin/check-wave2.mjs --manifest-only
node parity/wave2/bin/check-wave2.mjs --report=/absolute/path/to/normalized-observations.json
```

The report contains `schemaVersion`, `backend`, `area` (null or one of numeric/dispatch/capture/ownership/effects), `sourceCommit`, `adapterSha256`, and exact `observations` keyed by `caseId`/`gitBlob`. An observation has `phase` (`guest-executed`, `compiler-accepted`, or `compiler-rejected`), `exitCode`, `stderr`, and—for guest execution only—normalized `observed: {kind, value}`.

A successful report-consistency exit is not a parity certification. Use an independently authorized private CI runner and leave this draft unmerged until real compiler results and independent provenance checks are available. Never mirror private source to an unapproved cross-org carrier or interpret a no-step Action failure as a passing test.

## Optional real-process adapter invocation

An operator may configure a trusted, **already-built** backend-specific executable which receives the absolute source fixture path and one of `execute`, `check`, `reject`. The adapter must separately compile and, for execution probes, run a **real Oreslang guest**, then emit exactly one JSON object: `{"phase":"guest-executed","exitCode":0,"stderr":"","observed":{"kind":"integer","value":42}}` (or the appropriate phase/value/diagnostic for the requested case). The runner uses no shell, bounds time and output, and refuses missing tools, invalid JSON and partial results.

```sh
node parity/wave2/bin/run-wave2.mjs \
  --backend=llvm --area=numeric \
  --source-commit=REPLACE_WITH_40_CHAR_SOURCE_COMMIT_SHA \
  --adapter-argv='["/absolute/path/to/reviewed-oreslang-guest-adapter","{file}","{mode}"]'
```

The SHA-256 is of the **argv[0] executable bytes only**, not an automatic digest of its linked libraries, compiler closure, source tree or guest runtime. If `argv[0]` is a general interpreter, it hashes the interpreter rather than the adapter script. Executed-process output can still be forged by an adapter; independent exact-tree build/runner/log verification remains mandatory. All adapter runs remain **unattested observations**, never promoted to verified feature support by this gate.

Run the combined local harness tests with:

```sh
node --test parity/wave2/tests/gate.test.mjs parity/wave2/tests/adapter.test.mjs
```
