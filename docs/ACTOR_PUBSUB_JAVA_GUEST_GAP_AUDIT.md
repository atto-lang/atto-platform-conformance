# Java guest pub-sub gap audit — 2026-11-02

Status: source inspection only; no guest execution or parity certification.

## Existing Java PR #2440 assets

- `contracts/v1/fixtures/actor-pubsub-v1.ores` exercises `actor.group("payments")`, `group.topic<String>("payment.completed")`, `topic.subscribe()`, `await topic.publish("p-1")`, and a subscriber actor. `SourceActorPubSubExecutionTest` expects `subscribed|p-1`.
- `actor-pubsub-multigroup-v1.ores` has an authored guest assertion `ready-b|b-still-live`.
- `SourceActorPubSubExecutionTest` also authors negative guest cases for topic payload mismatch, actor-defined topic authority, private actor subscribe, mailbox and async capability crossing, and direct/nested callable payloads.
- `scripts/verify-actor-pubsub-v1.sh` pins a 40-hex head SHA, checks raw physical bytes, runs selected Maven tests and rejects missing/zero/skipped Surefire reports.
- None of the above proves that the exact PR head executed successfully in Actions.

## Differences that block reusing the existing Java fixture as portable v1

1. Java source fixture uses `await topic.publish` with a `"reliable"` policy; portable core requires explicit nonblocking atomic `try_publish`, no silent wait or partial fanout.
2. The fixture does not assert sequence-bearing admission receipts, zero-recipient sequence behavior, or atomic rollback on a full recipient.
3. The fixture does not demonstrate minted `GroupMembership` authority tied to actor incarnation on publication. An actor-name or group-name lookup is not a publisher capability.
4. The fixture exercises a single group in its basic case; multi-group overlap must assert duplicate deliveries per distinct subscription edge, not merely that leaving one group preserves the other.
5. Existing source is `.ores`; all *new* portable fixtures should use `.atto`. Legacy fixtures remain regression inputs during migration.
6. Java guest `Topic.subscribe()` is presently limited to shared actors; document the portability implications and do not silently weaken ownership checks.

## Minimal next implementation batch

A. Add a parser/type-checker admitted `actor_pubsub_basic.atto` that uses a scoped topic and a real authenticated actor-turn publisher grant; ensure no host caller can forge a grant.

B. Add `try_publish` receipt fields `sequence` and `recipient_count`; assert accepted sequence 1, and accepted zero-recipient sequence 2 after unsubscribe.

C. Add negative `.atto` fixtures for wrong-group grant, stale leave/rejoin grant, non-Sendable nested payload, and a full-recipient atomic rejection. Verify rejected publishes allocate no sequence.

D. Execute `SourceActorPubSubExecutionTest` plus new fixture assertions on the exact PR head and capture stepful logs, test counts, fixture hashes, and the native-image build/run receipt separately.

Do not label Java as portable-v1 complete until these gates pass. Do not replace the Java guest execution test with a host-only Java unit test.

## 2026-11-03 source facade topic identity audit

Java draft #2440 now validates topic names as exact, untrimmed 1-128 byte ASCII identifiers in both definition and lookup paths (Java commits d8f25438 and 05c00cf8). An isolated Java 21 method-level check accepted/rejected 19/19 sampled inputs. The committed JUnit test, compiled guest, and Native Image have not executed in stepful CI, so this is not guest certification.

.NET #327/#344 still validates names using its 256-byte UTF-8 host namespace. Do not silently claim Java/.NET topic identity parity: the public portable core names and extension namespaces must be versioned or normalized by an explicit adapter. Existing Java guest fixtures still use asynchronous publish without portable sequence receipts or authenticated group-membership capabilities.
