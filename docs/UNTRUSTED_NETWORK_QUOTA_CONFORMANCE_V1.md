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
