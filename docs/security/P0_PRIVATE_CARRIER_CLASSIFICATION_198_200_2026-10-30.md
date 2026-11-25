# P0 private-CI ClaimGraph carrier disposition packet (#198 / #200)

**Status: NON-AUTHORIZING / REVIEW ONLY**

This packet consolidates metadata-only disposition requirements for platform-conformance incidents #198 and #200. It does not reproduce private source bytes, close either incident, authorize ClaimGraph as a carrier, authorize private-source transfer, or request a source-bearing CI run.

## Immutable incident anchors

- Incident #198
  - GitHub issue ID: `6070465058`
  - classification: exact private Java CI/control-plane script blobs observed in a separate private carrier without a currently verifiable independent destination authorization.
- Incident #200
  - GitHub issue ID: `6071264936`
  - classification: private Java governance/control-plane blobs retained in a separate private carrier; not demonstrated public exposure.

Shared carrier metadata recorded by the incidents:
- carrier: `ClaimGraph-test/claimgraph-e2e`
- immutable repository ID: `1350751074`
- source repository: `ores-truffle-oreslang/oreslang-source.java`
- immutable source repository ID: `1400792274`

## Independent reviewer

The required independent reviewer is `@ORESoftware`, immutable GitHub user ID `11139560`.

For each incident, the reviewer must record substantive findings in the corresponding issue. If and only if all exit criteria are satisfied, the independently authored disposition comment must contain the exact standalone marker:

- `PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#198`
- `PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#200`

The issue must then be closed by that same independent identity with `state_reason=completed`.

## Required findings

Each disposition must explicitly cover:

1. source/placement provenance and transfer mechanism;
2. contemporaneous authorization classification;
3. Git-object and ref retention or purge;
4. Actions logs, artifacts and cache retention;
5. credential/secret and audit-log review;
6. fork, clone and external-copy disposition;
7. provider-retention limitations;
8. whether retained governance/control-plane files are permitted fixtures or unauthorized private material;
9. future private-source mirroring decision;
10. explicit closure decision.

## Current decision

Both incidents remain `hold`.

A private carrier, successful workflow, source-free model test, ref cleanup, artifact expiry, or later policy change is not retroactive authorization. No source transfer is authorized by this packet.
