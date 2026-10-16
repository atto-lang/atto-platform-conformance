# Import parity v1 — shared source graph

This is a **source corpus**, not proof of backend compilation, execution or five-backend parity. The `cases.json` ledger deliberately starts at `CORPUS_ONLY_NOT_BACKEND_EXECUTION` with no execution evidence.

A single package manifest anchors `+/src/lib/helper`. Two separate entrypoints call the same helper with argument 41: one uses `+/`, the other `./`. The expected result is 42. A third fixture uses an in-root `..` traversal spelling and **must be rejected even though filesystem normalization could yield an in-package target**.

For a backend to claim success, run each case with its real, exact-revision compiler and check the compiled result, not a regex or synthetic stub. Preserve separate provenance (compiler source/tree SHA, runner, toolchain, raw stdout/stderr, invocation, exit status, artifact hashes). For .NET, Forge and Wasm, current expected implementation status is reject-only; positive support must not be inferred from source admission tests.

This corpus is intentionally independent and does not copy private compiler code into another repository. Any private source checkout or cross-organization mirror still requires the owning repository's explicit approval controls.
