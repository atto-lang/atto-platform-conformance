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
