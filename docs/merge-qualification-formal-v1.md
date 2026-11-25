# Merge qualification — source-free finite-state model v1

The TLA+ module \`specs/merge-qualification-v1.tla\` models an immutable PR
head, current-head approval, review invalidation, exact-head CI, positive
executed-step count, protection/no-bypass configuration, and a merge event.

## Safety invariants
- A merge cannot occur with no independently submitted **current-head** review
  in the model. This abstraction treats an approved review as independent;
  production evidence must independently confirm reviewer identity,
  code-owner membership, and dismissal semantics.
- A merge cannot occur after head changes without new head-matched approval and
  executed CI, even if CI/approval for the previous head was green.
- An explicitly zero-step failed run or a **forged zero-step success** cannot
  qualify a merge.
- A merge cannot occur while branch protection or no-bypass is disabled.
- A subsequent request for changes or review dismissal invalidates eligibility.

## Model-checking instructions

When a verified TLA+/TLC toolchain is available:

    java -cp tla2tools.jar tlc2.TLC -config specs/merge-qualification-v1.cfg specs/merge-qualification-v1.tla

Capture the TLC version and jar digest, exact source blob/tree and PR head, the
invocation, state count, and process exit code as an independently reviewable
receipt. Until that executes, **TLC MODEL CHECK: NOT_EXECUTED**. The Node
security tests separately enumerate 1,024 boolean policy combinations; they
are bounded property tests, not a TLC proof.

## Abstraction limits

This model cannot prove that data in a JSON file came from GitHub, that the
real GitHub branch has enforced protection, that approvals are independent,
that CI actually executed, or that AttoLang guests ran on any backend.
Production merge qualification must bind GitHub API snapshots, run attempts,
checkout tree/hash receipts, status contexts, code-owner authorization and
artifact checksums before server-side enforced merge.
