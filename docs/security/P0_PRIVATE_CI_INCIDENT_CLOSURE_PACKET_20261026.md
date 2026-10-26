# P0 private-CI incident closure decision packet — 2026-10-26

Status: **NON-AUTHORIZING / REVIEW ONLY**

This document contains metadata and incident-management facts only. It contains no private Oreslang source bytes, does not authorize source transfer, does not request a source-bearing rerun, and is not itself sufficient to close incidents #22, #77, or #127.

The trusted private-source publisher now requires all three incidents to be exactly `closed` with `state_reason=completed` before it may read or export private source. Until the independent decisions below are recorded, the correct state is HOLD.

## Independent reviewer

Required reviewer / incident owner: `@ORESoftware`.

At packet creation, no `ORESoftware`-authored disposition comment was present on #22, #77, or #127.

## Incident #22 — historical public carrier exposure

Verified containment facts:

- affected carrier: `zed-pkg-test/java-app`, repository ID `1323575966`;
- repository is now PRIVATE;
- named incident refs `ci/rw-gate-close-full-java-20261012` and `ci/critical-rw-java-parity-20261012` currently point to ordinary baseline commit `9dd7d6a163e20738ad8d6016312f7db5e131f6d4`;
- historical exact-source commit `a7df2aadb6ff06749d717a06f1824954122e4496` remains directly addressable and its tree still contains the historical source mirror;
- run `38490558980` currently exposes no retained Actions artifacts via the artifact endpoint;
- draft inventory / Support handoff PR #68 records 1,025 current branches, 907 distinct current tip commits, and 9,079 historical Actions runs. Those totals are inventory scope, not a claim that every item contains sensitive source.

Independent decisions/evidence still required before #22 can be closed/completed:

- [ ] GitHub Support sensitive-history / unreachable-object / log / cache / PR-ref cleanup disposition is documented, including provider-retention limitations.
- [ ] Credential / secret assessment and organization audit-log review are completed and recorded.
- [ ] Historical ref, artifact, fork/clone and external-copy inventory has a final disposition.
- [ ] Incident owner explicitly approves or denies any future resumption of cross-organization private-source mirroring.
- [ ] Independent reviewer states that the remaining historical-object accessibility is acceptable for closure, or approves a specific purge plan.

## Incident #77 — repeated private-to-private Scintilla carrier placements

Verified containment facts:

- affected carrier: `scintilla-run-test/gleam-runner-conformance`, repository ID `1323598260`;
- repository is PRIVATE;
- source-bearing incident ref `integration/llvm559-current-ref-proxy-exact-20261017` remains live at `a0041d9600b2c57c421e04dd697c3cdeb907c11e`;
- source-bearing incident ref `native/llvm548-current-ref-exact-20261017` remains live at `4acdfb9d21521edac153c65c84908eeaffcfdee6`;
- the incident inventory covers Java, LLVM, .NET, Forge and serialization/validation placements and requires review of all 118 current carrier refs plus historical/deleted refs and Actions state;
- incident runs `39062593395`, `39076252468`, `39075673604`, `39076943010`, `39076061206`, and `39065463027` currently expose no retained artifacts via the artifact endpoint;
- existing incident guidance explicitly preserved the live refs pending independent owner disposition.

Independent decisions/evidence still required before #77 can be closed/completed:

- [ ] Classify the documented placements as authorized or unauthorized under the policy actually in force at each transfer time.
- [ ] Choose one reviewed forensic disposition for the live source-bearing refs: preserve for a defined retention period, or approve destructive cleanup now.
- [ ] If purge is selected, document exact refs/objects to remove and GitHub/provider retention limitations.
- [ ] Complete audit-log, credential/secret, third-party action and artifact/cache retention review.
- [ ] Record the final inventory disposition for all known current and historical carrier placements.
- [ ] Incident owner explicitly accepts closure and any future private-source resume conditions.

## Incident #127 — dummy-stack placement during an unprotected-policy window

Verified containment facts:

- affected carrier: `ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-infra`, repository ID `1412142815`;
- repository is PRIVATE;
- source-bearing carrier PR #55 remains OPEN + DRAFT at `22f9d2707c344cb157695f46212f0bf70b471245`;
- live branch `ci/authorized-22f9d2707c344cb157695f46212f0bf70b471245` still points to that source-bearing commit;
- tree `af5804215ae5de39960526f162b9ae77253140e3` contains the `private-oreslang-source` subtree;
- historical commit `952deab60cdb62bd59476238b9eac54bc3b4fa10`, tree `913af02d96b8177dcf470e7602ed89a3996cc5dd`, remains directly addressable and source-bearing;
- run `39347163727` currently exposes no retained artifacts via the artifact endpoint;
- the historical commit message contains an unreconciled all-`a` source identifier.

Independent decisions/evidence still required before #127 can be closed/completed:

- [ ] Reconcile the exact originating source repository ID, source commit and source root tree for the historical placement.
- [ ] Record whether valid contemporaneous destination + source-snapshot authorization existed before the source-bearing writes.
- [ ] Classify the placement as authorized or unauthorized under the policy then in force.
- [ ] Choose preserve-for-forensics vs purge for the live source-bearing branch and historical commit.
- [ ] Resolve the provenance/disposition of the all-`a` source identifier.
- [ ] Document audit-history / provider-retention limits and any credential/secrets exposure review.
- [ ] Incident owner explicitly accepts closure.

## Common resume gate

Closing one incident does not authorize source transfer. Resume requires, independently:

- all three incidents closed with `state_reason=completed`;
- protected source `main` with required CODEOWNER / approval / stale-review / admin / no-bypass / no-force-push / no-delete controls;
- independently reviewed source-owned destination and exact source-snapshot authorization;
- verified private destination numeric repository identity;
- source-free governance/carrier checks with actual executed steps;
- trusted publisher re-attestation immediately before any source read or write.

## Reviewer record

The independent reviewer should record explicit decisions in the incident threads and, if useful, check the applicable boxes in this document. A PR approval by itself is **not** a substitute for the incident-specific factual dispositions above.


## Current authenticated metadata readback — 2026-10-26

The following was re-read from GitHub after opening this packet. It is containment/forensic metadata only and does not constitute closure.

### #22
- `zed-pkg-test/java-app`: repo ID `1323575966`, `private=true`, `visibility=private`, forks `0`, `allow_forking=false`.
- `ci/rw-gate-close-full-java-20261012` -> `9dd7d6a163e20738ad8d6016312f7db5e131f6d4`, tree `fdc4ea9334e6cee0aff540717c499672729625db`.
- `ci/critical-rw-java-parity-20261012` -> the same baseline commit/tree.
- historical source-bearing commit `a7df2aadb6ff06749d717a06f1824954122e4496` remains addressable, tree `97742021f9c5745412d4975dc73397a74fb71e8a`.
- run `38490558980` artifact endpoint: `total_count=0`.

### #77
- `scintilla-run-test/gleam-runner-conformance`: repo ID `1323598260`, `private=true`, `visibility=private`, forks `0`, `allow_forking=false`.
- `integration/llvm559-current-ref-proxy-exact-20261017` remains at `a0041d9600b2c57c421e04dd697c3cdeb907c11e`, tree `34373f0d143a6fdad74856078d800d7c1f6e98fa`.
- `native/llvm548-current-ref-exact-20261017` remains at `4acdfb9d21521edac153c65c84908eeaffcfdee6`, tree `d1162814bc69e3671b0b8993a1cbd34619935b67`.
- runs `39076061206` and `39065463027` artifact endpoints: `total_count=0`.

### #127
- `ores-dummy-org-oreslang-stack/ores-dummy-org-oreslang-stack-infra`: repo ID `1412142815`, `private=true`, `visibility=private`, forks `0`, `allow_forking=false`.
- live branch `ci/authorized-22f9d2707c344cb157695f46212f0bf70b471245` remains at `22f9d2707c344cb157695f46212f0bf70b471245`, tree `af5804215ae5de39960526f162b9ae77253140e3`.
- historical source-bearing commit `952deab60cdb62bd59476238b9eac54bc3b4fa10` remains addressable, tree `913af02d96b8177dcf470e7602ed89a3996cc5dd`.
- run `39347163727` artifact endpoint: `total_count=0`.

### Independent-review status
At this readback, no submitted review exists on PR #68 or PR #175 and no `ORESoftware`-authored disposition comment exists on #22, #77 or #127.

Therefore the safe state remains HOLD.
