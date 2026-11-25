# P0 incident #22 — private-source carrier containment and cleanup handoff

**Snapshot date:** 2026-10-17 UTC. **Status:** immediate public visibility containment performed; historical disclosure and cleanup **OPEN**. This document is an inventory/administrator handoff, not an approval to mirror Oreslang private source.

## Authenticated repository identity and visibility

- Previously public carrier: `zed-pkg-test/java-app`
- Verified numeric repository ID: `1323575966`
- Verified **current** visibility: `private`; non-archived.
- Private Java source: `ores-truffle-oreslang/oreslang-source.java`, numeric ID `1400792274`.
- Review candidate private carrier: `sagitta-stack/sagitta-infra`, numeric ID `1357615104`.
- Public visibility of the first carrier was independently verified before containment in issue #22; making the repository private **does not retract earlier disclosures or purge commits, forks, artifacts or external clones**.

## Bounded authenticated inventory performed

`GET /repos/zed-pkg-test/java-app/branches?per_page=100&page=N` was paged through page 11; page 11 returned 25 entries. **1,025 live branch refs**, of which **573 names begin `ci/`**, **34 begin `audit/`**, and **875 names match the broad Ores/Java/LLVM/actor/routing candidate heuristic**. There are **907 distinct current branch-tip commit SHAs**. The heuristic means `candidate for review`, not `confirmed exposed source`. Neither branch count nor heuristic count measures historically reachable/private Git objects.

Previously reported exposed branch names (issue #22):
- `ci/rw-gate-close-full-java-20261012`
- `ci/critical-rw-java-parity-20261012`

Both currently point to `9dd7d6a163e20738ad8d6016312f7db5e131f6d4`. Authenticated recursive tree listing at that tip contained 48 entries and no `src/main/java/` or `private-oreslang-source/` path prefixes. This **does not prove old full-source commits are unreachable or purged**; it only describes the current tip.

Other inspected current trees:
- `audit/java-nominal-selector-20261013`: 67 tree entries.
- `audit/llvm308-scalar-frame-20261013`: 308 tree entries, including seven `src/*.cpp` files.
- `ci/oreslang-source-actor-browser-20261012`: 952 tree entries.

**CI run inventory:** GitHub returned `total_count=9079` for `/actions/runs?per_page=100&page=1`. This is historical workflow-run volume, **not 9,079 confirmed source-containing artifacts**. Workflow artifacts, caches, logs, forks, tags, Git unreachable objects, PR refs, release attachments and external clones are **not yet exhaustively inventoried**. The connected repository fetch interface refused direct tags, forks and artifact collection URLs. Use a repository administrator's authenticated API/CLI plus GitHub Support to finish those categories.

## Administrator actions and evidence requirements

1. **Preserve forensic evidence first:** list branch/tag/PR refs with tip SHA, capture original exposure revisions and time window, and securely retain audit-log/clone/access metadata. Do not prematurely delete the only refs that establish exposure provenance.
2. **Inventory all reachable and historical objects:** enumerate all 1,025 branch refs, tags, forks, cached archives, release assets, Actions runs/logs, artifacts and caches; cross-reference suspected exposed private blobs by exact Git object hashes. Investigate other public carriers independently.
3. **Open GitHub Support sensitive-history cleanup request:** provide this repository ID, the source project and verified exposed revisions/paths (privately to Support), request advice for unreachable Git objects, PR refs and GitHub infrastructure caches. Document case number, scope, timestamps, irreversibility limitations and inaccessible-URL proofs.
4. **Perform security analysis:** review for leaked tokens/keys/passwords, internal endpoints and regulated data; rotate/revoke compromised credentials; review audit logs and downstream clones. Record owner, disposition and sign-off, without including secret values in issue comments or public artifacts.
5. **Protect source and approved carrier main:** require independently verified code-owner review, stale approval dismissal, mandatory successful **executed** exact-head checks, restricted direct writes/force pushes, and no bypass. Source Java issue #904 tracks the protection controls.
6. **Keep private-source mirroring disabled:** publisher integration #1123, destination approval #1092, and Sagitta carrier hardening #7 are not a substitute for independent approved numeric destination ID, reviewed immutable source commit/tree, and source/target protected-branch proof. The current publisher allowlists remain empty. Issue #962 is still an explicit denial gate.
7. **Independent exit review:** confirm historical disclosure limits, cleanup results, all status checks, code-owner approvals, and current source/target private identities **before** authorizing even one snapshot. Do not close #22 solely because the carrier is now private.

## Evidence to collect for closure

- UTC incident timeline, GitHub repository ID/visibility audit results, inventoried refs/commit/blob hashes, GitHub Support case and results.
- Artifact/cache/fork/PR history inventory with limitations; expired/not-found evidence is not proof of deletion from external clones.
- Credential/data assessment and rotations, org audit log review, security owner sign-off.
- Protected-main ruleset acceptance proof (missing approval, stale approval, and zero-step checks must block).
- Independent explicit authorization for a specific destination numeric ID and exact immutable source commit/tree.

**HOLD:** no further cross-org private compiler/runtime source transfer and no native/guest certification claim based on source-free CI results.
