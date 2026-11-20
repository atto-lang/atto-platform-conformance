# P0 private-CI hnpt-e2e carrier disposition packet (#252)

**Status: NON-AUTHORIZING / REVIEW ONLY**

This packet consolidates metadata-only disposition requirements for platform-conformance incident #252. It does not reproduce private source bytes, close the incident, authorize `honeypot-r-us-test/hnpt-e2e` as a carrier, authorize private-source transfer, or request a source-bearing CI run.

## Immutable incident anchors

- Incident: #252
- GitHub issue ID: `6129229261`
- Source-side tracker: `ores-truffle-oreslang/oreslang-source.java#2307`
- Source repository: `ores-truffle-oreslang/oreslang-source.java`
- Immutable source repository ID: `1400792274`
- Carrier repository: `honeypot-r-us-test/hnpt-e2e`
- Immutable carrier repository ID: `1346492776`
- Historical source-bearing carrier commits recorded by the incident:
  - LLVM-related: `8d63d6200cffa93a1731129f533e9ed7f2d9ed3b`
  - Java-related: `48a9789fa49a59ea6bd398fb46a60dbd3680b4b7`

Temporary branch rollback is not evidence of Git-object purge. Historical object retention, Actions data, provider retention, credentials/secrets, forks/clones/downloads and contemporaneous authorization remain subjects for independent disposition.

## Independent reviewer

The required independent reviewer is `@ORESoftware`, immutable GitHub user ID `11139560`.

If and only if all substantive exit criteria are satisfied, the independently authored incident comment must have the exact standalone body:

`PRIVATE_CI_INCIDENT_DISPOSITION_RESOLVED issue=#252`

The issue must then be closed by that same independent identity with `state_reason=completed`. Approval of this packet or deletion/reset of refs is not sufficient.

## Required findings

The disposition must explicitly cover:

1. exact source/placement provenance and transfer mechanism;
2. contemporaneous authorization classification;
3. Git-object/ref retention and provider-assisted purge requirements or limitations;
4. Actions logs, artifacts, caches and run-ref retention;
5. credential/secret exposure and audit-log review;
6. fork, clone, download and other external-copy disposition, with inaccessible evidence marked UNKNOWN;
7. whether carrier ID `1346492776` must remain permanently quarantined;
8. future private-source mirroring decision;
9. explicit closure decision.

## Current decision

Incident #252 remains `hold`.

The source-side publisher must fail closed on this incident and quarantine the carrier by both canonical slug and immutable repository ID until independent disposition is complete. No source transfer is authorized by this packet.
