# AttoLang specification audit — candidate fixture inventory v1

**Status: PROPOSED / NOT_EXECUTED.** This inventory is *not* proof of compiler acceptance, guest execution, or cross-backend parity. The source-free inventory test validates metadata and file presence only.

This set covers specification PR [#9](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/9), decisions [S-42, S-46, S-54, S-55, S-56 and S-57](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/issues/15), and existing canonical Guard/named-argument fixture files. Keep chapter 15 for nested actor pipelines and chapter 20 for Guard.

- `positive`/`negative`: an **intended** oracle, never a certified pass; negative cases require a named diagnostic class rather than a string guessed from a backend.
- `decision-candidate`: alternative or incompletely specified syntax. **Do not enforce admission/rejection until independently ratified**; these files are review inputs, not passing tests.
- A real run must pin the complete fixture hash set, spec and compiler source/tree SHAs, artifact hashes, nonempty executed steps and typed guest outcomes. Report per-backend `SOURCE_CHECK`, `GUEST_EXECUTED` or `NOT_EXECUTED` truthfully.
- Preserve the distinct deferred `Actor.pipe(...).start()` contract when exploring S-54; graph drop/lifetime in S-55 is still PROPOSED.
- Complete actor stage roles, constructors, port contracts and start/stop signatures with compiler owners before promoting pipeline examples to executable positives.
- Source-free Node inventory validation is **not** an AttoLang compiler test.

Existing Guard and named-argument fixtures are reused rather than copied, so one source carries the exact semantics into follow-up Java/LLVM, then .NET/Wasm/Forge verification.
