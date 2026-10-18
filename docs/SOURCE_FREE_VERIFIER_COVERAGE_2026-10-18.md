# Source-free verifier revision coverage — 2026-10-18 UTC

This is a **non-native, non-authorizing evidence addendum** for [draft conformance PR #58](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/58).
Historical GitHub Actions receipts are **immutable claims about exact Git blobs**, not evergreen certifications of moving PR heads.

## Independently read and hashed hosted 86-test receipt

The private carrier [run #38998666203](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998666203), attempt 1, job 117296734652, executed 86 Python tests three times: **258/258 passed**. All eight job steps completed successfully.
Its [artifact #12088012140](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998666203/artifacts/12088012140) was downloaded; actual ZIP SHA-256 `d8777abb23a68844c6323fc90f1e92738e54d7e26eb53d05108f74aadbb204be` matched GitHub metadata.
The included `86-parity.json` declares no native Oreslang compiler/guest execution, no private source transfer, and run HEAD `02b7915fa8af9f06fb2e51cb920f8583ce5adf6b`, tree `89a7a53456d97f56143ed0e85f6bfe980ba5812a`.

## Five newer source-free verifier PR heads (static snapshot)

| Backend | PR | Reviewed exact HEAD |
|---|---|---|
| oreslang-source.java | #1112 | `969b3cb0535a8178483b9a7219056b6a39c338c0` |
| oreslang-source.llvm | #495 | `5442290a6a6d9848ad7284fbe2aad13eeecc00d9` |
| oreslang-source.net | #56 | `069aa0b9dcaa1c0296ce8fcbe83c487eeed52961` |
| oreslang-source.wasm | #52 | `9c23c3c8488a8ab5119350cc39beefc070048c13` |
| oreslang-source.forge | #50 | `80903ae694ab7dc0784bae514accf8378c90f4d9` |

At these exact heads all **15/15 source-free verifier/test/workflow Git blobs** were independently fetched and are identical across backends. Their three *new* blob IDs are:

- `scripts/verify_ci_run.py`: `339b0e7b17266513a34ea991c8a0a98a38286a75`
- `scripts/test_verify_ci_run.py`: `f90bbd0623aa94e1cf8022a7c41c9e5dc864fa3e`
- `.github/workflows/ci-run-evidence-contract.yml`: `089e60d28472d40ac97205e465ceb5930416a288`

The current Python test file contains **91 static `test_*` definitions**, and the current workflow requires at least 91 tests per round. The previously successful 86-case hosted run exercised **different Git blobs** (recorded in `evidence/source-free-verifier-revision-coverage-20261018.json`). Thus it is *not proof of current 91-test revision execution*. No successful source-org Actions execution was established for these new heads.

The snapshot file and `tests/source-free-verifier-revision-coverage-20261018.test.mjs` enforce this historical/current separation offline, while preserving `five-backend-evidence.pending.json` as five-pending. These new Node tests have **not** been independently GitHub-hosted-executed. Do not claim that writing a test or making a CI workflow badge is evidence of execution.

## Security and runner gating

The implicated `zed-pkg-test/java-app` is **now private**, verified through GitHub repository metadata on 2026-10-18 UTC, but [incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) remains open for history, past artifacts, forks/clones, credentials and independent review. Private source export is not approved; the reviewed destination allowlist on Java main remains empty. [CI restoration issue #69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) tracks protected-main setup and runner admission.

Newer native Java/LLVM/.NET/WASM/Forge jobs still fail with zero executed steps and no native receipts. **Never move a source-free artifact into native `executed-claimed` records.** An authorized administrator must fix runner and protected-main eligibility; independent reviewers must approve source-export policy. No private source was transferred in this addendum.
