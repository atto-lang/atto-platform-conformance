# AttoLang actor/Task case-level oracles — exact-source, advisory only

This is an **incremental, source-free normalization layer** stacked on the
five-backend release reporter in conformance PR #516. It is **not** real
backend compilation, runner execution, full AOT, GC verification, branch
protection, or release certification.

## Grounded source inputs

The `contracts/atto-guest-case-oracle-v1.json` inventory was constructed
from two pinned, open DRAFT conformance PRs, with independent file-level
GitHub Git blob SHA checks:

| Proposed suite | PR head | Manifest Git blob | Positive | Negative |
| --- | --- | --- | ---: | ---: |
| Actor/channel | [#457](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/457), `7d1841d0ab85765ca779674e034cd61a0d70cb26` | `68401237c65beb48b2e3d680e01830d0afe79f51` | 3 | 3 |
| Task/HasFuture | [#465](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/465), `908fd95d8ad4238f539b37a63fc2840a7c495624` | `5a53b01ad864805809d06c4747fb8a18430de77e` | 10 | 4 |

All **20** case IDs, source paths, Git blob SHA-1 values, original positive
output/event expectations, rejection patterns, and targeted Task diagnostic
codes are pinned in both the source-free validator and manifest. A caller
may not swap case IDs, weaken a diagnostic, drop an observation, change the
original backend roster or insert apparent approval/PASS authority keys.

The **target** backend roster is Java, LLVM, Wasm, Forge and .NET. The source
actor draft itself lists `java, llvm, net, wasm, cranelift`. This is an
unresolved source compatibility mismatch: **Forge is absent** and **Cranelift
is an extra**, never a substitute for Forge. Resolve this in the actor
source draft with explicit review, then intentionally refresh the pinned
head/manifest/fixture hashes in this child.

## Case-level completion plan

The normalizer recognizes 13 positive and 7 negative fixtures, but retains
deliberate source-only gaps:

- Actor positive fixtures have human-readable proposed stdout (e.g. `42`,
  `0:10`, `cancelled`), **not** independently established complete byte
  streams or process exit contracts. Keep `PENDING_EXACT_EXIT_STDOUT_BYTES`
  until stderr, whitespace/newline and exact expected guest exit are
  separately specified and tested.
- Actor negative fixtures currently use broad diagnostic regexes, which are
  **not** compiler diagnostic categories. Keep
  `PENDING_EXACT_DIAGNOSTIC` until the compiler contract fixes the precise
  category and phase; generic parse failures are not a safety pass.
- Task positive fixtures have an expected exit of `42`, required and
  forbidden observation tokens. They still need an authenticated,
  deterministic event/output contract. Keep
  `PENDING_CANONICAL_EVENT_OUTPUT`.
- Task negative fixtures have explicit proposed diagnostic codes, such as
  `ATTO_TASK_E_HASFUTURE_WITNESS`, but no source-confirmed diagnostic phase
  for all cases. Keep `PENDING_EXACT_DIAGNOSTIC_PHASE`.

## How the reporter uses this

`tools/atto-guest-case-oracle-v1.mjs` validates the exact draft inventory
and returns **100** backend-case cells with **0** guest executions. Its only
decision is `BLOCKED`; `release_authorized` is always `false`.

The existing `bin/atto-five-backend-certification-v1.mjs` now reads the
case manifest through its bounded, regular-file, no-symlink, canonical-JSON
reader and verifies Git blob SHA
`94b6e74a0100b8210401a5dbc3aebe4ce142eb71` before aggregating.
The report correlates both suite IDs to the same original PR heads and
source-manifest hashes in the release candidate. It distinguishes a
**normalized but incomplete** case inventory from one not evaluated.

Run on a checked-out exact source head using Node 22:

```sh
node --test tests/atto-guest-case-oracle-v1.test.mjs
node --test tests/atto-five-backend-certification-v1.test.mjs
node bin/atto-five-backend-certification-v1.mjs \
  evidence/atto-five-backend-release-candidate-v1.json --markdown
```

The reporter's nonzero status is intentional: `1` BLOCKED, `2`
malformed/untrusted, `3` structurally reported but requiring live
independent verification. It **never** exits 0. The existing source-owned
workflow is extended to execute the new Node test file when runner admission
is restored.

## Verification limitations and next gates

In an isolated V8 source-body harness, **51/51** new/integration test
functions passed against exact GitHub blobs. This does **not** substitute
for native `node --test` filesystem execution, GitHub Actions steps,
or any AttoLang guest binary execution. The six existing CLI/filesystem
tests in #516 also still require real Node execution on a functioning
source-owned runner.

Before any claimed feature parity: separately pin a genuine source-owned
compiler binary for each backend, execute the exact .atto fixtures, prove
both accepted outputs and targeted negative rejections, capture guest
stdout/exit and diagnostic bytes, and independently correlate GitHub
run/job/runner/artifact identities. The existing private-source transfer
holds [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77)
remain mandatory, as do the runner issue
[#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315)
and branch-protection issues [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69)
and [#170](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/170).
