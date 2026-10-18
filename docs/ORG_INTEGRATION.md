# Oreslang organizational integration map (v1)

This is a **private planning and structural-admission catalog** for 52 GitHub repositories as inventoried on 2026-10-17. It is not a dependency lockfile, feature-completeness report, CI attestation, permission grant, or approval to export source. See `integration/org-repositories.v1.json`.

## Boundaries

- `oreslang-common-source` owns future normative semantic/ownership/actor/OTP contracts. The backend compilers are still separate. Do not claim HIR/MIR unification exists yet.
- `oreslang-target-profiles` owns target, capability and freestanding admission; it is not an actual linker/sandbox. Reconcile concurrent draft schemas before consuming them.
- `oreslang-platform-conformance` owns fixture, compiler-identity and real guest test **evidence**, separating source guest execution from host stubs, mock tests and zero-step jobs.
- Every `upstreams` entry denotes an **intended integration interface**. It does **not** assert that this repo currently checks out, packages, imports, executes, or is compatible with the upstream.
- Every `nextGate` is a specific next testable deliverable; completing the text alone never marks it done.
- 44 repositories are private, 8 public in this snapshot. Catalog and validation remain inside a private repo; do not publish private source, manifests containing sensitive code, or private test artifacts.
- Incident [platform-conformance #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) remains open. **Do not clone or mirror private sources to another org or test carrier** except after the independent, exact-head, protected authorization process has explicitly allowed that specific action and destination. No integration test here copies source between repos.

## Immutable candidate pins

The organization-wide candidate lockfile is [`compatibility-candidate.v1.json`](../integration/compatibility-candidate.v1.json). It selects one complete Git commit per repository **without implying that the commits have been tested together**. The independent [candidate policy](COMPATIBILITY_MANIFEST.md) explains the evidence and incident prerequisites. This lockfile deliberately cannot be promoted by editing a status field.

## Run checks

```sh
node bin/check-org-integration.mjs
node bin/check-compatibility-release.mjs
npm test
```

The standalone command verifies a closed 52-repository inventory, correct name/visibility vocabulary, no unknown external or self links, deterministic ordering, no duplicate edges, and an acyclic target graph. The output evidence tier is `STRUCTURAL_METADATA_ONLY`. The Node unit tests include adversarial malformed-input cases. GitHub Actions jobs with **zero executed steps** must be labeled `NOT_EXECUTED`, even if the workflow conclusion says `failure`.

## Integration waves

1. **Security and proof:** close incident #22 with independent signoff and restore source-org Actions runner execution. Keep private-source CI off other organizations until authorized. Conformance must record executable identity, revision, produced binary/artifact SHA and real guest test result.
2. **Stable contracts:** converge `core / alloc / actor / std / otp` resolved-closure schema and shared language/typed IR fixtures. Prove freestanding core with a real linked native image, not just host metadata.
3. **Compiler parity:** maintain source/negative fixtures across Java, LLVM, JS, .NET, Forge, Wasm, HDL as capabilities permit. Reject unsupported features, do not count host mailbox mocks as guest actor execution.
4. **Runtime interop:** validate ownership and effect boundaries for serialization, Rx, RPC, Spin/HTTP, queues, OTel and hot reload using pinned compiler commits and exact oracle results.
5. **Platforms/applications:** run real native artifacts on browser, desktop, mobile, embedded/IoT, FPGA/ASIC tiers, and real demos. Distinguish RTL simulation, native-host tests, QEMU execution and physical hardware measurements.
6. **Developer delivery:** use canonical `oreslang-cli` diagnostics in editors, one formatter, `oreslang-stack-cli` flags-2-env, and explicit verified evidence before marketing performance/feature claims.

## Maintenance and promotion policy

When adding/removing a GitHub repo, refresh inventory from the authenticated organization, update `expectedRepositoryCount`, supply its named integration gate, and run negative structural tests. For an individual `nextGate`, open a scoped PR **in that repository**, pin upstream commits/contracts and capture an exact-head runner report after it actually executes. The central registry's planned edge can be labeled implemented in a separate future evidence registry **only** when a reproducible consumer test proves it. No automatic cross-repository cloning, no blind merges, no bypass of incident review, and no empty/failed runner treated as green.
