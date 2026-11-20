# AttoLang source-free carrier admission

This qualifies **runner capacity only**. It never authorizes copying private Atto source or marks a compiler guest as passed.

## Source-free canary

Before copying any private tree, use a private, independently authorized destination repository. A reviewed workflow at an immutable Git blob should have only a minimal shell proof step named ADMISSION_PROOF, no checkout, no private source inputs, no network data fetch, no untrusted PR execution, and read-only contents permissions.

Record the destination's immutable repository ID, exact canary commit SHA and workflow Git blob SHA. Use the **byte-exact template** at `templates/source-free-canary.yml`: canonical Git blob `b1c012f58064be58475b04fce2404d996b3768c7`. The checker rejects any different YAML bytes, even if its job/step names look correct. Use the checker to interrogate the carrier's GitHub REST API:

~~~bash
GH_TOKEN=<carrier-scoped-read-only-token> \
node tools/check-carrier-admission.mjs \
  OWNER/CARRIER_REPO DESTINATION_REPO_ID CANARY_RUN_ID \
  CANARY_COMMIT_SHA .github/workflows/source-free-canary.yml \
  REVIEWED_WORKFLOW_BLOB_SHA SOURCE_FREE_JOB_NAME ADMISSION_PROOF
~~~

The command must supply the canonical source-free workflow Git blob SHA and the `source-free-check` job. Do not commit a token or copy credentials across organizations. This checker only reads the carrier's repository/run/jobs/approved-workflow metadata. The command is illustrative, not an observed successful canary.

Admission requires exact destination name and immutable ID, repository not archived, completed successful workflow run on exact head and approved workflow blob, fresh run created no more than one hour previously, successful job from the same run and attempt, assigned runner, chronological start/end, positive completed steps, and the named ADMISSION_PROOF step completed successfully. It rejects a checkout step in the reported canary steps. A success is classified as SOURCE_FREE_CAPACITY_ONLY_NOT_COMPILER_PARITY and expires; it does not guarantee future budget capacity.

**Security limitation:** The reviewed workflow blob must be independently inspected to establish that it is genuinely source-free. Step names and a self-reported manifest cannot establish that. An untrusted workflow author can choose misleading step names. Independent security review and GitHub organization controls remain mandatory.

## Private-source transfer requires separate authorization

A passing capacity probe is necessary but insufficient for export. Before invoking the existing mirror integrity verifier or transferring any private source:

1. Confirm the carrier is PRIVATE, authorized to hold the specific tree, access-restricted, and has cleanup/retention controls. Success in a public carrier is not permission to publish private code.
2. Independently approve the source PR exact commit and resolve its Git tree SHA, exhaustive recursive blob inventory, file types, modes, symlinks and binary contents, destination immutable repo ID and branch, reviewers and protections. Abort the transfer if the full-tree scan detects secrets or privileged assets; omitting blobs changes the Git tree and must not be presented as an exact-tree mirror.
3. Transfer via the GitHub connector without using the destination GITHUB_TOKEN to checkout the private source. Compare the resulting tree, every Git blob SHA and every file mode to the independently obtained source identities.
4. Run the reviewed guest workflow using only carrier-local Actions credentials. Never transfer source secrets, privileged workflow tokens, unrelated history or integration configuration.
5. Require actual compiled guest execution and evidence (exact source/tree, nonzero CI steps, artifacts/hashes, positive and negative case results) before marking a compiler passed.

The existing mirror verifier checks destination worktree identity against a manifest and externally supplied tree SHA; it does NOT independently authenticate the manifest's asserted source commit or the review/transfer authorization. Successful mirror verification is not authorization to export.

## Verified observations, 2026-11-20

Nine private atto-ci carriers were rechecked. Their newest sampled workflows all failed before job steps, so none qualifies on currently observed execution evidence. Two public security-boundary-test repos have older successful jobs, but they are not valid destinations for private source, and their old success cannot substitute for a fresh, private canary.

The integrated carrier checker and exact-byte YAML validator ran **60 local Node tests** with no failures, including public-carrier rejection, 1-hour freshness enforcement, bad or missing runner evidence, altered workflow rejection, and verification that the published YAML exactly matches the audited bytes. The tested file and committed PR blob SHA-1 values match exactly. This is a host-only capacity admission gate, not a compiler guest execution or successful live carrier qualification.


## Exact-byte canonical canary update (2026-11-20)

The approved *source-free test shape* is the checked-in `templates/source-free-canary.yml`, whose full UTF-8 bytes are pinned by `tools/canonical-carrier-workflow.mjs` and whose Git blob SHA is `b1c012f58064be58475b04fce2404d996b3768c7`. The live checker now verifies GitHub Contents API file type, path, canonical base64 payload and reconstructed Git object SHA, not merely the reported job step names. It also rejects a public destination repository or a run whose repository is public. These checks are **not** an independent security approval or proof of currently usable runner minutes.

If any **full-tree** source blob is sensitive or unauthorized for the destination, stop rather than silently omit it: an omitted file would change the root tree SHA and invalidate the asserted exact-source provenance. Never use a public repository as a destination for private-source compilation.
