# Wave 30 audit and test evidence — October 18, 2026

**Status: draft, partial source-level and reference-model hardening. NO native/backend release certification; NO cross-organization private-source mirror; NO merge.**

## Source trust and alternate runner

- The funded **private** `sagitta-stack/sagitta-infra` source-free CI run [39151702062](https://github.com/sagitta-stack/sagitta-infra/actions/runs/39151702062) completed successfully; its `source-free-admission-oracle` job reported **21 executed, successful steps** including checkout, admission denials, audit and receipt verification. It proves runner allocation for that source-free job, not source permission or Oreslang backend acceptance.
- Source-private migration remains **DENIED** under platform-conformance [#57](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/57), [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) and security incident [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77). A private destination is necessary but insufficient. Require protected source main, independent review, destination numeric ID approval, exact source commit and root-tree approvals, approved retention, and reviewed code-owner policy before exporting a single source blob. Existing destination/snapshot lists are reported empty. No secret/token access was used to bypass source policies.
- Several source-org workflows report zero job steps: these are **NOT_RUN**, not successful or failed executable tests. Do not infer that minute exhaustion is the sole cause from zero-step status.

## Exact-file local evidence

All Git blob SHA values below were verified against fetched files from `draft/issue-wave30-20261018` at the time of the audit. Local execution does not replace source-org or authorized CI.

| Repository | Source blob | Test blob | Executed evidence |
| --- | --- | --- | --- |
| `oreslang-source.wasm` SIMD admission | `bb47fe2cdf504c468b74361285ed8c456e58d5eb` | existing `d5cea2918752f58920ae85add37db43af9cea45b`; adversarial `65f7f20f2d19bb841842c00381ae03bec80836ba` | 10/10 function-level checks in isolated V8 with ESM import/export syntax stripped; not Node CI |
| `oreslang-data-science` NdArray ABI | `3d8521e23f53a16f3da24eb0ec3798889e2f0d88` | `685a8f5f51080570a7193b0a9110d0f3da471c5e` | 10/10 local CPython unit tests; 20,000 current exact-blob seeded strided-view comparisons (7,359 accepted / 12,641 rejected) plus 1,000 borrow/generation sequences without mismatch |
| `oreslang-common-source` IPC receipts | `969b7b4202077dccd1fd5b610f45f493bd9b1a31` | `006bcbf25764c434776402917a34e788a2dd7d12` | 7/7 local CPython unit tests |
| `oreslang-proof-of-concepts` bounded DATA/CONTROL model | `6cbe1fe7c5cef717d2577f0fa206ec5c47c76033` | `b81e6d5806856c27d85a345b9fff67188d44dbb9` | 5/5 local CPython unit tests |

Additional local independent checks: bounded mailbox model at capacity 3 / five issued messages explored 231 states and 634 transitions without assertion failure; 10,000 seeded IPC receipt event sequences preserved the fail-closed replay rule. These remain abstract-model checks, not runtime execution.\n\n## Actual hardening committed in this pass

- `oreslang-source.wasm` #88: fix assigning the optional engine-probe result to a `const` destructured field, which threw in scalar default mode; add default-path regression assertions.
- `oreslang-data-science` #9: require strictly increasing owner generations across drop/register, fail closed on malformed releases, and give loan objects identity rather than structural equality; add tests for owner-reuse and re-created loan tokens.
- These are reference/preflight improvements, **not** the completion of guest compiler, native tensor, GPU, Wasm codegen, or zero-GC proofs.

## Reconciliation and remaining test gates

- The common-source, embedded and source.wasm draft branches have non-overlapping changed *paths* relative to new `main`; reconciliation should still review import/API behavior. A proposed automatic tree merge was not applied; retain existing refs.
- ASIC, FPGA and HDL draft changes overlap newer `main` edits in validators, tests or workflows. Manually merge and rerun on exact heads instead of overwriting upstream files.
- Restore source Actions execution, run exact-head unit and integration tests, compile real `.ores` guest programs, execute Graal/LLVM/Wasm/target hardware where applicable, and bind receipts to commit/tree/artifact/toolchain digests.
- Before any alternate-org source run, independently verify the current protected-main security admission and explicit snapshot/destination approvals. A successful source-free runner probe does not authorize source export.

**No claim of full parity, production readiness, zero collector, physically measured PPA, or completed issue closure.**
