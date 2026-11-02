# AttoLang critical Java 10,000-turn pooled-scheduler host proof — 2026-11-02

## Precisely pinned source

- Java/Graal implementation PR [#2433](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2433) head `f62e8d1d81123381d3122b05fd0a4a2147c2c0e0`, root tree `2c5d00628431b8b833f9e77f727ef00551317a9d`.
- Host gate `src/main/java/dev/oreslang/runtime/CriticalSectionGate.java`: Git blob `e3e2a63dd6d4f5a0a407ee46acc400b2b58f2a9f`.
- Existing standalone gate test `src/test/java/dev/oreslang/CriticalSectionGateStandaloneTest.java`: Git blob `e90dea68b9e718a24076a19c556843e179c9c5d6`.
- New pooled-executor stress `src/test/java/dev/oreslang/CriticalSectionGateExecutorStressTest.java`: Git blob `16f3c2c36ac4fb3e6564ddd64356abc333d4686c`.
- Verification script `scripts/verify-critical-substrate-host.sh`: Git blob `7228eccc8dff67b9acbe18a37e0017d9865a7f05`, compiled with `javac --release 21 -Xlint:all -Werror`.

## Executed local evidence

The committed host gate plus original standalone Java test passed **25,151 assertions on three consecutive fresh compiles/runs**. A separate executor stress test passed **10,000 queued critical turns** across two batches of 5,000 with a real four-thread Java `ExecutorService`, preserving exact FIFO order, producing exactly 10,000 state increments, and recording `maxSimultaneous=1`. It passed **three independent local runs**, and the exact committed script passed again after validating its Git blob identity.

These are **real Java 21 host runtime executions**, not Graal guest source lowering. The queued guest `critical {}` form is still unlowered; this only validates logical scheduler primitive behavior.

## Hosted CI

The `.github/workflows/fast-ci.yml` PR branch now runs `bash scripts/verify-critical-substrate-host.sh` immediately after GraalVM setup, before Maven/JUnit, when a runner is allocated. However, exact-head GitHub Actions `fast-ci` run [41397783778](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41397783778), job `125122766394`, has **zero executed steps**, `NOT_EXECUTED`. Do not classify this as a passing Java compiler/JUnit/Graal job. All five `guest_parity_verified` flags remain false.

No private source was mirrored to another organization. Independent export approval and effective protected source provenance are pending [security issue #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962) and draft governance PR #2457.
