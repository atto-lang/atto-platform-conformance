# Proposed UNTRUSTED network egress conformance

Issue [#87](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/87), shared semantics [common #69](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/69), Java [#1265](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1265), LLVM [#589](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/589).

The fixtures describe expected behavior for a trusted, supervisor-configured outbound network broker. They are not executable Oreslang programs and the Node test checks **fixture integrity only**. Confirmed backends remain empty until a true protected UNTRUSTED guest can issue mediated egress requests and an executed test observes the quota gate.

Proposed defaults: HTTP at most **10 in flight** plus **10 starts/s** with **burst 2**, and at most **10 connecting/open outbound TCP sockets**. HTTP starts, HTTP in-flight, TCP connection count and TCP connection-start rate are distinct counters; a policy may impose tenant-wide budgets. Keep existing untrusted ambient NETWORK capability denied by default. No raw native UNTRUSTED machine-code isolation claim is made.

## Promotion gates

1. Execute protected guest source through the trusted egress broker; reject guest-owned sockets/FFI, host objects, identity and policy mutation.
2. Demonstrate 11th HTTP in-flight and TCP open denial, separate HTTP-start burst/rate, request completion/cancel and socket failure/close releases, rollover-safe clock and shutdown races.
3. Test retries, redirects, DNS rebinding, HTTP/2 concurrency, HTTP socket pools, proxy bridges, spawn/restart lineage accounting and tenant aggregates.
4. Record exact backend commit, test command and successful execution evidence before declaring support. Host-only quota counter tests do not satisfy these gates.
