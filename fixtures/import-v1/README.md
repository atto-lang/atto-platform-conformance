# Import parity v1 — shared source graph

This is a **source corpus**, not proof of backend compilation, execution or five-backend parity. The `cases.json` ledger deliberately starts at `CORPUS_ONLY_NOT_BACKEND_EXECUTION` with no execution evidence.

A single package manifest anchors `+/src/lib/helper`. Two separate entrypoints call the same helper with argument 41: one uses `+/`, the other `./`. The expected result is 42. A third fixture uses an in-root `..` traversal spelling and **must be rejected even though filesystem normalization could yield an in-package target**.

For a backend to claim success, run each case with its real, exact-revision compiler and check the compiled result, not a regex or synthetic stub. Preserve separate provenance (compiler source/tree SHA, runner, toolchain, raw stdout/stderr, invocation, exit status, artifact hashes). For .NET, Forge and Wasm, current expected implementation status is reject-only; positive support must not be inferred from source admission tests.

This corpus is intentionally independent and does not copy private compiler code into another repository. Any private source checkout or cross-organization mirror still requires the owning repository's explicit approval controls.

Two more cases preserve **literal CR-only line endings** in the Git blobs. In
`main-cr-comment.ores`, a leading `//` comment must terminate at CR so
`import fnc helper from "./lib/helper";` remains visible and the linked
program returns 42. In `invalid-cr-root-traversal.ores`, the same boundary
exposes the noncanonical `+/src/../src/lib/helper` import, which must reject
rather than silently compile an incomplete graph. These are corpus **fixtures**;
running the Node integrity checks alone does not establish any backend compiler
behavior or CI capacity. Preserve CR bytes when loading and exercising them.
