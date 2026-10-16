# Synthetic-only private cross-organization Git publication test

**Result: PASS — actual GitHub Git API object/ref publication.**
**Scope: intentionally synthetic nonconfidential content ONLY.**
**NOT a test of the full private-source publisher or permission to export
Oreslang sources.**

## Repositories and permissions

- Synthetic origin `akrion-sim/akrion-sim-e2e`, private GitHub repo ID
  `1321164328`, writable and not archived.
- Synthetic destination `voxletra/voxletra-e2e`, private GitHub repo ID
  `1311678027`, writable and not archived.
- Both destinations were checked using the GitHub repository API before
  mutating any objects. Different GitHub organizations were involved.
- No source repository from `ores-truffle-oreslang` was copied or read.
  No source secrets, private compiler source, GitHub Actions tokens, CI
  checkout, artifacts, or production branches were transferred or altered.

## Positive object-copy and identity verification

1. Created two literals in origin **as synthetic test content only**:
   `pkg/demo.ores` (`100644`) and `scripts/run.sh` (`100755`).
   The source Git object/blob SHAs were
   `2ad730eae5de6dbc9827d31e8480adeed276b16f` and
   `3397c4f09d67eef68a97de6f1071a9596e2dcade`.
2. Constructed source Git tree
   `040a8e7f8fc3af210c5dd9f030b41257c2c4bd18`
   in the origin and fetched its *complete* recursive tree.
3. Read **only these two synthetic blobs** through the authenticated origin
   GitHub API, created corresponding blobs in the destination, and verified
   both destination blob SHAs exactly matched source SHAs.
4. Created isolated synthetic-only destination base tree
   `49bc7e1c3a87e13336208533a90e64356abd4f23`, containing
   **only** `SYNTHETIC-ONLY.txt`. It has no CI workflow and no original
   repository source. GitHub confirmed this full base inventory.
5. Constructed destination materialized tree
   `7d534f0cc3b484c1ca23e530ac41d5e105886769`,
   with synthetic source content under `snapshots/synthetic-only/`.
   GitHub's recursive-tree readback confirmed the nested subtree SHA
   **exactly equals** the source tree:
   `040a8e7f8fc3af210c5dd9f030b41257c2c4bd18`.
   Both file modes and blob identities were preserved.
6. Created and read back:
   - Origin unreferenced synthetic source commit
     `3fab53074031a2b04e44cdec062df7aa905e81c7`
   - Destination baseline commit
     `223314c1e2498f30ee38d45397bb0f6fe2e9a848`
   - Destination synthetic snapshot commit
     `5c60b9b50a00e5414643758d4f77df42e83beb38`.
   Each GitHub commit readback returned the expected Git tree SHA.
7. Published **only** a new destination isolated test branch
   `ci/private-synthetic-mirror-e2e-20261016-040a8e7f`, pointing to
   commit `5c60b9b50a00e5414643758d4f77df42e83beb38`.
   Then fetched the branch ref/commit/tree using GitHub REST and verified
   the exact branch name, commit SHA, source subtree SHA and complete
   expected three-file inventory.

Verified branch URL:
https://github.com/voxletra/voxletra-e2e/tree/ci/private-synthetic-mirror-e2e-20261016-040a8e7f

## Negative Git-tree tampering test

An extra *synthetic* `UNEXPECTED.txt` file was injected into a separate
unpublished Git tree object:

- Unpublished tampered destination tree:
  `463e4c25ea801d943baa7b7824ec5c226688ffec`
- Resulting nested subtree SHA:
  `52628655b9fcb0bc9468d4e331098b27ed254086`
- Pinned source nested subtree SHA:
  `040a8e7f8fc3af210c5dd9f030b41257c2c4bd18`

**SHA mismatch detected**. No commit or ref was published for the tampered
tree. Some unreachable synthetic Git objects will exist until GitHub garbage
collection; this is expected when testing Git object creation.

## Limitations and follow-up

- The GitHub connector ran the real low-level GitHub API operations,
  **not** `bin/private-mirror-publish.mjs` itself. Its latest offline
  mocked-API publisher/visibility security suite was separately **46/46
  passing**; it still needs a safe end-to-end test through the exact script.
- Branch cleanup: the isolated **synthetic-only** destination branch remains
  until removed by an authorized repository maintainer via GitHub's branch
  controls. The current connected GitHub tools do not expose deletion of a
  ref; **cleanup was not falsely claimed**. Do not merge this branch.
- Source-export incident
  [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
  and policy approval
  [#962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962)
  remain open. This test supplies **no authorization** to transfer any
  actual Oreslang source into Voxletra or other organizations.
- Full JDK 25/GraalVM, LLVM, .NET, Wasm and Forge current-head compiler
  conformance remains unverified by this synthetic publication test.
