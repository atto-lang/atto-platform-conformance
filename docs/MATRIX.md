# Platform-conformance matrix and evidence gates

The test manifest is a target fixture inventory. Source files are not proof of compiler support.

| Pair | Currently executed by CI | Status |
| --- | --- | --- |
| Java/Graal source checking | No | Requires pinned compiler and real integration run |
| LLVM source checking | No | Requires pinned native compiler and real integration run |
| .NET source checking | No | Native AOT bootstrap; requires pinned real .NET compiler |
| Forge source checking | No | C++20 bootstrap; requires pinned real Forge compiler |
| Wasm source checking | No | Requires pinned LLVM-to-Wasm compiler bridge and guest execution evidence |
| wasm32 core runtime | Separate oreslang-wasm CI | C ABI only; no general guest Oreslang actor support |
| Browser host loader | Separate oreslang-browser CI | Wasm adapter only; no guest Oreslang compilation |

Never reinterpret the fake checker tests as Java/LLVM conformance. Real runs require exact source_sha, command argv, stdout, stderr, exit/signal and fixture identity. The runner does not use a shell and treats crashes, timeouts and absent executables as failures, even for expected-rejection cases.

At a real build gate: 1) obtain exact compiler tree/commit; 2) build it using authorized private-runner access; 3) supply non-executing checker argv; 4) run conformance with --require; 5) archive provenance and raw output, label unsupported fixtures explicitly rather than dropping them.

Hardening: command argv requires an absolute executable, timeouts are bounded to 100..120000 ms, SHA-256 hashes record the executable and test inputs, and v1 negative fixtures require a **literal ASCII identifier** (not an arbitrary regex). A nonzero exit counts only when a single error-severity line **identifies the exact case-sensitive fixture symbol as the subject of an unresolved/unknown/undefined-name diagnostic**. An occurrence in an echoed source line, filename, or commentary about a different identifier is not sufficient. Warnings, source echoes, unrelated process failures, invalid exit codes, and crash-only text never pass. Multi-line diagnostics need an explicitly verified backend-specific adapter; they are deliberately not auto-promoted as conformance evidence. Source revision is caller-supplied and NOT attested to the hashed executable; a reproducible compiler build must establish that link.

## AI smoke evidence admission

Two companion PRs add proposed compiler-executed smoke jobs. The report-consistency adapter in `src/real-evidence.mjs` does not assert authenticity. Without independently verifiable successful workflow execution, no feature is promoted as supported in this matrix.

## Five-compiler source fixture scope

The `fixtures/manifest.json` basic arithmetic and unresolved-name cases are **targets** for `java`, `llvm`, `net`, `wasm`, and `forge`. Listing a backend in the manifest neither claims that it implements the fixture nor confirms that its runtime is feature-complete. `browser` remains an independent adapter target and must not be counted as a sixth compiler.

For each backend, a passing claim requires an actual independently pinned compiler executable, the exact source commit, authenticated build provenance, and the runner's accept/reject evidence. A fake checker or schema-only check tests the harness, not the compiler. An absent compiler is `UNCONFIGURED` (or `SPAWN_ERROR` when an invalid command is supplied), never verified; a required suite exits nonzero. Wasm must demonstrate actual Oreslang guest compilation and execution rather than treating LLVM host success as Wasm execution.

This shared two-case admission contract is **not full language parity**. Actors, ownership, async/await, Sendable/Serializable, permissions, and other advanced behavior require additional exact-source fixtures and real evidence for each compiler. No missing feature may be reported as implemented based on documentation or fail-closed rejection alone.
