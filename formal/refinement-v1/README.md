# AttoLang actor runtime formal-model → compiled-guest refinement v1

This is an **experimental proof interface, not a proof**. It links four bounded
formal PRs (#458–#461) to three bounded trace scenarios and a candidate `.atto`
actor-group/pub-sub program. The bounded replay checker has no access to real
scheduler events or a compiler. It accepts only a *shape* of a claimed trace.
It cannot authenticate a compiler, a GitHub run, or actual guest execution.

## Run the source-only checks

```
node formal/refinement-v1/check-manifest.mjs
node --test formal/refinement-v1/replay.test.mjs formal/refinement-v1/manifest.test.mjs
```

### Contract and limitations

- `critical-generation`: two readers may coexist; a writer is exclusive; no
  suspension while holding a permit; retirement requires no permits; a restart
  increments generation and rejects permits from an older incarnation.
- `panic-control`: once an actor panics, no DATA delivery is allowed; a single
  supervisor CONTROL notification must occur. This does **not** model all
  scheduler queues, priority fairness, sibling survival, or physical isolation.
- `reliable-pubsub`: capacity-one queue, two join generations, at most two
  publisher identities; ACK only after admission, pending cancellation before
  leave, per-publisher-to-generation FIFO, stale-generation delivery denial,
  and group-close publication denial. Does **not** model carrier-blocking or
  arbitrary subscriber counts, timeouts, resource quotas or unbounded liveness.

### Compiler-backed admission plan

1. Agree on canonical `suspends` entrypoint and `ActorMail` lowering; this
   candidate adapts the earlier `P03-topic-string.atto`, whose `pub async routine`
   syntax conflicts with the newer `suspends` rule. Its `expectedStdout` is
   speculative until a real compiler executes it.
2. On each of Java/GraalVM, LLVM, .NET NativeAOT, Wasm and Forge/Cranelift,
   compile the **identical source blob** and execute it. Attach exact source
   head and root tree, compiler/runtime digest, emitted artifact digest, exit
   codes, stdout, and fully attributed GitHub run/job/attempt/step metadata.
3. Instrument actual actor runtime events and replay the three model traces.
   The trace must be correlated to authenticated compiled-guest receipt data;
   a self-reported `stepsExecuted` is not authentication. Verify real negative
   diagnostics, scheduler quiescence, cancellation and sibling survival.
4. Use the existing `lib/guest-aot-evidence-v1.mjs` structural validator and
   authenticated GitHub provider read-back. They are **separate gates**: neither
   this replay checker nor the structural validator may certify a guest alone.
5. Keep all five backends `NOT_EXECUTED` until authentic nonzero-step evidence
   exists. Zero-step failures imply **runner admission**, not failing guest tests.

### Blocking dependencies

- The source organization's GitHub Actions failure annotation points to an
  account payment or spending-limit admission condition (issue #315). An
  authorized billing owner must repair it and prove a source-free canary ran.
- Authoritative branch protection and independent review must be confirmed.
- Private code must not be mirrored to another organization without separate
  governance approval, exact source/tree allowlist, and approved destination.
- The `.atto` candidate does not cover all scenarios. Further scheduler and
  generation-negative `.atto` programs, parser support, and instrumented
  runtime APIs are still required for five-backend parity.

**No merges or parity promotions based on these model/shape tests.**

### Hardened trace protocol and non-proof boundary (2026-11-07)

- `critical-generation`: a task must actually acquire a permit before
  `stale_permit_denied` can witness old-generation revocation. Suspensions
  require matching `resume` events; retirement with suspended tasks or
  outstanding critical permits is rejected.
- `reliable-pubsub`: every `publish_pending` or `publish_admit` must match
  an earlier `publish_request` for that publisher, sequence and subscription
  generation. Sequence numbers must be contiguous and the bounded model has
  at most two publishers, two sequences per publisher/generation and capacity
  one. ACK remains distinct from delivery.
- On leave/close, admitted queued data must be delivered or accounted for
  with a `discard_queued` event immediately followed by its declared
  `leave` or `close_group` operation. Silent loss is rejected.
- Each scenario requires a nonvacuous transition witness. The manifest pins
  exact PR number/head associations, authenticated-evidence obligations,
  backend non-execution statuses, and limitations against proof promotion.
- These are deliberately **bounded design-trace witness profiles**. A trace
  can be manufactured, and shape acceptance is not real scheduler execution,
  independent provenance verification, physical actor isolation or parity.
  Runtime adapters must emit these events from compiler-backed guest work,
  not derive them from model predictions or expected stdout.
