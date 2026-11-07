# ActorGroup join/leave — exact-head guest evidence preflight

This is a **source-free, read-only structural preflight**, not a certificate or
GitHub attestation. It does not execute any AttoLang guest program and must not
authorize cross-organization private source export.

## Canonical behavioral assertions

The 12 `AG001`–`AG012` cases in
`src/actor-group-exact-head-evidence.mjs` cover:

- one actor joining two groups; leaving A does not modify B;
- group cooperation never transfers supervisor/lifecycle or actor stop rights;
- rotated join tokens rejected, including an idempotent rejoin attempt;
- cross-runtime/isolate, stale actor generation and forged-ID rejection;
- concurrent join/close/stop ordering and no membership resurrection;
- idempotent admission without extra quota use;
- opaque capability rejection in ordinary actor DATA mailboxes;
- actor-self-only join and manager-only join-token issue/rotation;
- closing a group does not stop actors whose only relation is membership.

Keep control-lane invitations for independent actors **unsupported** until
they have an authenticated, incarnation-bound, one-time protocol. This
preflight neither implements nor legitimizes `ActorRef.send(permit)`.

## Minimal gate

1. Obtain the **actual exact PR head SHA** independently, not from the
   candidate's self-reported receipt. Check backend name and source repo.
2. On an approved, source-authorized runner, compile and execute a real
   source-language guest fixture on that head, asserting the 12 outcomes.
   Host-only C++/Java/C#/JS tests, parser-only tests and negative no-IR
   admission tests are separately useful, but cannot replace this step.
3. Capture immutable workflow run ID, job ID, exact head, tree SHA, artifact
   SHA-256, UTC timestamps, and **actual step entries** for compilation,
   guest execution, and assertions. A failed job with zero steps is
   `NOT_EXECUTED`, not proof of a compiler/runtime failure.
4. Run `node --test tests/actor-group-exact-head-evidence.test.mjs` and
   `assessActorGroupEvidence(...)` against the candidate receipt. The
   highest result is `EVIDENCE_CANDIDATE`, **never** `VERIFIED`.
5. Independently retrieve GitHub run/job/logs and artifacts on the approved
   security boundary; check receipt values, exact blob/tree provenance,
   completed guest assertions, repository identity and runtime traces.
   Only that separate verification can justify a guest-backed parity claim.

A 48-hour freshness bound is applied to caller-supplied timestamps for the
preflight; a new PR commit invalidates previous exact-head evidence regardless
of age. Store results separately by backend and full PR head SHA.

## Current known gaps to re-evaluate on new heads

- [Java source ActorGroup PR #674](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/674):
  typed guest lowering proposed, draft; its PR-head workflow results require
  stepful rerun before claiming guest execution.
- [Java snapshot PR #2419](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2419):
  tests are host-side JUnit, not sufficient evidence of guest source execution.
- [LLVM source negative contract PR #206](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/206):
  negative no-IR contract, not successful group execution.
- [LLVM host pg PR #1243](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1243):
  native host tests and snapshots, not LLVM guest ActorGroup lowering.
- [Scoped invitation design issue #689](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/689):
  independent guest-actor invitations require separate design and proof.

Forge/Cranelift are not automatically the same implementation, even when a
five-backend contract selects Forge as its fifth target.
