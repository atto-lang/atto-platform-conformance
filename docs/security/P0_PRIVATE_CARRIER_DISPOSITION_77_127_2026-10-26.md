# P0 incidents #77 and #127 — independent disposition packet

**Status:** review-only / non-authorizing.  
**Base:** `a4690d6e58ba9aa5ea8d95462a9b723e28e1c105`  
**Purpose:** give the independent security owner a current-base, metadata-only place to record closure/retention decisions for the two older private-carrier incidents. This document does not authorize source transfer and does not close either incident by itself.

## Incident #77 — Scintilla private carrier

Carrier:
- `scintilla-run-test/gleam-runner-conformance`
- repository ID `1323598260`
- current visibility: private

Known retained source-bearing refs:
- `integration/llvm559-current-ref-proxy-exact-20261017` -> `a0041d9600b2c57c421e04dd697c3cdeb907c11e`
  - tree `34373f0d143a6fdad74856078d800d7c1f6e98fa`
  - includes Oreslang compiler/runtime paths such as `src/main/cpp/oreslang/backend/LlvmCodegen.cpp`
- `native/llvm548-current-ref-exact-20261017` -> `4acdfb9d21521edac153c65c84908eeaffcfdee6`
  - tree `d1162814bc69e3671b0b8993a1cbd34619935b67`
  - includes Oreslang runtime paths such as `src/main/cpp/oreslang/runtime/NativeActorScheduler.c`

Current incident-run artifact endpoints for runs `39062593395`, `39076252468`, `39075673604`, `39076943010`, `39076061206`, and `39065463027` have been observed with zero retained artifacts. Artifact expiry/removal is not Git-object, log, cache, clone, or provider-retention purge evidence.

### Independent disposition required for #77

1. Classification of documented placements:
   - [ ] authorized under contemporaneous policy
   - [ ] unauthorized private-to-private placement
   - [ ] mixed; exact exceptions and evidence: <record>
2. Live source-bearing forensic refs:
   - [ ] preserve until <date/condition>; rationale: <record>
   - [ ] destructive cleanup approved now; exact refs/objects: <record>
3. Provider-retention / GitHub Support limitations after cleanup:
   - <record>
4. Audit-log / credentials / secrets / third-party Actions / cache-artifact review:
   - <record>
5. Current-ref and historical-copy inventory final disposition:
   - <record>
6. Closure:
   - [ ] exit criteria satisfied; approve issue close with `state_reason=completed`
   - [ ] keep open; remaining blockers: <record>

## Incident #127 — dummy-stack private carrier

Carrier:
- `ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-infra`
- repository ID `1412142815`
- current visibility: private

Known retained source-bearing state:
- source-bearing PR #55 remains open/draft at `22f9d2707c344cb157695f46212f0bf70b471245`
- live branch `ci/authorized-22f9d2707c344cb157695f46212f0bf70b471245` points to that commit
- tree `af5804215ae5de39960526f162b9ae77253140e3` contains the `private-oreslang-source` subtree
- historical incident commit `952deab60cdb62bd59476238b9eac54bc3b4fa10` remains directly addressable
- historical tree `913af02d96b8177dcf470e7602ed89a3996cc5dd` contains `private-oreslang-source` paths
- run `39347163727` currently exposes zero retained artifacts
- the all-`a` source identifier recorded in the incident remains unreconciled

### Independent disposition required for #127

1. Exact originating source provenance:
   - source repository ID: <record>
   - source commit: <record>
   - source root tree: <record>
2. Contemporaneous authorization:
   - [ ] valid destination and exact source-snapshot authorization existed before writes
   - [ ] no valid authorization; placement unauthorized
   - [ ] indeterminate; reason: <record>
3. All-`a` source identifier provenance/disposition:
   - <record>
4. Live source-bearing branch and historical commit:
   - [ ] preserve until <date/condition>; rationale: <record>
   - [ ] destructive cleanup approved; exact refs/objects: <record>
5. Provider-retention / audit-history / credential and secret review:
   - <record>
6. Closure:
   - [ ] exit criteria satisfied; approve issue close with `state_reason=completed`
   - [ ] keep open; remaining blockers: <record>

## Release boundary

Neither incident may be treated as cleared by PR merge, artifact expiry, private repository visibility, or source-free CI alone. Source-bearing cross-org execution remains blocked until the incident-specific independent dispositions are recorded and all source/destination protected-main authorization requirements are satisfied.
