# Organization-wide integration map (coordination contract v1)

This inventory covers the **54 inventoried `ores-truffle-oreslang` repositories as of 2026-11-05**, including bootstrap/empty repositories and the separate Linguist fork. It is a machine-readable map of **intended or documented coordination surfaces**, not a build graph or claims that these packages currently compile together.

- `integration/repositories.json` is the reviewed repository/role/upstream inventory.
- `.oreslang/integration.json` in a member repository mirrors only its own inventory row. The canonical validator rejects extra repos, role drift, unknown names, duplicates, cycles and unjustified "verified" claims.
- `node bin/audit-ecosystem.mjs` validates this registry, and `node bin/audit-ecosystem.mjs --member path/to/integration.json` checks one member manifest against it. `npm test` runs positive and adversarial tests.
- **No unpinned cross-repository checkout** or CI access across private repositories is implied. A member PR or manifest is not compiler evidence. Do not mark a feature implemented until a pinned executable acceptance test with exact tree SHA is reviewed.
- Core/alloc/actor must remain separately linkable for freestanding/bare-metal environments. OTP, OS, network, timers and most service integrations stay optional and cannot silently become core dependencies.
- A repo's `upstreams` are coordination/contract touchpoints, not an assertion that a dependency is available, installed or safe to ship. The review process must replace a declared edge with an exact source revision, supported target profiles, a reproducible test and an evidence receipt before release admission.
- The fork `gh-linguist-fork` is tracked as tooling, not as part of the runtime dependency graph.

## Promotion sequence

1. Land this registry and its negative-case tests.
2. Land matching per-repo manifests on isolated PRs, leaving existing compiler pins, workflows and package semantics unchanged.
3. For each actual integration edge, agree on a versioned API/ABI and exact upstream SHA. Add a *real* cross-repo fixture and a fail-closed target-profile/ownership test.
4. Run the fixture under a real source compiler and, where applicable, a different backend. Store SHA-pinned receipts in `oreslang-platform-conformance`.
5. Only then promote the edge to verified in a future **separate** evidence schema; v1 intentionally has no such switch.

## Source membership reconciliation — November 5, 2026

The October 17 coordination inventory omitted two existing experimental compiler
repositories, `oreslang-source.rs` and `oreslang-source.cranelift`. They are now
registered independently under the existing version-1 metadata-only contract,
with common-source and target-profile coordination edges. Neither is another
name for Forge or LLVM. Two separate member PRs must land to synchronize
`.oreslang/integration.json`: [Rust #22](https://github.com/ores-truffle-oreslang/oreslang-source.rs/pull/22)
and [Cranelift #88](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/88).

This change is intentionally limited to the legacy integration inventory and
its tests. The separate source/platform governance validator proposed in
[conformance #419](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/419)
remains authoritative for its own contract proposal and CI workflow. A
successful local metadata audit is not backend parity, authenticated CI, native
guest execution or platform/physical-hardware promotion.
