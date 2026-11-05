# Java/Graal and LLVM: same-source .atto guest smoke (non-promoting)

This is the smallest executable **candidate**, not a replacement for the Rust 53-case / 6-backend corpus. Both real backends must consume the exact same source bytes in `fixtures/atto-java-llvm-guest-gate/literal-42.atto` (SHA-256: `9c8b175cc615d00b3eb2f85d015febe77c48db4dd5e76b09ed3b0f19a05d8629`). That source uses `pub fnc main(): int { return 42; }`.

**Oracle:** Java CLI `--check` returns process status 0; its standalone guest CLI `--mode=aot` returns status 42. A reviewed LLVM `compile-aot.sh` compiles and links a real native artifact, returns 0, and executing that artifact returns 42. Printing "42" to stdout but exiting 0 does NOT pass.

## Prerequisites and invocation

Independently build and review Java with JDK 25, a standalone OresMain CLI launcher, and LLVM with the real native `oreslang-llvmc`, Clang and trusted `scripts/compile-aot.sh`. The Java command must invoke the standalone launcher **directly**, not Maven `exec:java`, which does not preserve the guest process-status boundary. Determine the actual reviewed Java classpath and main class; do not guess them.

Pass four argv JSON arrays, explicit full Git commit and tree SHAs for each compiler, and optionally an absolute, previously nonexistent report path:

```sh
node bin/atto-java-llvm-guest-gate.mjs \
  --java-head=FULL_40_HEX_JAVA_COMMIT \
  --java-tree=FULL_40_HEX_JAVA_TREE \
  --llvm-head=FULL_40_HEX_LLVM_COMMIT \
  --llvm-tree=FULL_40_HEX_LLVM_TREE \
  --java-check='["/abs/jdk25/bin/java","-cp","ACTUAL_JAVA_CLASSPATH","ACTUAL_ORESMAIN_MAIN","--check","{source}"]' \
  --java-run='["/abs/jdk25/bin/java","-cp","ACTUAL_JAVA_CLASSPATH","ACTUAL_ORESMAIN_MAIN","--mode=aot","{source}"]' \
  --llvm-compile='["/abs/oreslang-source.llvm/scripts/compile-aot.sh","{source}","{artifact}"]' \
  --llvm-run='["{artifact}"]' \
  --report=/abs/NEW-unwritten-report.json
```

The above paths/class name are schematic; supply actual reviewed compiler build paths. The first argv item must be an absolute executable path, except the LLVM native run stage where the first item is exactly `{artifact}`. Arguments are passed via `spawn` with `shell:false`. Missing commands, invalid templates or Git identities return nonzero and do not launch any compiler. All four exact-source stages are mandatory, in order.

The executable creates a private temporary copy of the checked-in fixture, verifies its SHA-256 after every subprocess, hashes each resolved executable, and hashes the compiled LLVM artifact before/after its execution. Every process is bounded to 1 MiB stdout, 1 MiB stderr, and a configurable 100ms–120s timeout (default 30s). This is best-effort local tamper detection, **not immutable filesystem enforcement or a sandbox**: trusted compiler processes are required.

## Evidence levels and exclusions

- `NOT_EXECUTED`: missing required command or declared commit/tree; nonzero exit, no guest launched.
- `INCOMPLETE_OR_FAILED`: check, compile, native artifact, or run exit oracle failed, timed out or exceeded output budgets; nonzero exit.
- `LOCAL_ORACLES_MATCHED_UNATTESTED`: all four local subprocess exit oracles matched; exit 0 but still **NOT authorized for parity/release promotion**.

Every report always sets `promotable:false`, `authenticated_ci:false`, and `source_commit_provenance:DECLARED_UNVERIFIED`. Git SHA inputs are caller declarations, not proof that those trees built the current binaries. Java `--mode=aot` on the JVM is not Graal Native Image AOT. A wrapper that prints or returns 42 could deceive a local oracle, so the report must not be described as authenticated compiler execution without independent compiler/build evidence.

Release-quality `ORES_GUEST_EXECUTED` evidence additionally needs independently authenticated exact source head and tree, compiler build/classpath provenance, LLVM native artifact digest and true entrypoint execution, job ID, positive runner identity, workflow/run **attempt**, meaningful non-housekeeping steps, exact fixture/oracle binding and independent review. See `docs/CI_EXECUTION_EVIDENCE.md` and the backend adapter contract in `oreslang-compilers-parity-testing/docs/BACKEND_ADAPTERS.md`.

A GitHub Actions job with `steps=[]` or `steps=null` means **runner admission NOT_EXECUTED**, not compiler pass or fail. Do not mirror private source into a second organization without separately approved source-side authority, destination numeric identity, immutable scope, reviewed workflow and retention policy.

## Self-tests: only host harness logic

```sh
node --test tests/atto-java-llvm-guest-gate.test.mjs
```

The six Node tests include deliberately synthetic child processes. They validate fail-closed classifications and source-byte identity, **not Java or LLVM .atto execution**. Run the four real compiler/guest stages on a source-local runner once Actions admission is restored, and preserve a separate exact-head CI receipt. Do not turn an isolated V8 or Node test result into guest parity.
