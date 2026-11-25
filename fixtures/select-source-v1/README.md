# AttoLang static select — portable source corpus v1

This directory contains **8 canonical .atto source files**, each pinned by its actual Git blob SHA-1 in `manifest.json`.
They describe the language contract and currently expected backend behavior; **they do not claim that a compiler ran these fixtures**.

Run `node fixtures/select-source-v1/verify-manifest.mjs` for source integrity, then
`node --test fixtures/select-source-v1/verify-manifest.test.mjs` for integrity-mutation checks.
Both are independent of a language toolchain; they cannot promote a backend to supported status.

The execution harness must, for each backend and exact compiler commit:
1. Verify the fixture Git blob and record the compiler/toolchain SHA.
2. Invoke the actual AttoLang frontend, type/effect/ownership gates, and its code emitter.
3. Execute produced code where the expectation is `run`, inspect exit code and stderr, and capture the full runner jobs and command log.
4. Demand an explicit compiler-owned diagnostic where the expectation is `reject`.
5. Report `unverified` as missing coverage (not pass, skip, or success).

The current LLVM subset consists of *blocking procedural* `do select` with exactly one default arm.
LLVM's native test compiler normally takes `.ores` source; a harness may copy each pinned `.atto`
fixture to an unchanged-byte temporary `.ores` path. The Java compiler's feature status is intentionally
unverified in this corpus; .NET static select remains an explicit unsupported boundary.

No test runner should infer acceptance from an artifact's extension, a manifest expectation,
or a passing C++/JUnit/.NET host-runtime test. Actor STOP fencing, send/read/await cases,
typed results, cancellation fairness and true three-backend guest parity remain separate gates.
