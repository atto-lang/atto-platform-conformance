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

The implicated `zed-pkg-test/java-app` is **now private**, verified through GitHub repository metadata on 2026-10-18 UTC, but [incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) remains open for history, past artifacts, forks/clones, credentials and independent review. Private source export is not approved; the reviewed destination allowlist on Java main remains empty. A **separate P0 incident [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77)** tracks prior source-bearing placements on the otherwise private Scintilla carrier; carrier privacy does not retroactively authorize those copies. This addendum did not create or rerun those source-bearing mirrors. [CI restoration issue #69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) tracks protected-main setup and runner admission.

Newer native Java/LLVM/.NET/WASM/Forge jobs still fail with zero executed steps and no native receipts. **Never move a source-free artifact into native `executed-claimed` records.** An authorized administrator must fix runner and protected-main eligibility; independent reviewers must approve source-export policy. No private source was transferred in this addendum.

## Audit hardening: Unicode spoofing and lifecycle evidence (2026-10-18 UTC)

The offline `src/five-backend-evidence-ledger.mjs` shape gate previously permitted certain invisible Unicode identity characters (bidi, zero-width and lone surrogates) in purported runner, job, test-step and toolchain names, even though the Python exact-run verifier had a stricter display-identity rule. The same JS gate checked housekeeping steps case-sensitively without whitespace normalization, allowing apparent ` post Checkout `, fullwidth or internally spaced `Set up job` labels to pass a **shape-only** check.

Draft hardening now rejects Unicode Cc/Cf/Cs/Zl/Zp categories in displayed identity fields, and performs NFKC + whitespace folding **only for identifying and denying** runner-generated lifecycle steps. It never promotes self-reported claims to authenticated execution. Adversarial cases cover U+202E, U+2066, U+200B, U+200D, U+FEFF, U+0085, U+2028, U+2029, lone surrogate, NBSP, ideographic spaces, and fullwidth letters. Legitimate legible Unicode is still accepted at the shape layer.

For quick logic regression feedback, exact GitHub blob `b7fa2e2a6cd1ff40d28f338b9c3a1783a294895e` and test blob `426b248fee49ae75aa0048d59e6194ddb60724e0` were executed together in a separate **import-free, isolated V8 harness** using minimal Node `test`/`assert` compatibility shims: **30/30** synchronous test cases passed. This is not `node --test`, not GitHub Actions CI, not native Oreslang execution, and not adequate for a merge gate.

Fresh sampled source-organization native runs failed before execution and uploaded no artifacts: Java [39088016093](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39088016093), LLVM [39088018376](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/39088018376), .NET [39088017179](https://github.com/ores-truffle-oreslang/oreslang-source.net/actions/runs/39088017179), WASM [39088019897](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/actions/runs/39088019897) and Forge [39088022740](https://github.com/ores-truffle-oreslang/oreslang-source.forge/actions/runs/39088022740).

A separate read-only exact-tree audit of the successful historical 86-test carrier [run 38998666203](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38998666203) confirmed its immutable tree `89a7a53456d97f56143ed0e85f6bfe980ba5812a` was not truncated (21 tracked blobs, no direct `.java`, `.ores`, C/C++/Rust, or `src/` compiler paths). This is **not** a comprehensive confidential-content assessment of file bytes or other source-bearing carrier branches: [incident #77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) remains open. It does not authorize copying or rerunning private source in that repository.
