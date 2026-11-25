# October 18, 2026 — cross-org Oreslang / ORESoftware integration audit

**Status: intake and fail-closed coordination only. Not a completed implementation audit or runtime certification.**

## Reproducible work queue

- `integration/ores-cross-org-100-issues-2026-10-18.json` records **100 distinct open issues** observed from the connected GitHub search on 2026-10-18, from two accessible GitHub organizations whose names start with `ores-`: **72** in `ores-truffle-oreslang` and **28** in `ores-stack`; **37 repositories** represented.
- Source results were drawn from open-issue queries for all/recent, integration, TypeSpec, security and `ores-stack`. These are a snapshot, **not** an exhaustive enumeration of every `ores-*` organization or issue. Some other similarly named installations could not be searched, so no zero-issues inference is made about them.
- Priorities are *initial title-based triage scores*, not severity findings. Issue states are marked `open` **at snapshot only**, while execution and admission remain `not-run` / `not-attested`. Re-fetch the issue and its actual source/PR before assigning or closing.
- The strict checker `src/external-admission.mjs`, run via `tests/external-admission.test.mjs` in the existing `npm test`, rejects duplicates, malformed issue references, mis-scoped organizations, source-evidence upgrades and unsupported authorities. This validates the register, **not** the availability or correctness of runtime integrations.

## Cross-boundary seams requiring executable proof

`integration/external-contract-boundaries.v1.json` names **12 proposed seams** from Oreslang and ORES Stack to the external ORESoftware contract stack. All are `blocked` and `not-attested`. They are integration targets; their presence does not assert imports exist.

| Domain | Integration authority | Tracked blocker / verification |
| --- | --- | --- |
| Zorde schema admission | [typespec-json-schema-validator](https://github.com/ORESoftware/typespec-json-schema-validator) | [Zorde #17](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/issues/17), [#18](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/issues/18), [TJSV #230](https://github.com/ORESoftware/typespec-json-schema-validator/issues/230) |
| TypeSpec/JSON schema contract witnesses and ORM | [ores-contracts](https://github.com/ORESoftware/ores-contracts) | [ores-contracts #25](https://github.com/ORESoftware/ores-contracts/issues/25) |
| Oreslang route, RPC/codec framing and native handlers | [api-docs](https://github.com/ORESoftware/api-docs) | [api-docs #326](https://github.com/ORESoftware/api-docs/issues/326), [#316](https://github.com/ORESoftware/api-docs/issues/316) |
| WIT and component ABI | [ores-interfaces](https://github.com/ORESoftware/ores-interfaces) | [ores-interfaces #60](https://github.com/ORESoftware/ores-interfaces/issues/60) |
| Deployment and runtime ABI | [ores-stack](https://github.com/ORESoftware/ores-stack) | [ores-stack/ores-stack-cli #77](https://github.com/ores-stack/ores-stack-cli/issues/77) |
| Exact-tree source and per-backend admission | oreslang-platform-conformance | [#81](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/81), [#82](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/82), [#85](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/85) |

### Findings from inspected main-branch metadata and issues

1. **P0 / TJSV dependency gate.** In `ORESoftware/typespec-json-schema-validator`, `security/npm-audit-exceptions.json` has a `@typespec/compiler` exception expiring **2026-10-14T04:00Z**, now in the past. Its composite GitHub Action invokes `npm-audit-gate.mjs` before `npm ci` and comparison. The expected behavior is fail-closed; do **not** bypass the production advisory or extend the waiver without a real reviewed exception. Upgrade to a non-vulnerable compatible TypeSpec release if validated, regenerate `package-lock.json`, and run real consumers. Package metadata currently reads 0.1.1 in `package.json` but 0.1.0 in the lockfile root; reconcile under `npm ci` and inspect the resulting diff. **A passing updated production audit is not claimed here.**
2. **P0 / api-docs Oreslang compiler gap.** [api-docs #326](https://github.com/ORESoftware/api-docs/issues/326) calls for actual compiled Oreslang route/RPC bindings; a declaration-only fixture does not demonstrate unary v1 or streaming/cancellation v2 framing. Preserve `idl/typespec`, independent `json-schema`, and route-map authorities; compare generated projections using the canonical semantic digest. Do not introduce a third authoring authority.
3. **P0 / Zorde admission.** [Zorde #17](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/issues/17) requires independent TypeSpec/JSON Schema semantics compared **in memory** and cached immutable compiled validation, bounded fuel/memory/depth, no `core` OS dependency, and compiler-owned static metadata. [#18](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/issues/18) notes lack of immutable lockfile and executable native release evidence. Maintain unsupported status until Java, LLVM and relevant Wasm tests run.
4. **P0 / CI provenance and confidentiality.** Existing integration program [#81](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/81) states source-org Actions have had **zero-step failures**. Such runs are `NOT_EXECUTED`, not `passed`. Private-source mirror operations require verified private destination visibility, prior authorization, exact Git tree/blob equivalence and an approved retention policy; never send private source to a public test repository for available CI minutes.

## Release gates to implement in consumer repos (not yet satisfied)

1. **Authorities:** Independently human-authored TypeSpec and JSON Schema Draft 2020-12, pinned in source, with TJSV comparing current in-memory schema objects, semantic normalization and two-way mutation/negative fixtures. A TypeSpec-generated JSON Schema is a comparison witness only.
2. **Projections:** Protobuf numbers, WIT world/interface/resource contracts, OpenAPI projections, generated clients and Oreslang code must be derivative of the reviewed authorities; bind semantic and source digests. An emitter exit 0 without a current-input receipt is insufficient.
3. **Wire/runtime:** Compile and execute Oreslang handlers against `api-docs` v1 and v2; assert media/codec negotiation, framing, cancellation, deadlines, backpressure, binary bytes, duplicate headers, unknown fields and cross-language differential results.
4. **Ownership/security:** Check actor capability boundaries, zero ambient host privileges, `core` freestanding constraints, no leaking payloads or credentials into receipts; use bounded parsers and error categories.
5. **Evidence:** Before changing an edge from blocked, require actual compiler SHA/tree, toolchain pin, TJSV current-input receipt, runtime test receipt, successful nonzero-step CI URL, source/fixture digests, independent review, and rollout/rollback evidence. A later schema-versioned promotion validator must verify these; the v1 registry intentionally **cannot** admit edges.
6. **Pull request safety:** Keep all changes on review branches; respect independently authored contracts, branch protection and native tests. No bulk PR merges based solely on this issue catalog.

## Tests introduced by this branch

`npm test` now discovers `tests/external-admission.test.mjs`. Its negative cases reject an out-of-scope organization, malformed or duplicate issue URLs, unsupported generated authority, changed workflow/receipt fields, falsely promoted `verified` states, reversed/duplicated boundary entries, and unknown external authority. These are **metadata fail-closed tests**, not TJSV execution or compiler conformance.

Use the issue snapshot to select focused implementation branches; do not close any issue solely because it appears in the 100-item register.
