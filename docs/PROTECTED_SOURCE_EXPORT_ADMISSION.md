# Protected-main private-source export gate (draft)

**Release state:** source export remains BLOCKED. All five Oreslang backend `main` branches currently report `protected=false`. There is no reviewed source snapshot approval in protected main. Do not use private Actions minutes or a private destination as substitute consent.

The older `bin/private-mirror-publish.mjs` admitted a write when its caller supplied the destination name in `ORES_APPROVED_PRIVATE_MIRRORS` and both repositories were private. That was not sufficient proof of independently reviewed source confidentiality authorization.

This draft changes the **real publisher's** `requirePrivateMirror()` admission, called before source reads and before every destination Git-object/ref write:

1. Require a pinned 40-hex source **commit and root tree**, and a source repository name among the five immutable Oreslang repository IDs.
2. Query both source and destination identities and require private/active status and exact numeric IDs (the destination ID must match independently reviewed policy).
3. Query `source:main` and require actual `protected=true`; query enforced review settings and require independent approving review, code-owner review, stale approval dismissal, admin enforcement and no listed bypass actors. If the GitHub App cannot access protection details, **deny**.
4. Read `.github/CODEOWNERS` from that exact protected-main commit and require its **final five non-comment rules** to exactly own CODEOWNERS itself, all three private-CI data files, and the dedicated private-CI policy workflow by the same explicitly trusted security principal set. This prevents a later wildcard rule from silently overriding policy-file ownership.
5. Read `.github/private-ci-required-checks.json` and bind each approved required check to both its exact check context and GitHub App ID. Branch protection may require additional checks, but every required check must be app-bound and every policy-listed security check must be present. Current GitHub Actions evidence uses app ID **15368**.
6. Read destination and snapshot approval files from the exact pinned protected-main commit, not from a PR checkout or local environment. Require exact destination name + numeric ID, and exact source commit + root tree + destination ID.
7. Resolve the source commit from the original repository and verify it identifies the pinned root tree. Re-read protected-main ref before success; drift denies admission. Repeat the check before **each** destination write, including the final ref.
8. Reject missing or malformed metadata, policies, timestamps, credentials, revisions or GitHub errors, without emitting token-bearing raw API messages.

The environment destination list remains only an additional restrictive filter: it is **never** authoritative approval. The CLI now requires a separate source-tree SHA; callers with only a source commit cannot export.

These mocked source-free tests demonstrate guarded control flow and denial, **not** official branch protection, reviewer independence, incident containment, or permission to mirror. The admission checker must be independently audited before merge, including protection rulesets and bypass actor semantics. Existing source security incident [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) remains P0. This change does not run compilers or promise native parity.

## Additional Git-object integrity hardening (2026-10-16)

7. Before **any** destination blob publication, decode GitHub's source blob
   response as canonical base64 (allow only GitHub line wrapping), enforce the
   pinned byte length, and independently recompute the Git object SHA-1 as
   `SHA1("blob <length>\\0" || raw_bytes)`. Reject a response whose bytes do
   not hash to the blob SHA embedded in the approved root Git tree—even when
   every API-provided `sha` and `size` field agrees. Destination POSTs receive
   only the verified, normalized base64 payload.

   The mocked GitHub publisher test now uses an actual SHA for the four-byte
   `42;\\n` fixture rather than an arbitrary hash and covers an in-place
   four-byte forgery, malformed/noncanonical base64, and wrapped legitimate
   base64. A focused independent Node 22 test of the verification function
   passed **10/10** cases. This does **not** constitute full private-mirror
   integration testing or an authorized cross-organization transfer.

**Status unchanged:** the protected-source approval and original incident
review remain prerequisites. Do not mirror actual source simply because this
cryptographic preflight passes; the approved source/destination identities,
protected main, exact source snapshot and actual funded runner must all be
confirmed independently.


## 2026-10-17 policy-authenticity hardening

The admission code now closes the two audit gaps previously recorded on this PR:

- CODEOWNERS is not inferred from the branch-protection boolean. The protected-main CODEOWNERS bytes are Git-blob verified, and its final exact rules must cover CODEOWNERS, all private-CI approval/check files, and the workflow that emits the required private-CI policy check with one trusted owner set.
- Required checks are not accepted by name alone. The protected-main policy records exact `context + appId` pairs and admission verifies those pairs against branch protection. Additional required checks are allowed only when they are also app-bound.

This still does **not** enable mirroring by itself. All five source repositories currently report `main.protected=false`; the policy files and branch protection must land and be independently reviewed before any private source export can pass.


## Protected-main bootstrap verification

After a repository administrator enables branch protection on all five source
repositories, run the read-only verifier with a token that can read branch
protection metadata:

`GH_TOKEN=<admin-read-token> npm run audit:private-ci-bootstrap`

The verifier requires, for every `oreslang-source.*` repository:

- `main.protected === true`;
- at least one approving review, CODEOWNERS review, stale-review dismissal,
  admin enforcement and no user/team/app PR bypass allowances;
- strict app-bound required checks containing
  `private-ci-policy` from GitHub Actions App ID `15368`;
- the exact final CODEOWNERS block protecting CODEOWNERS, both approval files,
  required-check policy and the policy workflow itself;
- Git-blob integrity for all protected policy files;
- **empty** destination and source-snapshot approval lists during bootstrap;
- no protected-main SHA drift while the audit is running.

This audit is intentionally read-only and cannot enable protection. A GitHub
token that cannot read the protection endpoint fails closed. A passing bootstrap
audit still does not authorize a source mirror; destination + snapshot approval
must be added later through a separate protected, independently reviewed change.


## One-backend canary proposal

After the protected-main bootstrap audit passes, use the read-only proposal tool
to construct the exact policy lines for **one** backend and **one** verified
private destination:

`GH_TOKEN=<token> npm run propose:private-ci-canary -- <source-owner/repo> <private-destination-owner/repo> <source-commit>`

The command verifies source/destination privacy and immutable repository IDs,
resolves the source commit's exact root tree, and requires that commit to be
reachable from source `main`. It performs GET requests only and prints:

- the exact destination approval line: `owner/repo numeric_repository_id`;
- the exact snapshot approval line: `source_commit root_tree destination_id`.

The output is **proposal text, not authorization**. Add it only through a
separate protected CODEOWNERS-reviewed source policy PR after
`audit:private-ci-bootstrap` passes. Start with exactly one backend/snapshot;
do not grant wildcard, branch-name, moving-ref, or multi-repository approval.


## Protected carrier + incident gate

Private-source publication now requires two additional revocable conditions on every
authorization pass:

1. **Incident containment:** authenticated
   `ores-truffle-oreslang/oreslang-platform-conformance#22` must have the exact
   expected issue identity, `state=closed`, `state_reason=completed`, and a
   valid `closed_at`. Open, reopened, renamed, inaccessible or malformed state
   denies before source metadata/content inspection. Because the publisher calls
   admission before every destination mutation, reopening the incident revokes
   later writes.
2. **Carrier protection:** destination `main` must be protected with code-owner
   review, stale-review dismissal, admin enforcement, zero user/team/app bypasses,
   strict app-bound checks, and `carrier-policy` from GitHub Actions App ID
   `15368`. Protected-main CODEOWNERS must end with:
   `/.github/workflows/ @ORESoftware`,
   `/.github/CODEOWNERS @ORESoftware`, and
   `/.github/private-ci-carrier-policy.json @ORESoftware`.
   The carrier policy JSON must exactly pin the same check/app identity, and a
   main-SHA drift during admission denies.

A funded carrier is therefore not automatically authorized merely because it has
Actions minutes. Capacity, confidentiality policy, source snapshot approval and
incident completion are separate gates.

### 2026-10-17 funded source-free evidence

Private `sagitta-stack/sagitta-infra` demonstrated current hosted-runner
capacity and now has draft carrier bootstrap PR #9. Exact head
`c7c679ccb3485b56c3faa9b018a5c410ac62d3d5` passed carrier-policy run
`39059833261` on Ubuntu 24.04 with read-only token permissions, immutable
checkout and `persist-credentials:false`. The run passed the carrier trust-root
check and 12 independent source-free adversarial tests, including exhaustive
16,384 boolean authority assignments plus incident/carrier revocation between
writes.

This evidence does **not** authorize or execute a private Oreslang source mirror.
At the time of this evidence, incident #22 remained open, all Oreslang source
`main` branches remained unprotected, and Sagitta `main` itself remained
unprotected.

## 2026-10-18 UTC: bootstrap source identity and Java CODEOWNERS parity

The source-export bootstrap auditor now has two fail-closed protections added during review:

1. **Exact Java CODEOWNERS inventory.** The independent bootstrap auditor must include `/scripts/dispatch-review-pinned-private-ci.py` and `/tests/test_review_pinned_dispatcher.py` in its reviewed terminal path sequence. Both were already present in Java PR #1217's real CODEOWNERS and publisher `REQUIRED_CODEOWNER_PATHS`, but missing in this auditor's 26-entry Java inventory; that mismatch would deny otherwise valid protected-main bootstrap. The auditor now expects the same 28 paths. Regression tests reject both missing/modified owners and misordered security entries.
2. **Immutable repository identity.** Before checking branch protection or any policy file, and again immediately before success, the auditor reads GitHub repository metadata and requires the exact reviewed full name, numeric source repository ID, `private=true`, `visibility=private`, `archived=false`, and `disabled=false`. A name-only lookup is insufficient because slugs may be reassigned or repositories transferred. The independently read source IDs are Java `1400792274`, LLVM `1410897874`, .NET `1419704375`, WASM `1419858954`, and Forge `1419703674`. Negative tests reject wrong IDs, public visibility, renamed identity, archived/disabled repositories, and mid-audit privacy/identity drift. No redirect following is permitted.

**Validation scope:** Exact current Java #1217 CODEOWNERS and four companion bootstrap-policy PR CODEOWNERS snapshots were fetched separately and passed the corrected pure CODEOWNERS predicate (five out of five). Isolated JavaScript checks also rejected omission/wrong ownership of both Java dispatcher paths and six wrong-source-identity inputs. These are read-only, in-memory tests, **not** GitHub-hosted Node execution and **not** a `BOOTSTRAP_PROTECTED` result from a live admin-authenticated policy audit.

**Still blocked:** All five source `main` branches report `protected=false`; source-org Actions job allocation remains unsuccessful, both carrier security incidents #22/#77 are unresolved, and the source/destination snapshot authorization ledgers remain empty. These fail-closed restrictions must be retained until a genuinely independent reviewer and repository administrator complete the governance prerequisites. Nothing in this section authorizes source export.

## 2026-10-18 UTC: reviewed workflow-content admission

**Fixed security gap:** the previous bootstrap auditor fetched and SHA-1-validated
`.github/workflows/private-ci-policy.yml`, but did not check the file's
identity against an independently reviewed workflow. A modified workflow
could report a success under the required `private-ci-policy` check name
and GitHub Actions App ID `15368`, even if it stopped validating the policy.

The auditor now pins the exact **reviewed Git blob** for this workflow at
every source's protected `main` SHA:

| Source repository | Reviewed bootstrap-policy workflow Git blob |
|---|---|
| `oreslang-source.java` | `d4b1356249534e4dc55e9aeabfad80773016cd48` |
| `oreslang-source.llvm` | `78f7eb2aeb148598c43479bda446a258541f0483` |
| `oreslang-source.net` | `78f7eb2aeb148598c43479bda446a258541f0483` |
| `oreslang-source.wasm` | `78f7eb2aeb148598c43479bda446a258541f0483` |
| `oreslang-source.forge` | `78f7eb2aeb148598c43479bda446a258541f0483` |

These were independently read from the current draft security-policy PR heads:
Java #1217, LLVM #529, .NET #79, WASM #76, Forge #77.
Normal contents API base64 canonicalization and Git-blob SHA verification
still happen **before** the exact reviewed hash comparison. Even adding a
comment or replacing the body with a no-op `run: echo pass` fails closed.

Tests use only the two GitHub Actions **policy-workflow fixtures**, not
runtime or compiler source. They cover mutated workflows, no-op/check-name
spoofing and substitution of Java's distinct policy workflow for the
four-backend workflow (and vice versa). A legitimate policy-workflow change
requires a distinct independently reviewed update to these pinned hashes;
do not automatically adopt an unreviewed branch's workflow.

The code and test fixtures were exercised through an isolated V8 JavaScript
compatibility harness and cannot substitute for a normal `node --test` run.
Official source-organization CI still requires actual runner allocation,
protected-main enforcement, real independent review, and both incident
investigations (#22 and #77) to be resolved before private-source exports.

## 2026-10-18 UTC: whole-workflow CODEOWNERS hardening and funded source-free test

**Threat model:** pinning the `.github/workflows/private-ci-policy.yml` Git blob
is not sufficient if a second, **unreviewed** GitHub Actions workflow can create
a job named `private-ci-policy`. Both jobs can have the same GitHub Actions
App ID `15368`; branch-protection status checks ordinarily bind to context
and issuing app, not uniquely to a workflow file's reviewed bytes.

Java's canonical bootstrap PR already required a terminal
`/.github/workflows/ @ORESoftware` CODEOWNERS directory wildcard. LLVM #529,
.NET #79, WASM #76 and Forge #77 previously required only the exact
policy workflow's CODEOWNERS entry. **The four source PRs now add the wildcard
immediately before their final exact security path block.** Their identical
`private-ci-policy` workflow code has also been hardened to reject a missing
or shadowed workflow-directory wildcard.

The independent read-only bootstrap auditor in conformance PR #57 now requires
this wildcard in **all five** source repositories and re-pins the independently
reviewed workflow Git blobs. Java remains
`d4b1356249534e4dc55e9aeabfad80773016cd48`; the four other backends now
use **`c009875541d9ad5fc323aa85ef53cf7b25f6ec74`**, which intentionally
supersedes the older `78f7eb2...` snapshot quoted in the previous section.
The current exact CODEOWNERS and workflow files were independently read from
the candidate security branches: **5/5** passed the offline gate, and removing
or changing the directory owner was rejected for each backend (**10/10**
negative checks). These are not run-evidence checks.

**Funded GitHub Actions test, no private source transfer:** a separate draft
`sagitta-stack/sagitta-infra` PR #23 contains a newly written synthetic Python
policy oracle and an immutable-action-pinned workflow with read-only
permissions. It contains **no copied Oreslang compiler/runtime/actor Git tree**.
The funded runner executed [run 39092829709](https://github.com/sagitta-stack/sagitta-infra/actions/runs/39092829709),
which completed all eight job steps and **24/24** synthetic unit tests,
including workflow-directory ownership spoofing regressions. Uploaded artifact
`12123905189` has independently downloaded ZIP SHA-256
`edfa8d2e50042280448b916bfbc4c3267bbe854dd4dbecdd2bb87d151355363d`;
the contained receipt's own log SHA-256 also matched the log bytes. The
receipt correctly reports `native_compiler_executed=false`,
`native_guest_executed=false`, `private_source_transferred=false`,
`source_export_authorized=false`, and `release_ready=false`.

**Scope:** the funded model exercises the synthetic admission rules on a real
runner; it is not a run of this private conformance PR's JS code and does not
authenticate a native `.ores` fixture, private source export, or protected-main
governance. Source-org runners remain unavailable and historical source-carrier
security incidents #22 and #77 remain open. No source-copy bypass is granted.


## 2026-10-18 UTC: policy-file indirection and parser hardening

A further review found that a CODEOWNED policy pathname is not sufficient if
the checked-out path can resolve through a Git symlink. A reviewed approval or
reviewer file could otherwise remain unchanged while an unprotected symlink
target changes later. The canonical source policy workflows now fail closed
unless every security input they consume is a regular **non-symlink** file.
They also bound input size, require strict UTF-8 without BOM or NUL bytes,
reject duplicate JSON object keys, and require exact approval-line grammar
without surrounding whitespace. Boolean JSON values are not accepted as
integer schema versions.

The independently reviewed workflow blobs are now:

| Source repository | Hardened policy workflow Git blob |
|---|---|
| `oreslang-source.java` | `3ccf6597e52d427ba261573d6702f9a6bf19c07a` |
| `oreslang-source.llvm` | `1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76` |
| `oreslang-source.net` | `1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76` |
| `oreslang-source.wasm` | `1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76` |
| `oreslang-source.forge` | `1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76` |

The read-only bootstrap auditor pins these exact new blobs. A future workflow
change requires another explicit reviewed pin update; no moving branch/ref is
accepted as workflow identity.

**Funded source-free regression evidence:** private Sagitta run
`39098406458` at head `16c0adb9ad15fb343431dc609fe109bcfc4a2ba2`
completed all job steps and **102/102** synthetic security tests: 24 bootstrap
admission, 10 policy filesystem/parser attacks, 27 revocation/race cases,
18 provenance cases, and 23 checkout-tree cases. Artifact
`12125920725` downloaded with ZIP SHA-256
`5fec1cccc040bb9a45173adfe31f80f535457ddd791c11754eb9181a03ff5836`;
all receipt-recorded inner log hashes were independently rehashed and matched.

The receipt deliberately remains non-authorizing:
`private_source_transferred=false`, `source_export_authorized=false`,
`native_compiler_executed=false`, `native_guest_executed=false`, and
`release_ready=false`. This evidence validates the source-free security model
only; it is not permission to mirror private compiler source and is not native
Oreslang execution evidence.


## 2026-10-18 UTC: exact independent canary review + dual incident revocation

The final pre-copy gate is now deliberately stronger than the bootstrap shape check. A source-bearing canary cannot rely on a reviewer name merely written into policy JSON or on a status context/App ID alone.

For every authorization pass, including every revalidation immediately before a destination write, the publisher now requires:

1. Both known private-source P0 incidents are completed with exact identity. oreslang-platform-conformance#22 and #77 must each be closed with state_reason=completed. Reopening either incident revokes subsequent publication immediately.
2. Exact reviewed workflow bytes. The source .github/workflows/private-ci-policy.yml must match the independently reviewed immutable Git blob for that backend. The Sagitta carrier .github/workflows/private-ci-carrier-admission.yml must match reviewed blob 645f7f8f5ec6d907fb2a1b7ea9f93c8e28f3855a. A same-name GitHub Actions job from an altered workflow is insufficient.
3. One active canary only. Source destination/snapshot ledgers and the carrier snapshot ledger must contain exactly the one approved tuple being executed; unrelated additional grants fail closed.
4. Same active independent reviewer on both sides. Source and carrier .github/private-ci-independent-reviewer.json must be enabled, use the same non-operator login + immutable numeric user ID + minimum permission, and retain write-or-better live repository permission in both repositories.
5. Authorization files activate together. On the source, destination, snapshot and reviewer-policy files must have the same latest reachable Git commit. On the carrier, snapshot and reviewer-policy files must likewise share one latest commit.
6. Exact merged-PR approval. Each authorization commit must belong to one unambiguous merged PR targeting that repository's own main. The configured reviewer must not be the PR author and their latest review on the PR's exact final head SHA must be APPROVED. A stale-head approval or later CHANGES_REQUESTED review fails closed. A full association/review result page is treated as ambiguous rather than silently assuming there is no next page.
7. Carrier policy parity. Sagitta carrier PR #7 now contains .github/private-ci-carrier-policy.json, terminal CODEOWNERS protection for that file, strict reviewer/carrier JSON parsing, and BOM/NUL/symlink rejection. Exact carrier head ccce25a5a72c6839f44a1273a5ff7ae7576c2c11 passed funded carrier-policy run 39137987792 and source-free selftest run 39137987793.

The read-only canary proposal command now prints source destination/snapshot lines and the carrier snapshot line plus the dual-PR review protocol. It remains proposal text only and performs no writes.

### Funded source-free evidence

No private Oreslang compiler/runtime/actor source was transferred for these tests.

- Sagitta run 39137193505 passed the expanded 117-case private-CI security matrix, including the new JavaScript duplicate-key, escaped-equivalent-key, BOM/NUL, UTF-8 and exact-line parser model. Artifact 12140380989 ZIP SHA-256: f027c51a2ddd19c237392d0283e42ab7aff369d00406d4c4e4f5ab3742b3de56. Every inner receipt hash independently matched.
- Sagitta run 39138598738 passed 21/21 independent canary-review protocol tests covering both incident gates, operator-reviewer denial, live permission, exact-head approval, self-review denial, later review revocation, one-commit activation, one active canary, PR association-page ambiguity, exact base-repository identity and source/carrier workflow pins. Artifact 12141065693 ZIP SHA-256: b8d9dc2e42b1928087baf09529f4606eed2dc52d926814992d33b04347168965. Its test-log hash also independently matched the receipt.

Both receipts explicitly preserve private_source_transferred=false, source_export_authorized=false, native_compiler_executed=false, and release_ready=false. They are security-model evidence, not native compiler certification and not authority to mirror source before the live governance gates pass.
