# Pub-sub guest vertical slice: executable gate (2026-11-02)

Status: **SPECIFICATION ONLY / NOT_EXECUTED**. This file is not an AttoLang guest fixture and grants no backend parity.

## Contract selection

The portable v1 core is `contracts/v1/actor-pubsub/portable-v1.json`. Implementations must use authenticated, group-scoped topic identity (broker, group, topic name, payload type), not the legacy broker-global example. No new publisher/subscriber keywords. `try_publish` is a nonblocking, atomic all-recipient admission attempt; successful admission allocates one nonwrapping per-topic u64 sequence even with zero recipients. Failure allocates no sequence and enqueues nothing. A receipt describes admission, not handler completion.

The core never silently drops or replaces deliveries. .NET RELIABLE/LATEST/LOSSY and Java async backpressure must be explicitly versioned extensions; LATEST/LOSSY must not be accepted as portable `try_publish` behavior. Duplicate join/subscribe is idempotent, but separate group subscription edges deliver separately. Unsubscribe fences admission and new handler starts, cancels queued deliveries, and waits for in-flight attempts before `get_done`. Channel close has distinct drain semantics.

## Minimum first guest fixture

Create `tests/guest/actor_pubsub_basic.atto` **only after** the compiler accepts the actual authenticated source API. Do not copy the illustrative legacy broker-global source from the design document.

1. Create one broker, one group, a publisher and a subscriber actor; join both actors with real actor-context authority.
2. Create a group-scoped `Topic<Event>`; subscribe the member actor with capacity 1.
3. Publish shared `Event(id: 42)`; assert receipt `sequence=1`, `recipient_count=1`.
4. Assert the subscriber receives exactly one `PubSubDelivery<Event>` with sequence 1 and id 42.
5. Unsubscribe, await quiescence, publish again; assert receipt `sequence=2`, `recipient_count=0`, no new handler start.
6. Verify a departed/stale membership grant cannot publish and cannot consume a sequence.
7. Exit nonzero on any assertion failure; enforce a bounded timeout to prevent a hung actor from passing.

## Shared oracle and expansion

Preserve all PS001–PS026 expected results exactly. PS001–PS020 are legacy broker-global reference vectors; PS021–PS026 cover authenticated group-scoped authority and lifecycle. First gate PS002, PS003, PS005, PS008, PS009, PS011, PS021 and PS023. Preserve each vector ID, input hash, expected receipt/delivery/diagnostic, and actual trace. Run the full corpus after the vertical slice.

## Backend acceptance (all mandatory)

- Java: parser/type checker + real guest actor execution + GraalVM Native Image.
- LLVM: guest lowering + independent compiled native execution + sanitizer/lifetime coverage.
- .NET: guest lowering + strict NativeAOT guest executable, not #344 host receipt tests.
- Wasm: guest compilation + worker/runtime delivery and lifecycle assertions.
- Cranelift: independent compiler guest execution, not a Wasmtime substitute or tokenizer-only rejection.

Each evidence record: backend, source commit SHA, compiler commit SHA, exact fixture SHA-256, contract JSON SHA-256, target triple, compiler invocation, native artifact SHA-256 (where applicable), job/run ID, nonzero executed step count, exit code, assertion totals, diagnostics, runtime event trace and log links. Zero-step Actions and host-only tests remain NOT_EXECUTED.

## Evidence parser trust boundary

`src/actor-pubsub-evidence-v1.mjs` validates the structure of self-reported backend entries, **not** GitHub Actions authenticity or that a guest artifact actually ran. A 40-character SHA string, plausible GitHub Actions URL, and nonzero integer step count can all be fabricated. Consequently `verified` remains zero and `parity_certified` / `release_ready` remain false even when all five records claim `PASS`; `candidate_records` counts only syntactically complete candidate entries. The synthetic five-PASS regression enforces this fail-closed behavior.

A separate independent verifier must first corroborate run ID/attempt/job steps through the provider, head/tree and fixture content hashes, actual compiler invocation, guest trace and native artifact hash, negative diagnostics and target ABI, then add an authenticated promotion protocol **before changing** this non-certifying contract. No manual JSON flag change is sufficient.

## Merge gate

Do not merge a backend as portable-v1 complete while guest lowering, authenticated actor authority, cancellation semantics, or exact-head stepful receipts are absent. Run read-only runner admission checks before retrying compiler jobs; alternate private runners require approved cross-org transfer and verified exact source-tree hashes.

## 2026-11-03 implementation and execution ledger (not parity)

- Java draft #2440 has a two-subscriber guest **legacy async RELIABLE** fixture `contracts/v1/fixtures/actor-pubsub-legacy-fanout-two.atto`, with expected output `ready|ready|event-42|event-42`. A 30-second-bounded Graal Polyglot JUnit test is authored; neither that JUnit method nor Native Image has executed at the checked source head. This fixture does **not** claim portable `try_publish`.
- The Java exact-head verifier now fails closed unless Surefire XML shows the new two-subscriber guest test, the explicit fail-closed unlowered `try_publish` test, the legacy constructor/unsigned receipt test, zero-subscriber sequence, and RELIABLE rejected-publication continuity. Its XML acceptance logic passed independent source-free positive, missing-test, and skipped-test synthetic checks; not the committed Java tests. The workflow's upload-artifact action is pinned to official `ea165f8d65b6e75b540449e92b4886f43607fa02` (v4.6.2).
- LLVM #1296 now stages topic-local u64 sequence numbers in the C++ host admission result. The authored native tests require RELIABLE no-gap retry, LATEST replacement, LOSSY drop accounting and zero-subscriber monotonicity. **The native C ABI receipt layout remains unchanged**, so there is still no compiler-guest sequence receipt path or ABI-v2 parity.
- The JS reference oracle now checks the whole shared payload graph before freezing any object. Failed `share()` on a late unsafe sibling or cycle no longer freezes earlier caller-owned objects. All 26 reference vectors passed in a local V8 harness with the Node-specific Proxy detector stubbed; committed `node --test` and native code remain unexecuted in source-org Actions.
- The private alternate organization's **source-free** run [41589530112](https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41589530112) at commit `e37ffaf41c6c9ef9d13f8bc458602f09e42b192f` completed successfully (job `125762795007`, six steps). Independent logs confirmed `PUBSUB_SOURCEFREE_ADMISSION_OK`, `PUBSUB_SYNTHETIC_JAVA_OK`, `PUBSUB_SYNTHETIC_CPP_OK` and `PUBSUB_SYNTHETIC_PROXY_OK`. It did not check out or receive any private AttoLang source.
- Java, LLVM and conformance source-org exact-head jobs continue to fail with **zero executed steps**. The remaining minutes/billing cause is not established, and the source-transfer hold tracked in conformance #22/#77/#127/#315 remains in force. No evidence ledger record can be promoted.
