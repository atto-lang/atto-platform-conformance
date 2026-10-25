# Administrator procedure: zero-step GitHub Actions jobs

Source-org conformance [PR #161](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/161)
and LLVM [PR #918](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/918)
fail before runners execute steps. No real compiler test result or proof of
minutes exhaustion can be inferred from these failures.

On an authorized, private checkout of conformance PR #161, provide a
narrowly scoped READ-ONLY GitHub credential using the trusted shell's
normal secret mechanism (GH_TOKEN or GITHUB_TOKEN) and run:

    node bin/diagnose-prestep-admission.mjs \
      ores-truffle-oreslang/oreslang-platform-conformance 40137182173

    node bin/diagnose-prestep-admission.mjs \
      ores-truffle-oreslang/oreslang-source.llvm 40128572866

The script only reads the selected GitHub run, enumerates jobs from its
latest attempt and requests each check-run's annotation metadata. It checks
run and job identity, omits raw annotation text, and gives only provisional
billing, Actions-policy or runner-capacity categories. A missing permission
is reported explicitly as unavailable. Exit 1 means observed zero-step
failure, 2 means invalid/unavailable mandatory data. The output's
rootCauseConfirmed and privateSourceTransferAuthorized remain false.

Authorized organization administrators must independently inspect the
Actions run's warning banner and annotations, current billing/spending
limits, repository Actions policy and runner group eligibility. Do not
modify billing/policy blindly or send credentials across organizations.

Restore a GitHub-hosted or approved same-boundary runner first. An
alternate funded organization's successful source-free canary is runner
capacity evidence only, not a grant to copy confidential source. Security
incident #22 and bootstrap issue #69 still govern protected-source
transfers: no private source mirror without independent approval tied to
a PRIVATE destination numeric repo ID and the exact source commit/tree.

After authorization and actual job execution:
1. Run complete conformance npm test at the updated exact PR head.
2. Verify LLVM PR #918 commit
   f9e4dad86532509833400cc476abfbad2985a9c2, root tree
   3a7839550b3696bc65796a405e03b305227aacad.
3. Build real LLVM compiler out of tree with CMake Release, BUILD_TESTING=ON,
   LLVM development packages and Cargo available; run full CTest.
4. Execute the signed-i64 native corpus using the SHA-pinned real compiler,
   Clang, resource directory, and exact fixture manifest: 12 accepted and
   14 rejected cases.
5. Preserve binary/source receipts and independent review before claiming
   compiler parity or merging.

This document and the diagnostic script do not authorize source export.


## Source-free exact mirror-verifier regression

An audit confirmed that Git \`status\` can execute custom clean-filter commands
configured in the checkout (including shell commands) even if status reports
no changes. The previous \`bin/verify-private-mirror.mjs\` invoked
\`git status\` during pre-execution verification.

The new verifier does **not invoke Git status**. It compares the exact pinned
HEAD subtree against stage-0 Git index modes, paths and blob SHA-1 identities;
checks ignored and untracked files through non-filter-executing \`git ls-files\`;
denies hidden index flags, symlinks, gitlinks and file-mode drift; and checks
raw bytes using \`git hash-object --no-filters\`. It does not execute a
configured repository clean filter.

\`tests/private-mirror-git-nonexecution.test.mjs\` contains ten source-free
real-Git tests covering the actual malicious-filter command repro, filtered
source modification, staged index tampering, ignored/untracked files,
symlinks, hidden filemode changes, permissible executable files, hidden
index flags and mismatched tree pins. The checked-in implementation and
new test have exact byte-identical Git blob hashes to the locally
executed copies (10 pass / 0 fail, Node.js 22.16.0 / Git 2.47.3).

This is defense-in-depth **inside an already authorized private CI
execution environment**, not authorization to transfer private Oreslang
source to a different organization. The persistent security incident and
protected-main source/destination-identity approvals remain mandatory.
