# Platform-conformance matrix and evidence gates

The test manifest is a target fixture inventory. Source files are not proof of compiler support.

| Pair | Currently executed by CI | Status |
| --- | --- | --- |
| Java/Graal source checking | No | Requires pinned compiler and real integration run |
| JavaScript source checking | No | JS `--program-v2 --check` must be executed by a pinned Node 22+ binary against both real fixtures; this is **not** runtime execution or Java parity |
| LLVM source checking | No | Requires pinned native compiler and real integration run |
| .NET source checking | No | Native AOT bootstrap; requires pinned real .NET compiler |
| Forge source checking | No | C++20 bootstrap; requires pinned real Forge compiler |
| Wasm source checking | No | Requires pinned LLVM-to-Wasm compiler bridge and guest execution evidence |
| wasm32 core runtime | Separate oreslang-wasm CI | C ABI only; no general guest Oreslang actor support |
| Browser host loader | Separate oreslang-browser CI | Wasm adapter only; no guest Oreslang compilation |

Never reinterpret the fake checker tests as Java/LLVM conformance. Real runs require exact source_sha, command argv, stdout, stderr, exit/signal and fixture identity. The runner does not use a shell and treats crashes, timeouts and absent executables as failures, even for expected-rejection cases.

At a real build gate: 1) obtain exact compiler tree/commit; 2) build it using authorized private-runner access; 3) supply non-executing checker argv; 4) run conformance with --require; 5) archive provenance and raw output, label unsupported fixtures explicitly rather than dropping them.

Hardening: command argv requires an absolute executable, timeouts are bounded to 100..120000 ms, SHA-256 hashes record the executable and test inputs, and v1 negative fixtures require a **literal ASCII identifier** (not an arbitrary regex). A nonzero exit counts only when a single error-severity line **identifies the exact case-sensitive fixture symbol as the subject of an unresolved/unknown/undefined-name diagnostic**. An occurrence in an echoed source line, filename, or commentary about a different identifier is not sufficient. **Only a primary diagnostic immediately after error severity is admitted**; later same-line hints or quoted secondary diagnostics cannot rescue an unrelated compiler failure. This deliberately fails closed on unconventional compiler output until an independently tested adapter is provided. Warnings, source echoes, unrelated process failures, invalid exit codes, and crash-only text never pass. Multi-line diagnostics need an explicitly verified backend-specific adapter; they are deliberately not auto-promoted as conformance evidence. Source revision is caller-supplied and NOT attested to the hashed executable; a reproducible compiler build must establish that link.

## AI smoke evidence admission

Two companion PRs add proposed compiler-executed smoke jobs. The report-consistency adapter in `src/real-evidence.mjs` does not assert authenticity. Without independently verifiable successful workflow execution, no feature is promoted as supported in this matrix.

## Five-compiler source fixture scope

The `fixtures/manifest.json` basic arithmetic and unresolved-name cases are **targets** for `java`, `llvm`, `net`, `wasm`, `forge`, and `js`. Listing a backend in the manifest neither claims that it implements the fixture nor confirms that its runtime is feature-complete. `browser` remains an independent adapter target and must not be counted as a sixth compiler.

For each backend, a passing claim requires an actual independently pinned compiler executable, the exact source commit, authenticated build provenance, and the runner's accept/reject evidence. A fake checker or schema-only check tests the harness, not the compiler. An absent compiler is `UNCONFIGURED` (or `SPAWN_ERROR` when an invalid command is supplied), never verified; a required suite exits nonzero. Wasm must demonstrate actual Oreslang guest compilation and execution rather than treating LLVM host success as Wasm execution.

This shared two-case admission contract is **not full language parity**. Actors, ownership, async/await, Sendable/Serializable, permissions, and other advanced behavior require additional exact-source fixtures and real evidence for each compiler. No missing feature may be reported as implemented based on documentation or fail-closed rejection alone.


## October 16 manifest and source identity hardening

Conformance PR #35 now validates that every claimed compiler backend has at
least one positive and one negative fixture before admitting the manifest.
Duplicate IDs, duplicate fixture paths, duplicate backend selectors, invalid
diagnostic symbols, empty or oversized inventories and mismatched expectation
metadata are rejected. The checked-out manifest and each source fixture must
be regular, non-symlink files. An accepting-only manifest must never report
successful parity even when its chosen positive fixture passes.

A private, narrowly scoped 19-file snapshot was checked with exact Git blob
hashes on [Voxletra run #38945270220](https://github.com/voxletra/voxletra-e2e/actions/runs/38945270220):
**54 Node tests passed, 0 failed or skipped**. This is conformance *harness*
validation, including mocked compiler behaviors; no real compiler, actor
runtime, whole-tree source revision or CI budget balance is attested.

Remaining limitation: the harness hashes the compiler executable before
testing but does **not** independently authenticate its source-build chain
or guarantee that the on-disk executable cannot change between fixture
invocations. Git blob equality of a test snapshot is not a complete native
compiler provenance attestation. Do not promote backend support without
independently reviewed build and runtime evidence.

## JavaScript backend admission

The `js` entries in `fixtures/manifest.json` are **inventory targets** only. The same two source fixtures can be checked by the isolated, experimental Oreslang JS program-v2 frontend with Node 22+ and `oreslang-jsc --program-v2 --check {file}`, using an absolute Node executable and an exact JS-source commit. The shared `runSuite` result carries `verificationScope: "compiler-source-check-only"` and `runtimeVerified: false`, even when both checks pass. A passing check cannot prove that generated ESM executes or returns integer 42, cannot attest the declared source SHA, and cannot establish Java or LLVM parity. Independent pinned GitHub runner evidence for compilation **and actual ESM execution**, diagnostic rejection, and build provenance is required before promoting any JS behavior to the supported-feature matrix.


## Generator and async-iterator parity target

The manifest now carries three positive source-admission targets for every compiler backend:

- `gen* values(): Iterator<int>`
- `async gen* values(): AsyncIterator<int>`
- `suspend gen* values(): AsyncIterator<int>`

These are **parity targets, not support claims**. The manifest carries an
`unsupportedBackends` capability ledger for positive targets that have not landed
in a backend's merged main. A configured run reports those rows as `UNSUPPORTED`
without invoking the compiler for that fixture; `UNSUPPORTED` is a parity gap and
counts non-green. It is never promoted to `VERIFIED`, and an incidental parser
failure is never treated as proof of an intentional capability boundary.

At this revision all six merged backend mains are explicitly unsupported for the
three generator target rows. Candidate implementation PRs (for example Java #2130,
LLVM #1075 and JS #85) do not change the shared ledger until their implementation
actually lands. When a backend gains a target on main, remove only that backend from
the corresponding `unsupportedBackends` row; the exact same fixture then becomes
an executable acceptance gate.

Accepting syntax without lowering lazy pulls, typed `yield`/`yield*`,
close/cancellation cleanup, and async continuation semantics does not establish
runtime parity. Java's public host async-generator proof remains separately blocked
by Java #721/#883/#677.
