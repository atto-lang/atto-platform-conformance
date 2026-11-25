# Bounded causal actor-hop trace and storage-layout contract (draft v1)

Tracks [platform conformance issue #92](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/92); complements the Java async trace work (#193), diagnostic renderer (#1313), and call-site fidelity follow-up (#1666). This repository includes an **executable reference model only**. Its green Node tests are *not* evidence that Java, LLVM, WASM or other Oreslang compiler/runtime backends implement this contract.

## User-visible semantics

An error created by an actor that received a message through a causal chain MUST preserve its original guest failure site, cause/suppressed failures, and the most recent five causally visited actors (or all prior visits if fewer than five), subject to explicitly indicated security redaction. The normal profile retains **16 actor visits by default**, with a configurable capacity between **5 and 64**. If a chain visits 10 actors under the default, all 10 are shown. Actor revisits count as separate visits.

The causal actor-hop trace is **not** a synchronous function stack and must not be presented as one. Machine-readable actor entries use oldest-to-newest order; a human renderer may show newest first if it labels the order. Error unwind/rethrow does not append pretend reverse-direction visits. A hop is stamped at a trusted message receive/forward/spawn/RPC/supervisor boundary with the exact source location if known; missing source locations stay null, not guessed. At fan-out/join, an error follows the selected failing branch, with separate parent-link metadata if needed; it is not a fictional total ordering of unrelated branches.

The actor-hop budget is **independent** of the async event budget, so 100,000 interleaved awaits/tail-awaits cannot evict the last five actor visits. Captured task/message ancestry survives suspension/resumption, scheduler carrier migration, error propagation, hot reload and supervisor reporting. The originating failure site stays outside this bounded actor-hop history.

A causal context is logically **owned by a particular message/continuation**, never one shared mutable field on the actor or a physical thread. Fan-out forks immutable contexts. Remote hops may carry a versioned, validated and bounded subset under trust policy; no raw handles, private capabilities, payloads or authentication secrets cross this boundary. Redacted entries may preserve position and count without exposing private names or source locations. If incoming metadata is absent or unverifiable, mark the gap instead of synthesizing historical hops. Runtime attachment is trusted; arbitrary guest message fields must not be accepted as authority for tracing.

## One authoritative physical layout per trace pool

| Layout | Target use | Access pattern and tradeoff |
|---|---|---|
| AoS | Default small bounded per-message ring and frozen failure snapshots | Fast entire-hop reads; one bounded record per visit |
| SoA | Large actor/task/trace pools and diagnostics exporters | Column-wise scans; extra per-column updates if chosen for a small ring |
| AoSoA | Batching/telemetry drains and vectorizable metadata scans | Blocked field locality; benchmark tile size before production |
| ECS-style generational index | Optional observability, scheduler or supervisor metadata lookup | Handle-to-immutable-trace reference with stale-handle rejection; **not** an actor-global mutable causal trace |

There is no requirement to maintain three synchronized versions. Explicit conversion is allowed at safe ownership/snapshot boundaries, not by silently publishing mutable cross-actor aliases. Runtime-owned pools may use the chosen physical layout; the canonical diagnostic schema does not depend on it. Embedded/freestanding profiles need compile-time bounded no-heap storage or explicit opt-in allocator, and should fail closed if fewer than five reserved actor entries would be available while claiming conformance.

## Reference model and schema

`lib/actor-hop-trace.mjs` contains independently chosen AoS, SoA or AoSoA fixed-capacity rings, immutable fork semantics, explicit layout conversion, source-field redaction, and an **optional** ECS-like generation-checked index. These are model operations; they are not wired into guest code, Truffle continuation frames, LLVM error unwinding, networking or supervisor CONTROL.

`snapshotActorHops(trace)` returns one logical `oreslang.actor-hops.v1` object:

```json
{
  "schema": "oreslang.actor-hops.v1",
  "ordering": "oldest_to_newest",
  "total_visits": 10,
  "retained": 10,
  "omitted_prior": 0,
  "truncated": false,
  "entries": ["10 structured, safe actor visit objects here"]
}
```

This is an **additive proposed subrecord**, not a silent replacement of the existing Java `oreslang.error.v1` envelope, `guest_stack` or `async_traces`. Production implementers must coordinate the versioned cross-backend schema and preserve failure type/identity, source maps and redaction policy. Store only bounded runtime-produced display fields; do not send a mutable actor-owned allocation outside its authorized trust domain.

## Evidence and acceptance gates

1. Node reference tests: chain lengths 1, 4, 5, 6, 10, 16, 17, 64 and 100 across all three layouts, configurable budget bounds, exact newest five, explicit truncation, cycles/repeats, fork isolation, conversion parity, redaction, unsafe-field rejection, stale ECS handles.
2. Java/GraalVM execution: 5–10 actor send/forward/reply chains with real source locations; original exception and correct causal branch under pending and already-ready await, carrier migration, cancellation, `throw`/`raise`/`panic`, and supervisor CONTROL. Assert logical text and structured JSON separately.
3. LLVM execution: same compiled `.ores` programs and golden normalized diagnostics; explicitly mark UNIMPLEMENTED/UNSUPPORTED until actual native execution.
4. Differential stress: 100,000 interleaved ordinary async events, 100+ actor visits and fan-out/retry cycles; assert newest five survives, no actor-global cross-request contamination, bounded memory retention, honest truncation and redaction.
5. Benchmark AoS, SoA and AoSoA on ingress latency, allocations/message, cache locality, failure snapshot construction, and telemetry batch throughput. Select layout on evidence, not assumption; ECS indexing must not be compulsory for plain Oreslang code.
6. Require exact source SHA/tree and executed CI logs. A reference-model green result or zero-step workflow failure is not backend conformance evidence. Do not mirror private source into an unapproved public repository.

Run the reference checks with `node --test tests/actor-hop-trace.test.mjs` or `npm test` in the repository. No external packages are required.

## October 20 hardening audit and verification scope

The reference model now rejects copied/shape-forged trace contexts using module-private identity admission (WeakSet). Optional ECS index handles use index-local issued-handle identity (WeakMap) in addition to slot generations: a guessed or JSON-recreated {slot, generation} record cannot resolve a trace. These are **process-local model safeguards**, not cross-machine authentication.

AoSoA is implemented as arrays of per-block **field columns** rather than arrays of AoS rows. Each update copies the modified block's field columns and structurally shares the other immutable blocks. Unrelated message/continuation forks retain their own snapshot. Guest-supplied error-message fields are not permitted to overwrite runtime-only trace provenance.

Structured source identifiers must be canonical relative logical names, never raw filesystem paths, URLs, query strings or credentials. The reference accepts only controlled display metadata; a production integration still needs compiler-resolved source identities, trust policy, explicit remote envelope validation and reliable invocation source spans.

Tests in `tests/actor-hop-hardening.test.mjs` exercise context/handle forgery, blocked-column AoSoA, invalid source identifiers and accessor properties, randomized capacity-block dimensions, redaction and 100,000 sequential actor visits. This last stress case measures actor-visit **retention**, not 100,000 interleaved real async await boundaries; actual compiler/runtime tests are still required.

**CI evidence policy:** a workflow run marked `failure` with `steps:null` / zero executed steps is runner/provisioning **non-evidence**, not a failing Node assertion or proof of Actions-minute exhaustion. Do not mirror a private repository into a public destination; private cross-org transfer requires an approved private target, maintained provenance, validated runner allocation and explicit authorization for that source. Tests executed outside GitHub must be labeled local rather than exact-head CI.

## Local exact-tree, no-mirror verification path (October 20)

While GitHub Actions private runner allocation is unavailable, run the committed tests **inside a local authorized clone of this original private repository**. The required arguments are the exact PR head commit and root tree from authenticated GitHub metadata; the verifier refuses a mismatched or dirty checkout and validates the byte-for-byte Git blob identity/mode of all six source/test files before running Node >=22.

At time of this change, for head `7cc607758ac100576949dcddaf030deaaa8e49bc` and root tree `f9085a9fd2555ba4c24ccbb38cd779df0e043b41`:

```sh
# Execute only in an already-authorized clone of the source repository.
git fetch origin feat/actor-hop-trace-layout-reference-20261020
git checkout --detach 7cc607758ac100576949dcddaf030deaaa8e49bc
bash scripts/verify-actor-hop-exact-tree.sh 7cc607758ac100576949dcddaf030deaaa8e49bc f9085a9fd2555ba4c24ccbb38cd779df0e043b41
```

The example SHAs are **version-specific**: refresh both independently after *any* additional PR commit. Do not treat merely producing the `MODEL_ONLY_PASS` marker as signed third-party CI attestation; retain the executed terminal log and environment provenance, and use a source-local runner-backed receipt for release approval. This is backend-neutral reference-model testing only, not native Java/LLVM guest conformance or Java/LLVM ownership proof.

A verification of a **synthetic local test repository** exercised a matching set of reference-model cases and verified that wrong SHA and dirty tree are rejected. That synthetic verification is not evidence that exact private PR content was executed. The exact `scripts/verify-actor-hop-exact-tree.sh` bytes were independently checked by Git SHA on the GitHub branch against the locally exercised verifier.

The private source was **not mirrored** cross-organization. Protected source-transfer policy and open incidents #22/#69/#77/#127 remain gating; use the original private repository's checkout for any genuine source-specific validation.
