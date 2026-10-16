# Java/GraalVM exact-main value-match execution — 2026-10-14

## Independent source evidence

- **Oreslang Java source revision**: `7020608e9613f2ea0e8ec670766b442ac8670375` (main after generic declaration defaults / PR #930 integration).
- Source `src/main` tree: `d806636af1a2841c4d2d915e72c2d7c6044d6368`.
- **Private CI carrier**: `scintilla-run/scintilla-e2e`, commit `ec267b81921f60c8379bef754b7bd0252d5d20e9`, GitHub Actions [#38667795375](https://github.com/scintilla-run/scintilla-e2e/actions/runs/38667795375).
- Both jobs successfully checked the exact `src/main`, `stdlib`, `pom.xml` tree identities and **358/358 Git blobs**, including all main source/test resources and the seven PR #932 SHA-pinned JUnit/fixture artifacts. No modified source fixture expectations or mock backend were used.
- GraalVM distribution and JDK 25 were used for the JVM tests and GraalVM Native Image build.

## Actual JVM JUnit execution

The **eight** original `PinnedValueMatchConformanceTest` methods passed on the exact main source (8 tests, 0 failures/errors/skips). The full Maven regression job continued and ran **2,076 tests**, with **0 assertion failures, 1 error, 0 skipped**.

The error was unrelated to the value-match tests:
`NativeHttpTest.pooledActorsReuseMailboxWithoutRetainingExchangeAdmission()[2]` threw `IllegalStateException: The context is currently executing on another thread` during `Context.close()` at `NativeHttpTest.java:360`.

This is **independently reproducible**: [isolated run #38668053723](https://github.com/scintilla-run/scintilla-e2e/actions/runs/38668053723) performed repeated `NativeHttpTest` executions against the same exact source revision; the first 13-test pass succeeded and the second encountered the same exception. See [Java issue #973](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/973).

**Conclusion**: pinned value-match JUnit tests passed, but the complete Maven suite is **NOT GREEN**.

## Actual GraalVM Native Image execution

The distinct `native-image-aot` job of [run #38667795375](https://github.com/scintilla-run/scintilla-e2e/actions/runs/38667795375) completed **SUCCESS** and:

1. Built a real GraalVM Native Image executable using `-Pnative-aot,!native-thread-unix`, verified `--build-info` reported `"build_mode":"aot"`, and used `--mode=aot` for guest invocations.
2. Accepted the three SHA-pinned positive source fixtures with `--check`.
3. Matched the exact stdout bytes `42:0` and `142:42` using `cmp`, and `42:0:0:2` for the third fixture with a **supplemental entrypoint** (the canonical guard fixture itself has no `main`).
4. Rejected all three negative fixtures with nonzero compiler exit, empty stdout, expected semantic diagnostic on stderr, and checks against unsupported/crash diagnostics.
5. Uploaded verification artifact `java-main-7020608-native-value-match` (GitHub artifact ID `11943092243`).

**Conclusion**: Native Image value-match conformance succeeded for the pinned Java source snapshot. The parent GitHub Actions workflow has a final failure because the parallel full JVM regression job failed. Do not conflate the native job's success with an all-green overall run.

## Reporting and merge policy

This document is an auditable, **revision-scoped** test record, not a statement that moving `main` remains green. Earlier `3f1643c` snapshot runs [#38665292079](https://github.com/scintilla-run/scintilla-e2e/actions/runs/38665292079) (2,040/2,040 Maven tests) and [#38665701207](https://github.com/scintilla-run/scintilla-e2e/actions/runs/38665701207) (Native Image) were fully successful but precede the generic-defaults merge.

The canonical fixture bytes, v1 language semantics, `confirmedBackends` values, and `evidence.exactFixtureExecution` in `fixtures/value-match/v1/manifest.json` remain **unchanged**, pending review and the unresolved Java HTTP lifecycle gate. A true independently verified LLVM backend run has not occurred for this v1 language subset; LLVM, WASM and browser remain pending.

The clean seven-file Java PR from current main is still subject to a previously explicit safety-denied write. Do **not** bypass that denial by pushing the same seven-file tree through a different route; this private CI execution does not change the Java repository's branch/PR ancestry.
