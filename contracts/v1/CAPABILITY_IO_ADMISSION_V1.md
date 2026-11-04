# Capability-bound nonblocking I/O admission — portable v1

**Status:** proposed portable safety contract. The accompanying Node implementation is a **SOURCE-FREE HOST REFERENCE ORACLE**, not an Oreslang compiler implementation, OS sandbox, native actor guest, trusted network broker, or evidence of five-backend parity. All backends are **PENDING**.

## Scope and relationship to existing contracts

This bridges `docs/EXECUTABLE_PERMISSIONS_V1.md`, `contracts/async-io-v1.json`, `contracts/untrusted-supervisor-outbound-admission-v1.json`, and `contracts/v1/NIO_ACTOR_EXECUTION_V1.md`.

**Contract conflict identified:** the existing async-I/O JSON's `legacySuffixesForbidden` entry includes `_blocking` and `_async`, which contradicts the normative common-source `docs/NATIVE_IO_NAMING.md`. A source-visible `*_blocking` operation is permitted **only** when lowered to implicit continuation suspension on the same verified nonblocking provider; bare legacy synchronous names are forbidden, and `*_async` is allowed. Reconcile that JSON and its users before promoting backend conformance.

## Required backend behavior

1. A trusted host/OS policy, signed/protected artifact ceiling, runtime request, actor/isolate policy, and delegated child policy MUST each authorize the exact operation; an explicit deny at any layer prevails. A trusted matcher cannot mint authority and any revocation caused by a reentrant callback MUST be rechecked before committing admission. No effects annotation, guest-supplied identity, mutable sidecar, cached actor token, hot reload, or FFI import grants authority. Untrusted actors MUST NOT access `std/unsafe`, native FFI, raw syscalls, or unmediated sockets. Hostile tenants run in a per-tenant VM-isolate inside a shared OS process (see [tenant isolation v2](../../docs/TENANT_ISOLATION_V2_SHARED_PROCESS.md)); a process or OS sandbox is optional defense in depth, not a requirement.
2. A trusted host adapter MUST authenticate actor/incarnation and lineage, never treating an actor ID supplied by the guest as proof. Authorization and incarnation/generation MUST be checked at dispatch. Delegation is monotonic and parent revocation cascades. Admission and revocation MUST be atomic in native implementations, not merely serialized by one Node event loop.
3. Network origin/resource authorization and authorization of the actual bound destination MUST both succeed, including across every relevant ancestor's policy, before admission; a hostname grant is not permission to connect to an arbitrary IP. An admitted ticket MUST authorize at most one host dispatch. Transport categories MUST be consistent with resource permissions: the strict initial reference supports only network transports for `net` and `file` transport for `read`/`write`; unsupported combinations reject before admission. For filesystem reads/writes, the authorized requested path and actual bound destination path MUST both pass checks, in addition to descriptor-relative TOCTOU protection in the native adapter. A socket/descriptor MUST bind to the *actual* authorized resource identity, not just a source string or hostname. DNS resolution, redirects, proxy routes, TLS SNI/authority and socket addresses MUST be checked consistently against the destination eventually used. A redirect, retry, address change or descriptor substitution requires new authorization. A hostname check alone cannot prevent DNS-rebinding or TOCTOU.
4. Admission and buffering MUST be bounded at actor, supervisor, tenant and process scopes as appropriate. Overload rejects before transport initiation. HTTP in-flight requests, request-start rate tokens, TCP connections, byte/buffer ownership, physical execution carriers and mailbox credits are distinct ledgers. Atomic multi-scope admission prevents partial consumption; published rate/start tokens MUST NOT be refunded on delayed cancellation.
5. A shared multiplexed reactor MAY wait for kernel readiness, but MUST NOT execute guest code or hide blocking I/O in workers. Completion MUST enqueue onto the owning scheduler with incarnation fencing and reserved CONTROL capacity. `*_blocking` means logical continuation suspension, never one parked host thread per guest operation.
6. Global host shutdown and cancellation/revocation deny new admission and dispatch. Shutdown MUST mark active operations cancel-requested but MUST NOT retire resource credits. The host must continue bounded physical cleanup until all owned resources are quiescent. Cancellation and revocation deny new dispatch. Logical Future settlement is not physical socket/buffer/worker retirement. Only trusted host observation of transport/descriptor quiescence releases those credits. Failed close retains ownership and bounded retry/cleanup capacity. Exactly one terminal outcome is delivered; duplicates and stale completions cannot resume replacement actors.
7. Host admission/binding/retirement entry points MUST remain inaccessible to guest code. A host-only reference object, WeakMap, or test-supplied `hostQuiesced=true` is NOT a native retirement proof. Native runtimes MUST obtain physical-retirement evidence from the trusted adapter itself, rather than expose such a flag to guests.

## Reference model scope and limitations

`src/capability-io-admission.mjs` implements an intentionally small, single-threaded host reference: five-layer immutable authority snapshot, opaque actor/target/ticket objects, bounded admission, single-use dispatch, separate network origin/destination authorization, immutable actor-specific policy snapshots attenuated by every ancestor, reentrant-revocation rejection, global shutdown with bounded active-ticket inventory, cancellation, parent-child revocation and physical-credit retirement. `tests/capability-io-admission.test.mjs` runs 19 targeted negative/positive tests and all 24 permutations of four lifecycle events.

The included reference tests are only meaningful together with the repository's existing permission-manifest evaluator. This oracle does NOT implement DNS, real I/O, target normalization, OS-level sandboxing, portable actor message isolation, an actual kernel reactor, tenant-level quota, rate limits, true multi-threaded concurrency, or guest-to-broker mediation. Trusted host-side bind/retire interfaces are not safe to expose to guest code. Run `npm test` to validate reference behavior only.

## Promotion requirements

For **each** of Java/GraalVM, LLVM, .NET NativeAOT, WASM and Forge:

- Pin source commit/tree and built compiler/runtime binary digests; run positive and negative **Oreslang guest source** fixtures at exact head.
- Exercise protected guest actor identity, delegation, revocation, per-tenant admission, real permission-denied and permitted host I/O, retries, redirects/DNS-rebinding, backpressure and close/cancellation races.
- Verify physical retirement of real sockets/handles and execution-carrier progress with one carrier; prove no guest callback executes on reactor threads.
- Execute target-specific boundary/isolation and sanitizer tests where applicable; unsupported providers must reject before host I/O.
- Require real executed CI job steps and artifact provenance. An unadmitted or zero-step Actions run is **NOT_EXECUTED**, not native evidence.
- Preserve the existing private-source cross-organization transfer allowlist; no testing carrier receives private source without explicit destination authorization and per-blob verification.

**Promotion status:** Java = PENDING; LLVM = PENDING; .NET = PENDING; WASM = PENDING; Forge = PENDING.

## 2026-10-29 backend implementation staging

Five draft backend PRs have host-reference or fail-closed changes, **not source-to-host guest I/O parity**:

- Java/GraalVM [#2284](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2284): synchronized package-private host lifecycle model, shutdown, JUnit, identity and replay tests.
- LLVM [#1182](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1182): C++17 host lifecycle with 16-thread dispatch race, shutdown and sanitizer workflow.
- .NET [#255](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/255): internal managed host lifecycle, shutdown and test-assembly-only access.
- WASM [#184](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/184): zero-authority compiler admission with one immutable options snapshot; no guest host imports.
- Forge [#142](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/142): matching C++17 lifecycle reference and race/sanitizer tests.

**Promotion remains blocked** on actual I/O-broker integration, native/guest execution evidence, trusted permission and address binding, physical OS-resource retirement, authenticated actor lineage, and authorized executed CI. The local source-free Node oracle can validate the safety algebra but cannot certify these other requirements.

## 2026-10-29 targeted backend transport corrections

- **Java direct TCP:** `NativeIo.connect` now requires both the requested hostname endpoint and selected numeric IP endpoint to pass NET permission checks, resolves once, and supplies `InetSocketAddress(InetAddress, port)` to physical connect. The TCP connection's subsequent read/write paths recheck both identities. Deterministic no-network JUnit tests cover numeric denial, explicit denies, disallowed remote identities and IPv6. **Important:** this path still uses blocking DNS/socket/read/write and is NOT certified as actor-safe nonblocking I/O. Existing direct `NativeIo.httpText` still uses JDK `HttpClient.send` and needs separate pinned/nonblocking transport review.
- **Forge pinned TCP:** the trusted host adapter no longer clears `O_NONBLOCK` on the returned file descriptor, and the existing native loopback test now asserts the flag. Its synchronous `poll` wait during connect remains a transport-integration limitation; this is not evidence of nonparking actor I/O.
- **LLVM/.NET/Java/Forge:** host lifecycle shutdown fences future dispatch and retains physical credits; C++ LLVM/Forge tests include 16 competing threads racing one ticket. WASM remains zero host imports with immutable, descriptor-derived option snapshots.

All source PRs remain draft. These fixes do not bypass the existing private-source carrier security hold and do not authorize guest source execution from another organization.
