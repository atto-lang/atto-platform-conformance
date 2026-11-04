# AttoXP M0 — native UI ABI security and evidence baseline

**Status:** proposed contract/reference validator, not a functioning native framework. **Language:** AttoLang `.atto`. **Initial targets:** LLVM AOT iOS arm64 + Android arm64. The AttoXP GitHub organization is not currently verified as provisioned/access-granted; this contract can be staged in the existing platform-conformance repository pending creation.

## Audit: current design gaps that must fail closed

1. **No proven guest-to-native bridge.** A diagram connecting LLVM to UIKit/Jetpack Compose is not compiler output, JNI glue, Swift binding generation, native rendering, or a signed application. Never claim those exist from an ABI schema or host tests.
2. **Unsafe cross-thread access.** Native view mutation must run on the platform main UI thread. Actors may generate immutable UI intents but cannot use native widget pointers or directly mutate views. Main-thread scheduling must not block the carrier, and callbacks must not call back into guest code synchronously while an actor holds `critical`.
3. **Use-after-free / ABA.** Every opaque handle binds to `(app/session, scene, slot, generation, owner)`. Generation increments on disposal and recreation, with wraparound handling. Native callbacks/events carry and verify the generation. Tear-down invalidates pending transactions, subscriptions, and events before releasing host references.
4. **Partial UI mutations.** Validate the entire transaction before application: sequence numbers, scene identity, permissions, node IDs, ancestry acyclicity, sizes, UTF-8, ownership, and all handle references. Reject an invalid transaction without partially applying it. Adapter failures during commit must roll back where possible or close/quarantine the scene; do not claim fully atomic host rendering unless implemented.
5. **Unbounded resource use.** Quota node count, max tree depth, transactions, byte sizes, pending events, callback registry size, animations, retained native references, and outstanding platform operations; bound arithmetic before allocations. Backpressure should drop or coalesce only explicitly lossy event categories; reliable events require bounded cancellation/timeout and explicit overflow behavior.
6. **Authority confusion.** OS permission, application entitlement, and actor-scoped runtime capability are distinct. Validate on each native call and after foreground/background transitions. Never use an opaque camera/location handle as durable proof of permission.
7. **FFI object lifetime.** Swift/Kotlin/JNI wrappers own retain/release policies, app lifecycle is explicit, JNI local/global refs are correctly scoped, strings/buffers copied or pinned with bounded lifetime. No raw unmanaged pointer enters a `Channel<T>` or actor group.
8. **App distribution.** iOS release bundles compiled application features; development hot reload is separate and not enabled by default in release. No private iOS APIs, runtime code injection, or downloaded feature-changing executable code.
9. **Rendering parity illusion.** Native controls vary; accessibility tree, keyboard/IME, dynamic type, RTL/localization, reduced motion, and system appearance need platform-specific acceptance, not pixel snapshots alone.
10. **Security and provenance.** Host tests and model validators establish only host behavior. Exact tree/source/fixture digests, compiler binary and source provenance, nonzero CI steps, native binary hash, simulator/device runtime receipts, security negative tests and independent review are needed before promoting a target.

## M0 native ABI rules (binding-neutral)

- Stable C-compatible boundary and numeric error/status codes. No unwinding/panics/exceptions across ABI; copy/validate all untrusted payloads. Major mismatch fails closed; minor capabilities are negotiated explicitly.
- `UiHandle` is an opaque id, not a pointer; bind app, scene, generation and ownership; stale handles and cross-scene references reject without dereference. No executable closure/function transfer through events, channels or pub-sub.
- `SubmitTransaction(scene, expectedRevision, operations)` accepts a bounded serialized command buffer. Validate entire buffer including lengths/overflow, index references and duplicate IDs before running on platform UI queue. Ordering per scene is monotonic; reject revisions that go backward.
- A dedicated UI dispatcher owns platform view instances. Actor state is immutable from renderer perspective; host event dispatch is asynchronous, copy-only, and uses bounded queues. Lifecycle `mounted → background/foreground → destroyed` invalidates tokens on destruction.
- Camera, notifications, biometrics, storage and location remain separate capability modules, not generic unrestricted native invocation.

## Promotion gates and truth table

| Stage | What it can prove | Additional required evidence |
| --- | --- | --- |
| `reference-model` | Host contract verifier/model runs | Exact head/tree/fixture, nonzero executed steps; **not AttoLang guest** |
| `abi-link` | Real host library linked against ABI | Native link artifact, ABI call/link evidence |
| `atto-guest` | Compiler-produced `.atto` guest ran | Compiler binary/source digests, guest execution and output receipts |
| `simulator` | iOS Simulator or Android Emulator run | Platform runtime logs and simulator identifier |
| `physical-device` | Real device run | Real device receipt and independent hardware provenance review |

The receipt checker performs strict **shape/policy validation only**. It cannot attest to GitHub identities, device authenticity, code-signing validity or compiler-source correspondence. No stage receives production/promotion certification just because this checker says structurally valid. Treat zero-step CI as `NOT_EXECUTED`, not PASS. Do not cross-org mirror private source without independently approved destination, visibility and protection gate.

## Initial implementation order

1. Ratify contract and native handle/event ownership with independent security review; publish exact ABI structs and error codes.
2. Implement a small C ABI handle table with generation/scene fencing and allocation limits; ASan/UBSan/TSan host negative tests, fuzz invalid transaction buffers and lifecycle races.
3. Implement Swift/UIKit and Kotlin/Android Views adapters: explicit main-thread dispatcher, bounded asynchronous events, correct memory/JNI lifetimes; native unit/instrumented tests.
4. Wire LLVM `.atto` compiler output to ABI without guest reflection/JIT and prove real guest counter app on iOS Simulator + Android Emulator, including cancellation/navigation and camera permission deny/revoke.
5. Reproduce on physical devices with signing, startup/memory/frame-time/accessibility tests; only then claim viable native AttoXP mobile support.

## Core acceptance tests

- Stale/reused `UiHandle`, cross-scene/event replay, nested batch/overflow and duplicate component IDs rejected.
- View writes from worker threads reject; `critical` handlers never synchronously reenter via callbacks; carrier is not blocked by main queue.
- Scene destruction races pending events, animation completion and asynchronous native permission prompts; all rejected or cancelled safely.
- JNI references and Swift-managed wrappers survive repeated mount/unmount under sanitizers with no leaks or UAF.
- Permission denial/revocation, lifecycle resume, device rotation, accessibility screen reader, dynamic type, text composition/IME, Unicode/RTL, and reduced motion are tested on each platform.
- Compiler execution and device evidence must be separate from host model evidence, with five-state statuses and exact SHA receipts.

## References

- Apple UIKit main-thread rule: https://developer.apple.com/documentation/uikit
- Apple App Review section 2.5.2: https://developer.apple.com/app-store/review/guidelines/
- Existing receipt framework: `contracts/platform-capabilities-v1.json` in platform-conformance.
