# PROPOSED private Oreslang CI carrier — reviewer approval required

**Status: PROPOSAL ONLY — DO NOT COPY PRIVATE SOURCE.**
This document provides immutable identifiers and evidence to simplify a
code-owner/security decision. Its presence in an unprotected PR branch is
**not an approval** or a trusted policy source. The publisher must receive
pins from separately authenticated, independently reviewed policy.

## Candidate and verified read-only evidence

| Property | Observed value |
| --- | --- |
| Source | `ores-truffle-oreslang/oreslang-source.java` |
| Source numeric GitHub repository ID | `1400792274` |
| Candidate private carrier | `voxletra/voxletra-e2e` |
| Candidate destination numeric repository ID | `1311678027` |
| Candidate visibility | GitHub API `private`, not archived |
| Approved source commit SHA | **UNAPPROVED — requires exact selected PR head** |
| Approved source tree SHA | **UNAPPROVED — requires independently checked commit tree** |
| Approved destination base commit/tree | **UNAPPROVED — must audit workflows and full base** |
| Reviewed source-tree export scope | **UNAPPROVED** |
| Code-owner/security approval | **NOT GRANTED** |
| Public exposure incident #22 containment | **NOT VERIFIED** |

**Source-free capacity probe** (no checkout, private source, credentials,
external actions or artifacts):
- Private carrier run [#38940228917](https://github.com/voxletra/voxletra-e2e/actions/runs/38940228917)
- Event: `push`; job: `capacity`; successful hosted-runner ID:
  `1000002089`; exact run commit:
  `b9d18dced1ed5848a9fcf2441e65a44abc3ef199`
- Workflow path:
  `.github/workflows/oreslang-source-free-capacity.yml`
- Exact workflow Git blob SHA: `6969c1b96f8ed40152c7b34235e5cff1d8d215b2`
- GitHub reported workflow file type `blob`, mode `100644`, under
  source-free workflow commit tree
  `4fa25a05f0824e01e1b940008a52075019616450`.
- **The capacity probe can expire**: publication now requires a matching
  successful run within 24 hours and needs a fresh one thereafter.

**Synthetic-only native/toolchain check:**
[private Actions #38940949779](https://github.com/voxletra/voxletra-e2e/actions/runs/38940949779)
passed nested source Git-tree equality, executable mode, injected-file
mismatch and native Clang 18 execution. No Oreslang private files were
transported; no JDK 25/GraalVM compiler evidence was produced.

## Reviewer decision (must be made outside this PR)

1. Contain and assess
   [public-source incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
   before authorizing new exports.
2. Independently verify actual protected policy origin, source repository
   identity and branch protections (branch/ruleset endpoints are not available
   through the present GitHub connection); do not rely on values supplied
   by untrusted PR code, a workflow dispatch parameter, or this proposal.
3. Approve the *precise* source PR/head commit and complete source Git tree,
   the destination numeric repository ID, benign reviewed destination
   base commit/tree/workflow, the isolated source prefix and allowed test
   commands; explicitly decide whether sensitive/private source transfer
   across orgs is permitted at all.
4. Limit the credential to approved source-read and destination-write scope
   and audit logs. Preserve secret isolation, untrusted PR limitations and
   prevent destination Actions workflows from uploading or printing code.
5. Recheck source/destination privacy on every write and exact source subtree
   SHA before isolated new-ref publication. Track tests to immutable commit
   IDs and retain logs/artifacts without exposing private source.
6. Record named independent approvers, approval time, scope, incident
   containment sign-off, evidence and expiration in a protected location.
   None is asserted by this file. On any missing proof, deny publication.

## Decision outcome at the time of this proposal

- PRIVATE CI runner capacity: **VERIFIED** for a limited source-free job.
- Synthetic Git tree and native execution: **VERIFIED**.
- Publisher offline mocked-GitHub security tests: **44/44 PASS**.
- Private Oreslang source export authorization: **NOT VERIFIED**.
- Actual cross-org private source transfer: **NOT PERFORMED**.
- Full Oreslang JDK 25/GraalVM, LLVM, .NET, Wasm, Forge CI: **NOT VERIFIED**.

This proposed carrier must not be used for confidential source merely
because an account has write permissions and Actions minutes.
