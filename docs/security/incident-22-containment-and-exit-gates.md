# Incident #22: private-source carrier containment and exit gates

This checklist tracks **evidence**, not a claim that private source can be made secret again.
The previously public `zed-pkg-test/java-app` carrier (repository ID 1323575966)
was confirmed private on 2026-10-17. Historical disclosure is still an open incident.

## Immediate fail-closed rules

- No private compiler source trees, Git objects, blobs, logs or artifacts may be
  copied to another organization by default, including to a private repository.
- An external carrier requires separately reviewed authorization identifying the
  exact destination **owner/repo and numeric repository ID**, the exact source
  commit SHA and root-tree SHA, plus protected admission and independent approval.
- A repository's README, branch name, or cached visibility assertion is not
  proof of current privacy. Recheck via authenticated GitHub API immediately
  before any permitted publication and reject unknown/public/mismatched IDs.
- Never treat an Actions job that executed zero steps, a mock fixture, or
  source-free receipt as native compiler conformance evidence.

## Evidence ledger (administrator-owned)

| Gate | Required evidence | Status |
| --- | --- | --- |
| Current carrier privacy | Authenticated repository API visibility + numeric ID | Previously verified private; recheck |
| Other carriers | Full branch/tag/fork/public carrier inventory | Open |
| Historical Git objects | Reachable/unreachable object and PR ref assessment | Open |
| Actions exposure | Historical logs, artifacts and caches assessment | Open |
| GitHub Support | Support case and purge guidance, URL recheck, limitations | Open |
| Credentials | Secret scanning, token revocation/rotation decisions | Open |
| Access history | Organization audit logs and clone/access investigation | Open |
| Publisher guard | Fail-closed authenticated visibility/identity/provenance gate | Open |
| Negative tests | Public, unknown, ID mismatch, stale visibility, unauthorized SHA | Open |
| Independent approval | Security review and explicit authorization before exports | Open |

## Minimum negative-test cases for publisher admission

1. Destination API returns `public` -> deny before reading private source.
2. Destination API returns `404`, `403`, or timeout -> deny.
3. Destination visibility says `private` but numeric repository ID differs -> deny.
4. Source commit matches but root-tree SHA differs -> deny.
5. Destination matches but source SHA is not approved -> deny.
6. Authorization is empty or revoked -> deny.
7. Policy check is pending, failed, or lacks issuer-bound check identity -> deny.
8. Approval is stale after a new commit -> deny.
9. A job reports zero executed steps -> no certification.
10. Authorized dry-run never publishes source bytes or secrets.

## Closeout

Keep incident #22 open until administrator-led inventory, historical cleanup,
credential and audit-log assessment, fail-closed policy implementation and
independent review are all documented. Making the carrier private does not
retroactively undo exposure. See also CI bootstrap issue #69.
