# Bounded supervisor DATA admission/fence model v1

**Classification: BOUNDED_MODEL_ONLY.** This is not an actual AttoLang program, a Java source compile, or a production proof. Companion Java runtime admission patch: [Java #2785](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2785).

The finite explorer enumerates every interleaving of **three distinct send attempts to one actor A** and one healthy unrelated sibling B, with the following independent actions: DATA ticket grant/rejection, ticket commit/abort, supervisor crash/fence, CONTROL acknowledgment, separate physical-release evidence, and generation-2 restart.

**Linearization rule:** issuing a generation-valid DATA ticket is atomic under the same owner ledger monitor that records ancestor failure and fences A. A ticket issued before failure may commit *physically* after the fence and remains a **pre-fence** logical admission. New tickets issued after failure must be rejected. In-flight tickets must be accounted until settled; ACK is separate from physical-release evidence; restart requires ACK, zero outstanding permits and a physical-release receipt. Sibling B remains independent.

The exact GitHub-fetched JavaScript source (`5b1f73e8dca7f05d1dd795c41857519b08bb1d94`) was executed in an isolated V8 authoring environment on 2026-11-10:

- **2,400 reachable states**, **6,706 transitions**, **18 action labels**.
- Witnesses: pre-fence ticket completing after supervisor crash; failed supervisor retaining in-flight tickets; attempted post-fence grant rejected; healthy sibling progress; restart only following escrow ACK, ticket drain and separate physical-release marker.
- Deliberate mutation detection: **5/5 malformed states** rejected (post-fence ticket, disappearing in-flight reservation, early restart, fabricated physical release, accidentally fencing unrelated sibling).

The repository's separate Actions workflow is extended to verify the **exact Git blob** and run this model next to the earlier supervisor-crash v1/v2 models. A **stepful** Actions pass remains required for hosted evidence; previous workflows have failed before job steps.

**Explicit limitations:** finite three-sender/one-sibling state space, abstract logical admission counters and assumed atomic ledger operations. There is no actual mail transport, scheduler, cancellation executor, mailbox processing fairness, nested child registration, real terminal-wal journal, native physical-loan provenance, TLC run, compiled AttoLang guest, or five-backend conformance. This model **does not prove that no already-admitted message can be physically enqueued or processed after supervisor failure**. It proves only that a logically new ticket cannot be granted after failure within its finite model. Only exact-head Java and guest execution can validate the implementation's refinement.

Run locally: `node formal/supervisor-data-admission-v1/check.mjs`. Keep conformance draft, no source-main changes or unapproved private-source mirroring.
