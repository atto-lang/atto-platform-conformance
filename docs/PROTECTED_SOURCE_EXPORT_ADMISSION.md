# Protected-main private-source export gate (draft)

**Release state:** source export remains BLOCKED. All five Oreslang backend `main` branches currently report `protected=false`. There is no reviewed source snapshot approval in protected main. Do not use private Actions minutes or a private destination as substitute consent.

The older `bin/private-mirror-publish.mjs` admitted a write when its caller supplied the destination name in `ORES_APPROVED_PRIVATE_MIRRORS` and both repositories were private. That was not sufficient proof of independently reviewed source confidentiality authorization.

This draft changes the **real publisher's** `requirePrivateMirror()` admission, called before source reads and before every destination Git-object/ref write:

1. Require a pinned 40-hex source **commit and root tree**, and a source repository name among the five immutable Oreslang repository IDs.
2. Query both source and destination identities and require private/active status and exact numeric IDs (the destination ID must match independently reviewed policy).
3. Query `source:main` and require actual `protected=true`; query enforced review settings and require independent approving review, code-owner review, stale approval dismissal, admin enforcement and no listed bypass actors. If the GitHub App cannot access protection details, **deny**.
4. Read destination and snapshot approval files from the exact pinned protected-main commit, not from a PR checkout or local environment. Require exact destination name + numeric ID, and exact source commit + root tree + destination ID.
5. Resolve the source commit from the original repository and verify it identifies the pinned root tree. Re-read protected-main ref before success; drift denies admission. Repeat the check before **each** destination write, including the final ref.
6. Reject missing or malformed metadata, policies, timestamps, credentials, revisions or GitHub errors, without emitting token-bearing raw API messages.

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
