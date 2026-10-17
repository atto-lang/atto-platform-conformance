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
