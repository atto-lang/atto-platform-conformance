# Supervisor STOP exact-head audit and private-CI hold — 2026-11-03

This is a **read-only evidence snapshot**, not approval to export private code,
a runnable CI result, or evidence of executable guest-supervisor parity.

## Executed-versus-blocked evidence

All five inspected source-organization Actions jobs at the existing PR heads
returned `conclusion=failure` with `steps=null`. A job with no executed steps
cannot prove a compiler/test failure or a successful source build.

| Backend | Source PR | Branch head checked | Current-head source-org CI |
| --- | --- | --- | --- |
| Java | [#2423](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2423) | `c46ed5e5457805f7e2ca31a9a29e3fa569db2543` | No executed job |
| LLVM | [#1279](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1279) | `4a3a1d62f017b3a0e147f4ba3aae4ab2f52df734` | No executed job |
| WASM | [#248](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/248) | `492ac62946781a78d9e815a24643e9c47da20d1c` | No executed job |
| Cranelift | [#60](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/60) | `dbafc1a2ba6206b90208afe573a1f0cfcb5e3275` | No executed job |
| .NET | [#311](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/311) | `11975d97ee94a222d68c66b795460702550cca33` | No executed job |

The new Java source changes redact STOP/RESTART permit nonces and add a real
two-supervisor-group cross-reconciliation test. Cranelift adds an
instance-discriminated STOP ticket so a new host ledger cannot accept a
ticket from an old ledger with reused numeric names. .NET and WASM add
separate-ledger replay tests. These source changes are **not release CI
certified**, except for the explicitly scoped local WASM proof below.

## Exact-source local execution without cross-org mirroring

A local Node.js 22 execution of the updated WASM STOP host ledger used
production files with exact `git hash-object` matches:
- `src/supervisor-stop-ledger.mjs`: `64b3bb63e89c58a794f74b4b5beb23116783fe87`
- `src/actor-max-threads-source-policy.mjs`: `4e9440750de2309a4bd039b7f3e276a5ec09f88a`
- `tests/supervisor-stop-ledger.test.mjs`: `00bda94693ee4db635d2fc9b3c8fe89a019d5c81`

Result: **five tests passed, zero failed**, including the newly added
cross-ledger ticket replay case and source-level supervisor rejection.
This proves the **isolated JS host ledger and source admission**, not guest
Wasm worker execution or real actor finalization.

The updated shared contract also ran locally with exact blob identity:
- `fixtures/supervision/v1/stop-only-runtime-gate.json`: `d128b527da389ca43fe89b224ce9f088a2e40ae0`
- `bin/validate-supervisor-stop-runtime-gate.mjs`: `3948b323e50fed4c0462818350e70c451030951b`
- `test/supervisor-stop-runtime-gate.test.mjs`: `2901e1ffda6ae6b829761d0557724295794ac4c8`

Result: **five mutation/contract tests passed, zero failed**.
The closed-world answer remains
`hostStopLedger=5, focusedHostStop=2, sourceStopPlan=1,
guestSourceParity=0, currentHeadCertified=0, releaseStatus=HOLD`.
Historical source-blob proof is not current-head release certification.

## Private CI governance: do not copy source to another organization

As of this read-only audit,
[incidents #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22),
[#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77),
[#127](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/127),
[#171](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/171),
and [#172](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/172)
are all **open**. The protected, source-owned publisher policy requires
independent incident disposition, source-head authorization, destination
identity approval, protected branch controls and one-use private CI namespace.
Available Actions minutes and a private target repository alone are insufficient.

**No new cross-organization private-source mirrors or source-bearing
workflow runs were created in this audit.**

## Release-grade execution still required

1. Run Java's full real `ActorRuntime` + `SourceSupervisorAwaitStopTest`
   and `SourceSupervisorStopLoweringTest` suites at the final exact PR head,
   including physical child teardown, CONTROL isolation and STOP acknowledgments.
2. Integrate LLVM native STOP receipts into compiled source supervision and
   test actual program exit, Clang ASan/UBSan, and final-executable identity.
3. Bind WASM, Cranelift and .NET host STOP ledgers to their actual guest actor
   runtimes; test identical `.ores` (legacy) or `.atto` (new canonical) source.
4. Execute source-org Actions or an approved, source-owned/self-hosted runner;
   cross-org mirroring resumes only after the independent security gates clear.
5. Keep these PRs draft and unmerged until actual executed exact-head evidence
   substantiates the relevant runtime/guest gate.
