# Inverted-struct guest receipt v1 — structural validation only

`verification/dop-inverted-guest-receipt-v1.mjs` validates receipt
**shape**, not authenticates its claimed source, compiler, runner, artifact
or execution. An independent verifier must retrieve GitHub's exact run,
run attempt, full job page and steps, immutable commit/tree, compiler binary
and test/guest artifacts before declaring `PASSED`.

The underlying `contracts/dop-inverted-v1/manifest.json` remains
`NOT_EXECUTED` for all five backends until real source evidence exists.
The two `.atto` blobs and expected results are pinned there.

## Execution lanes are intentionally distinct

- **Java**: `executionProfile: restricted-interpreter`,
  `executionStage: managed-guest`, SHA-256 of compiled Java class tree,
  *no fabricated native guest executable*. Positive must return integer
  `42`; negative must throw the explicitly checked
  `DOP_INVERTED_BOUNDS_TRAP` language-lane exception.
  This is **not** full `TypeChecker` integration or Graal Native Image.
- **LLVM**: `executionProfile: aot`, `executionStage: native-guest`,
  SHA-256 of the real compiled native artifact and compiler. Positive
  must return 42, negative must terminate with an observed SIGILL/SIGTRAP
  rather than `exit(132)` or a forged return code.
- **.NET, Wasm, Forge**: cannot submit `PASSED` receipts under this
  limited v1 validator. Their stage-appropriate implementation and
  independent proof must be added separately.

A claimed `PASSED` requires nonzero executed tests, admitted runner ID,
exact source/tree/hash IDs, and ordered checkout, source verification,
compile and execute steps. `NOT_EXECUTED` cannot carry a guest result,
job or artifact claim. Synthetic `PASSED` controls in tests demonstrate
only validation behavior; they are **not** runtime evidence.

Source identities can be spoofed in a self-reported receipt. A standalone
signature, JSON input, script, host oracle, or this validator must never be
used as a shortcut around independent GitHub run/job/artifact verification.

## Release plan

1. Resolve source-org runner-admission issue #315; require actual executed
   steps against source exact heads.
2. Execute production Java JUnit and LLVM compiler+native artifacts for
   both canonical `.atto` fixtures.
3. Correlate receipts to trusted GitHub run/job/attempt/workflow checkout
   and verified content hashes. Keep claimed `PASSED` provisional until
   the independent verifier completes.
4. Require independent approval and branch protection before merge.
