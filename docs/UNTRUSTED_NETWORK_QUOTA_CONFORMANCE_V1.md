# Proposed UNTRUSTED network egress conformance

Issue [#87](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/87), shared semantics [common #69](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/69), Java [#1265](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1265), LLVM [#589](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/589).

The fixtures describe expected behavior for a trusted, supervisor-configured outbound network broker. They are not executable Oreslang programs and the Node test checks **fixture integrity only**. Confirmed backends remain empty until a true protected UNTRUSTED guest can issue mediated egress requests and an executed test observes the quota gate.

Proposed defaults: HTTP at most **10 in flight** plus **10 starts/s** with **burst 2**, and at most **10 connecting/open outbound TCP sockets**. HTTP starts, HTTP in-flight, TCP connection count and TCP connection-start rate are distinct counters; a policy may impose tenant-wide budgets. Keep existing untrusted ambient NETWORK capability denied by default. No raw native UNTRUSTED machine-code isolation claim is made.

## Promotion gates

1. Execute protected guest source through the trusted egress broker; reject guest-owned sockets/FFI, host objects, identity and policy mutation.
2. Demonstrate 11th HTTP in-flight and TCP open denial, separate HTTP-start burst/rate, request completion/cancel and socket failure/close releases, rollover-safe clock and shutdown races.
3. Test retries, redirects, DNS rebinding, HTTP/2 concurrency, HTTP socket pools, proxy bridges, spawn/restart lineage accounting and tenant aggregates.
4. Record exact backend commit, test command and successful execution evidence before declaring support. Host-only quota counter tests do not satisfy these gates.

## Security-audit correction: no delayed token refund

The pre-dispatch reserve/abort interface originally returned rate tokens to the current token bucket. That let a caller hold reservations across refill epochs and cancel later to create a burst beyond the configured maximum. **Now a reservation published to the trusted broker permanently spends its HTTP/TCP start token, whether or not dispatch succeeds.** Cancellation, timeout and close only return the in-flight HTTP or connecting/open TCP credit. A partial child/supervisor/tenant reservation rejected *inside the host admission lock before publication* may reverse its provisional tokens. The helper name `rollbackUnpublished` (native `rollback_unpublished`) is deliberately limited to this use.

Revoking/closing a policy denies *new pre-dispatch commits*, but an already committed host I/O operation still needs explicit cancel-and-drain or physical socket close. Native gates enforce scope/lifetime teardown assertions; they do **not** replace a broker shutdown fence. Java pre-constructs quota admission envelopes before consuming tokens to avoid stranding quotas on allocation failure. None of these changes grants untrusted NETWORK capability or constitutes demonstrated guest-to-broker enforcement. CI executions and sanitizer evidence remain pending.

## 2026-10-17 hardening: atomic scope revocation and direct egress denial

A pre-dispatch **three-scope** lease now checks child, supervisor and tenant revocation status while holding the same trusted gate lock as supervisor Scope.close, before any scope commits. The previous sequential commit could partially mutate child/supervisor leases and throw (Java) or abort the native process (LLVM) when a later scope had already been revoked. Deterministic all-three-role rejection and Java/native concurrent revoke-vs-commit regressions were added.

The real Java NativeIo outbound HTTP and raw TCP call sites also now explicitly reject a direct UNTRUSTED actor turn through TrustedNetworkIngressGuard. The four guarded entry points are HTTP request submission, TCP connect, TCP read and TCP write; ordinary socket close remains available for cleanup. This is defense in depth and **does not create a protected guest->broker network path**. The real actor-turn JUnit case is added but not executed by the source-only carrier; the carrier verifies exact source hash and performs a host-only simulated identity check. Protected isolate and host-network cancellation semantics remain pending.

## October 18, 2026 cross-backend audit and release gates

The trusted-only host quota prototypes now have source-exact loopback validation of
asynchronous Java HTTP and TCP operations. The Java TCP adapter reserves capacity
before opening a channel; completed, cancelled or failed dials must close the OS
channel before releasing the active socket slot. Host TCP handle tracking is
retained if an OS close failure leaves the Socket open. The Java HTTP adapter
isolates caller-future cancellation from host transport cancellation and tracks
its own outstanding exchanges. All HTTP/TCP test helpers are HOST-ONLY; they do
**not** grant network access to UNTRUSTED actors or establish protected isolation.

The shared contract now has **28** adversarial cases and the conformance registry
has **22**. All backend conformance remains **pending**: compiling and executing
host helper tests is not the same as executing an authenticated guest request.

**Blocking requirements before promotion:**

- The runtime must authenticate actual actor identity and durable child/supervisor/
  tenant lineage at the trusted bridge. No guest-provided sender, quota scope,
  timestamp or permission decision can be authoritative.
- Egress authorization must pin the resolved destination/address before DNS,
  redirects, proxy dispatch and connect, and reject private/metadata SSRF
  escalation across all transports and HTTP/2 multiplexing.
- Supervisor revocation and cancellation must close real host sockets, drain
  active I/O and prevent credit reuse before underlying transport termination.
  A terminated Java CompletableFuture alone is not proof of OS socket closure.
- Native LLVM UNTRUSTED execution must retain default-deny until a real
  containment boundary exists; in-process private arenas are not a sandbox.
- Run the actual protected guest and full original runtime tests; source-org
  Actions currently fail before jobs execute. Keep every associated PR draft
  until both CI and the appropriate protected tests pass.

## October 18 — actor-bound broker prototype and outstanding proof

Java now has an experimental static actor-turn ingress backed by trusted-only
registration, exact runtime actor identity, at most 16 unconsumed result
tickets and no guest-facing Java network callbacks. It can currently target
only a supervisor-selected literal loopback endpoint. A private-carrier
simulated-identity harness and real localhost HTTP/TCP operations have passed,
but the authored full `spawnUntrusted` runtime integration test has not run.
The shared threat contract has **31** proposed vectors, while the network
conformance registry has **25**, with every protected backend still pending.

The Java prototype does not enable Oreslang guest NETWORK or provide
production SSRF-safe arbitrary egress. Java/Graal and LLVM protected guest
execution, host transport quiescence, stable actor lineage, supervisor mailbox
quota admission and original source CI remain hard blockers before merge.


## October 18: termination revocation and bounded cleanup contract

Four additional security scenarios remain **unverified** until exercised
against real, protected runtime actor turns, not a test-only identity shim.
An already-cached broker binding must refuse tickets after automatic actor
termination, a queued host dispatch must not escape after revocation, and
termination cleanup must have reserved, finite capacity and bounded failure
handling. A successful future cancellation is not proof that the OS transport
has terminated.

Java source PR #1266 has the source-level synchronized revocation and
capacity-reserved host cleanup prototype. Private carrier Actions
[#39199747989](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/39199747989)
passed an exact-blob 25-file HOST-ONLY mirror with simulated actor callbacks.
Real `ActorRuntime.spawnUntrusted`, Graal isolate containment, protected LLVM,
real transport quiescence, and supervisor mailbox quotas are **still pending**.
