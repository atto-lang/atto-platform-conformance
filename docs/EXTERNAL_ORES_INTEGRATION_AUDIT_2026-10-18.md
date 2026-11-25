# ORES external integration audit and 100-issue campaign

Snapshot: 2026-10-18. This is a **coordination-only** issue and contract-boundary inventory, not a dependency resolution, CI pass, security attestation, or proof of operational compatibility.

## Upstream release gates

- [ORESoftware/api-docs #326](https://github.com/ORESoftware/api-docs/issues/326): no production-ready Oreslang route/RPC integration without compiler-backed actual v1/v2 wire execution, canonical contract hash, and malformed-frame tests.
- [ORESoftware/typespec-json-schema-validator #230](https://github.com/ORESoftware/typespec-json-schema-validator/issues/230): the expired TypeSpec compiler advisory exception is a consumer-admission blocker; do not bypass the production dependency audit.
- `ORESoftware/ores-*` packages require exact upstream revisions / zed-pkg integrity, separate authored TypeSpec and JSON Schema, current source-bound receipts, qualified declaration closure, and negative differential fixtures.
- Never export private source to a public CI carrier or count a workflow that ran zero steps as a passing test.

## Audit observations (source-reviewed, not runtime-tested)

- Chat and OTel already use immutable TJSV GitHub Actions and product-facing schema workflows. A generic schema canary alone is not product admission; avoid replacing stronger existing acceptance with it.
- Redis LRU interfaces has an existing exact SHA TJSV receipt, Contract IR verification, explicit declaration inventory and negative admission cases.
- Pin divergence was observed across the currently reviewed consumer workflows; audit and upgrade each reviewed source revision individually. Different SHAs alone do not prove a vulnerability.
- The Oreslang conformance registry covers 52 internal repositories and expressly records `not-attested` evidence. This separate inventory avoids falsely importing cross-org proof.

## Scope of 100 existing open issues

Selected: **100 distinct issues** in **6 ores-* GitHub organizations** and **44 repositories**. Existing issue states were confirmed by GitHub open-issue search at inventory time; later state changes require a new search.

| # | Priority | Wave | Category | Open issue |
|---:|:---:|---:|---|---|
| 1 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.java#994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994) — Security: protect source main with mandatory CODEOWNER review before private CI mirroring |
| 2 | P0 | 1 | security-admission | [ores-truffle-oreslang/.github#6](https://github.com/ores-truffle-oreslang/.github/issues/6) — Introduce reusable private-safe contract and formal-proof workflows across Oreslang |
| 3 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.llvm#477](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/477) — LLVM parity: private abstract superclass-only method slots and actor explicit Self receiver |
| 4 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.js#2](https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/2) — Restore allocated private CI runners for JS backend PR #1 and conformance #71 |
| 5 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-platform-conformance#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) — P0: enable protected-main private-CI bootstrap and restore source-org runners |
| 6 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-platform-conformance#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) — P0 SECURITY: audit repeated private Oreslang source carriers in Scintilla |
| 7 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.java#1105](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1105) — Implement generic private abstract override type-substitution parity |
| 8 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-platform-conformance#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) — P0 SECURITY: private Oreslang source mirrored into public GitHub Actions carrier |
| 9 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.java#1208](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1208) — Implement review-pinned private-CI dispatcher bound to canonical PR #1217 |
| 10 | P0 | 1 | security-admission | [ores-truffle-oreslang/.github#2](https://github.com/ores-truffle-oreslang/.github/issues/2) — Security gate: protect five Oreslang source branches and restore executable Actions evidence |
| 11 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.java#962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962) — security(ci): bind private mirror publisher to protected source provenance and reviewed numeric destination ID |
| 12 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-common-source#69](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/69) — Security contract v1: trusted supervisor-bound outbound quota admission for UNTRUSTED actors |
| 13 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-platform-conformance#87](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/87) — Adversarial conformance: supervisor quota bypass, restart fanout and runtime-only failure notifications |
| 14 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.llvm#628](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/628) — NativeSupervisorCodeSlot owner binding must enforce authority on pin/activate |
| 15 | P0 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.java#1267](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1267) — security(callables): project lexical lambda environments to actual captures, never retain implicit self |
| 16 | P0 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-common-source#58](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/58) — CI parity gate: certify exact-head execution across all five oreslang-source backends |
| 17 | P0 | 1 | contract-parity | [ores-truffle-oreslang/oreslang-source.java#1349](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1349) — Integrate sealed actor-state reader/writer loans with logical RW gate and multithread safety |
| 18 | P0 | 1 | contract-parity | [ores-truffle-oreslang/oreslang-platform-conformance#82](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/82) — Program: integrate all 52 Oreslang repositories with versioned contracts and executable evidence |
| 19 | P0 | 1 | contract-parity | [ores-truffle-oreslang/oreslang-source.java#1309](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1309) — P0 audit: sound static-class and module contract conformance across compiler, linker and runtime |
| 20 | P0 | 1 | rpc-transport | [ores-truffle-oreslang/oreslang-source.llvm#175](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/175) — feat(native parity): supervisor actor CONTROL lowering, hot upgrades and proxy transport |
| 21 | P0 | 1 | contract-parity | [ores-truffle-oreslang/oreslang-source.java#589](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/589) — ci: unblock current-head Java Maven/GraalVM and LLVM CMake/CTest without public mirrors |
| 22 | P1 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-platform-conformance#99](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/99) — Admit real Java/Graal ↔ JS runtime results for pinned semantic fixture subset |
| 23 | P1 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-source.js#15](https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/15) — Parity gate: decide checked vs wrapping i64 arithmetic across Graal, JS, LLVM and Wasm |
| 24 | P1 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-source.java#1078](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1078) — Five-backend parity program: conformance, actors, routing and CI evidence |
| 25 | P1 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-source.java#1269](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1269) — Reconcile enum declaration AST and tagged runtime before executable case overloads |
| 26 | P1 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-source.js#7](https://github.com/ores-truffle-oreslang/oreslang-source.js/issues/7) — Complete JS semantic parity: module state/linking, typed pattern decision trees, and class multiple inheritance |
| 27 | P1 | 1 | verification-ci | [ores-truffle-oreslang/oreslang-source.llvm#442](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/442) — Native parity: sealed Sendable ownership vs format-specific Serializable and actor DATA/CONTROL |
| 28 | P1 | 1 | security-admission | [ores-truffle-oreslang/oreslang-source.llvm#607](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/607) — Implement authenticated native AOT image loading and LLVM ORC JIT generation retirement |
| 29 | P1 | 1 | contract-parity | [ores-truffle-oreslang/oreslang-source.java#1337](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1337) — Implement nontrailing T? optional parameters with Option<T> and safe constructors |
| 30 | P1 | 1 | contract-parity | [ores-truffle-oreslang/oreslang-ml#6](https://github.com/ores-truffle-oreslang/oreslang-ml/issues/6) — Implement ModelGraph-backed ml.trainer with versioned actor forward/backward scheduling |
| 31 | P0 | 2 | contract-parity | [ores-chat/ores-chat-clients#24](https://github.com/ores-chat/ores-chat-clients/issues/24) — SDK parity: publish Rust, Wasm, TypeScript, and Dart clients from one contract |
| 32 | P0 | 2 | security-admission | [ores-chat/ores-chat-e2e#8](https://github.com/ores-chat/ores-chat-e2e/issues/8) — Hardening: certify reconnect across server instances without identity/order/auth drift |
| 33 | P0 | 2 | security-admission | [ores-chat/ores-chat-web-server.rs#3](https://github.com/ores-chat/ores-chat-web-server.rs/issues/3) — Harden public/customer web ingress with shared auth, middleware, and limits |
| 34 | P0 | 2 | verification-ci | [ores-chat/ores-chat-clients#8](https://github.com/ores-chat/ores-chat-clients/issues/8) — Generate and parity-test 20 language SDK distributions |
| 35 | P0 | 2 | verification-ci | [ores-chat/ores-chat-lib-core#7](https://github.com/ores-chat/ores-chat-lib-core/issues/7) — Implement reproducible cohort regression and correlation discovery |
| 36 | P0 | 2 | rpc-transport | [ores-chat/ores-chat-clients#27](https://github.com/ores-chat/ores-chat-clients/issues/27) — Rust transport must preserve and verify response Content-Type before decode |
| 37 | P0 | 2 | contract-parity | [ores-chat/ores-chat-flutter#11](https://github.com/ores-chat/ores-chat-flutter/issues/11) — Replace local session realm mapping with canonical ChatSurface Dart projection |
| 38 | P0 | 2 | contract-parity | [ores-chat/ores-chat-interfaces#24](https://github.com/ores-chat/ores-chat-interfaces/issues/24) — Adopt TJSV Protobuf, WIT, and Dafny additive contract gates |
| 39 | P0 | 2 | contract-parity | [ores-chat/ores-chat-interfaces#22](https://github.com/ores-chat/ores-chat-interfaces/issues/22) — Advanced messaging contracts: threads, mentions, polls, pins, schedules, translation, notifications, moderation |
| 40 | P1 | 2 | verification-ci | [ores-chat/.github#7](https://github.com/ores-chat/.github/issues/7) — DEN-266/S9-04: close customer-support chat parity gaps across embed, routing, history, automation, and operator workflows |
| 41 | P1 | 2 | verification-ci | [ores-chat/ores-chat-admin-components#8](https://github.com/ores-chat/ores-chat-admin-components/issues/8) — Agent workspace parity: unified inbox, routing controls, macros, bulk actions, moderation |
| 42 | P1 | 2 | contract-parity | [ores-chat/ores-chat-interfaces#8](https://github.com/ores-chat/ores-chat-interfaces/issues/8) — Generate versioned contract artifacts for every supported SDK language |
| 43 | P1 | 2 | verification-ci | [ores-chat/ores-chat-e2e#6](https://github.com/ores-chat/ores-chat-e2e/issues/6) — Cross-stack customer-support parity acceptance suite |
| 44 | P1 | 2 | security-admission | [ores-chat/ores-chat-admin-api-server.rs#5](https://github.com/ores-chat/ores-chat-admin-api-server.rs/issues/5) — Adopt shared middleware and deterministic limits in private admin ingress |
| 45 | P1 | 2 | security-admission | [ores-chat/ores-chat-flutter#2](https://github.com/ores-chat/ores-chat-flutter/issues/2) — DEN-3913: finish Shared Auth, encrypted env, and Android logo rollout |
| 46 | P1 | 2 | contract-parity | [ores-chat/ores-chat-api-server.rs#14](https://github.com/ores-chat/ores-chat-api-server.rs/issues/14) — Replace JSON-only RPC framing with shared binary codec dispatch |
| 47 | P1 | 2 | rpc-transport | [ores-chat/ores-chat-clients#29](https://github.com/ores-chat/ores-chat-clients/issues/29) — Rust transport: preserve response Content-Type before codec decode |
| 48 | P1 | 2 | contract-parity | [ores-chat/ores-chat-api-server.rs#16](https://github.com/ores-chat/ores-chat-api-server.rs/issues/16) — Replace temporary JSON RPC media guard with shared codec-aware dispatcher |
| 49 | P1 | 2 | contract-parity | [ores-chat/ores-chat-clients#25](https://github.com/ores-chat/ores-chat-clients/issues/25) — Make Chat transports codec-neutral: JSON, MessagePack, Protobuf, binary streams |
| 50 | P1 | 2 | contract-parity | [ores-chat/ores-chat-web-server.rs#17](https://github.com/ores-chat/ores-chat-web-server.rs/issues/17) — Consume ORES Forms SSR/component contract for structured chat forms |
| 51 | P1 | 2 | rpc-transport | [ores-chat/ores-chat-mcp-server.rs#4](https://github.com/ores-chat/ores-chat-mcp-server.rs/issues/4) — Harden remote MCP transport and least-privilege chat tools |
| 52 | P2 | 2 | verification-ci | [ores-chat/ores-chat-clients#28](https://github.com/ores-chat/ores-chat-clients/issues/28) — Add exact-SHA certification in ores-chat-test for zero-step product CI |
| 53 | P2 | 2 | rpc-transport | [ores-chat/ores-chat-pub-lib-core#6](https://github.com/ores-chat/ores-chat-pub-lib-core/issues/6) — Publish support/sales chat bindings for native desktop and Flutter clients |
| 54 | P2 | 2 | rpc-transport | [ores-chat/ores-chat-clients#21](https://github.com/ores-chat/ores-chat-clients/issues/21) — Add TypeScript, Dart, and Gleam clients to match Rust internal surface |
| 55 | P2 | 2 | rpc-transport | [ores-chat/ores-chat-clients#20](https://github.com/ores-chat/ores-chat-clients/issues/20) — Add Dart, TypeScript, Gleam, and WASM parity to the shared ORES Chat client boundary |
| 56 | P2 | 2 | verification-ci | [ores-chat/ores-chat-components#6](https://github.com/ores-chat/ores-chat-components/issues/6) — Drop-in support widget and native UI-kit parity |
| 57 | P2 | 2 | rpc-transport | [ores-chat/ores-chat-clients#13](https://github.com/ores-chat/ores-chat-clients/issues/13) — [DEN-2843] Refactor client APIs toward immutable value construction |
| 58 | P2 | 2 | verification-ci | [ores-chat/.github#3](https://github.com/ores-chat/.github/issues/3) — DEN-3954: enforce repository/test-fleet audit across ORES Chat |
| 59 | P2 | 2 | verification-ci | [ores-chat/ores-chat-docs#4](https://github.com/ores-chat/ores-chat-docs/issues/4) — Parity milestone: omnichannel support and service operations |
| 60 | P2 | 2 | verification-ci | [ores-chat/ores-chat-monorepo#5](https://github.com/ores-chat/ores-chat-monorepo/issues/5) — Integrate the browser-tested public support server |
| 61 | P0 | 3 | security-admission | [ores-otel/ores-lib-core#33](https://github.com/ores-otel/ores-lib-core/issues/33) — Add low-cardinality quota/admission telemetry contract |
| 62 | P0 | 3 | security-admission | [ores-otel/ores-otel-infra#15](https://github.com/ores-otel/ores-otel-infra/issues/15) — Hardening: keep applications healthy through collector outages with bounded telemetry behavior |
| 63 | P0 | 3 | contract-parity | [ores-otel/ores-lib-core#1](https://github.com/ores-otel/ores-lib-core/issues/1) — Pin ores-interfaces provenance and replace legacy next-loggers dependency |
| 64 | P0 | 3 | contract-parity | [ores-otel/ores.otel.log#119](https://github.com/ores-otel/ores.otel.log/issues/119) — Repair reusable trace-contract workflow startup and checker warnings |
| 65 | P0 | 3 | contract-parity | [ores-otel/ores-otel-lambdas#1](https://github.com/ores-otel/ores-otel-lambdas/issues/1) — [DEN-3959] Bootstrap canonical Lambda OCI/TJSV runtime |
| 66 | P0 | 3 | security-admission | [ores-otel/ores-otel-interfaces#9](https://github.com/ores-otel/ores-otel-interfaces/issues/9) — Add collector admission, quota and overload control contracts |
| 67 | P0 | 3 | security-admission | [ores-otel/ores-otel-lib-core#3](https://github.com/ores-otel/ores-otel-lib-core/issues/3) — [Google Chat review] APM parity: process memory and disk checks, plus latency and performance monitoring |
| 68 | P0 | 3 | verification-ci | [ores-otel/ores.otel.log#26](https://github.com/ores-otel/ores.otel.log/issues/26) — Conformance gate: durable ACK, idempotent replay, and Dart SDK adoption |
| 69 | P0 | 3 | contract-parity | [ores-otel/ores-otel-sidecar.rs#38](https://github.com/ores-otel/ores-otel-sidecar.rs/issues/38) — Align lifecycle agent runtime contract with fenced freeze/thaw infra without weakening trusted-demand boundary |
| 70 | P0 | 3 | contract-parity | [ores-otel/ores-otel-sidecar.rs#34](https://github.com/ores-otel/ores-otel-sidecar.rs/issues/34) — Repair FP conformance baseline drift without raising the budget |
| 71 | P0 | 3 | contract-parity | [ores-otel/ores-otel-orm-core#4](https://github.com/ores-otel/ores-otel-orm-core/issues/4) — [DEN-3040] Define low-cardinality ORM operation/pool telemetry contract |
| 72 | P0 | 3 | contract-parity | [ores-otel/ores-otel-interfaces#7](https://github.com/ores-otel/ores-otel-interfaces/issues/7) — Adopt TJSV Protobuf, WIT, and Dafny additive contract gates |
| 73 | P1 | 3 | verification-ci | [ores-otel/ores-otel-admin-api-server.rs#7](https://github.com/ores-otel/ores-otel-admin-api-server.rs/issues/7) — DEN-396: make ORES OTEL admin argv rejection explicit and certify runtime binding |
| 74 | P1 | 3 | verification-ci | [ores-otel/ores-otel-sidecar.rs#29](https://github.com/ores-otel/ores-otel-sidecar.rs/issues/29) — Salvage ordered runtime-event reconciliation from ores-sidecar.rs#4 |
| 75 | P1 | 3 | verification-ci | [ores-otel/.github#11](https://github.com/ores-otel/.github/issues/11) — DEN-3954: enforce ORES OTel production/test conformance mapping |
| 76 | P1 | 3 | security-admission | [ores-otel/ores-otel-lib-core#2](https://github.com/ores-otel/ores-otel-lib-core/issues/2) — [Google Chat review] Backend middleware for every language that creates a per-request logger bound to request id and user id |
| 77 | P1 | 3 | security-admission | [ores-otel/ores-otel-flutter#2](https://github.com/ores-otel/ores-otel-flutter/issues/2) — DEN-3913: finish Shared Auth, encrypted env, and Android logo rollout |
| 78 | P1 | 3 | security-admission | [ores-otel/ores-interfaces#1](https://github.com/ores-otel/ores-interfaces/issues/1) — Harden Shared Auth credential vocabulary and remove biometric modality disclosure |
| 79 | P1 | 3 | contract-parity | [ores-otel/ores-otel-infra#16](https://github.com/ores-otel/ores-otel-infra/issues/16) — Add eBPF sensor pipeline with OTLP export, bounded buffering, and kernel capability detection |
| 80 | P1 | 3 | security-admission | [ores-otel/ores-otel-api-server.rs#13](https://github.com/ores-otel/ores-otel-api-server.rs/issues/13) — DEN-396: make ORES OTEL NATS transport env-only or credential-free by construction |
| 81 | P1 | 4 | contract-parity | [ores-otel/ores.otel.log#84](https://github.com/ores-otel/ores.otel.log/issues/84) — integrate ores-clis-core log thresholds without owning CLI output policy |
| 82 | P1 | 4 | contract-parity | [ores-otel/ores-otel-interfaces#8](https://github.com/ores-otel/ores-otel-interfaces/issues/8) — Document additive contract applicability for ores-otel |
| 83 | P2 | 4 | telemetry | [ores-otel/ores-otel-clients#22](https://github.com/ores-otel/ores-otel-clients/issues/22) — Use ores-sw shared connection hub for browser telemetry |
| 84 | P2 | 4 | verification-ci | [ores-otel/ores-otel-sidecar.rs#35](https://github.com/ores-otel/ores-otel-sidecar.rs/issues/35) — Ship the ores-process-lifecycle-agent executable consumed by BeamScale and Scintilla |
| 85 | P2 | 4 | rpc-transport | [ores-otel/ores-otel-clients#21](https://github.com/ores-otel/ores-otel-clients/issues/21) — Add first-class Gleam client to internal telemetry support matrix |
| 86 | P2 | 4 | runtime-integration | [ores-otel/ores.otel.log#105](https://github.com/ores-otel/ores.otel.log/issues/105) — Unify native desktop shared-runtime integration across 30 organizations |
| 87 | P2 | 4 | telemetry | [ores-otel/ores-otel-infra#17](https://github.com/ores-otel/ores-otel-infra/issues/17) — Add privacy-preserving agent-session replay and evaluation telemetry pipeline |
| 88 | P2 | 4 | telemetry | [ores-otel/ores-otel-interfaces#19](https://github.com/ores-otel/ores-otel-interfaces/issues/19) — Define OpenTelemetry semantic conventions for LLM, agent, MCP, and tool execution traces |
| 89 | P2 | 4 | telemetry | [ores-otel/ores-otel-interfaces#18](https://github.com/ores-otel/ores-otel-interfaces/issues/18) — Certify vendor-neutral OpenTelemetry semantic-convention and OTLP interoperability |
| 90 | P2 | 4 | telemetry | [ores-otel/ores-otel-sidecar.rs#3](https://github.com/ores-otel/ores-otel-sidecar.rs/issues/3) — A generic k8s telemetry sidecar, plus finding the 7-15 repos that should adopt it |
| 91 | P0 | 4 | contract-parity | [ores-redis-lru-cache/ores-lru-redis-lambdas#1](https://github.com/ores-redis-lru-cache/ores-lru-redis-lambdas/issues/1) — [DEN-3959] Bootstrap Redis LRU Lambda OCI/TJSV runtime |
| 92 | P0 | 4 | contract-parity | [ores-redis-lru-cache/ores-lru-redis-pub-lib-core#6](https://github.com/ores-redis-lru-cache/ores-lru-redis-pub-lib-core/issues/6) — Expose realtime cache/update contracts for desktop clients |
| 93 | P0 | 4 | contract-parity | [ores-redis-lru-cache/ores-lru-redis-interfaces#12](https://github.com/ores-redis-lru-cache/ores-lru-redis-interfaces/issues/12) — Adopt TJSV Protobuf, WIT, and Dafny additive contract gates |
| 94 | P2 | 4 | runtime-integration | [ores-redis-lru-cache/ores-lru-redis-flutter#3](https://github.com/ores-redis-lru-cache/ores-lru-redis-flutter/issues/3) — Bootstrap Flutter cache/invalidation package for real-time app updates |
| 95 | P2 | 4 | runtime-integration | [ores-redis-lru-cache/ores-lru-redis.rs#25](https://github.com/ores-redis-lru-cache/ores-lru-redis.rs/issues/25) — DEN-3954: complete Redis LRU repository provisioning and consumer rollout |
| 96 | P2 | 4 | runtime-integration | [ores-redis-lru-cache/.github#2](https://github.com/ores-redis-lru-cache/.github/issues/2) — Provision the three genuinely missing organization repositories |
| 97 | P1 | 4 | runtime-integration | [ores-otel-test/.github#3](https://github.com/ores-otel-test/.github/issues/3) — DEN-3959: expand exact-head canary coverage to remaining SDK runtimes |
| 98 | P2 | 4 | verification-ci | [ores-otel-test/.github#4](https://github.com/ores-otel-test/.github/issues/4) — DEN-3959: pin test-org GitHub Actions to immutable SHAs and remove Node 20 action drift |
| 99 | P2 | 4 | security-admission | [ores-otel-test/.github#2](https://github.com/ores-otel-test/.github/issues/2) — DEN-3954: add focused trace propagation, failure, and redaction suites |
| 100 | P2 | 4 | runtime-integration | [ores-uni-threads/ores-uni-threads.github.io#2](https://github.com/ores-uni-threads/ores-uni-threads.github.io/issues/2) — DEN-3443: create ores-uni-threads infra and Rust service-role repositories |

## Admission rule

Every issue moves from queued → implemented → verified only with a named source commit, independently reviewed upstream contract revision, deterministic comparison receipts where applicable, exact-tree real test results, and recorded CI job steps. The issue inventory and its test validate **metadata integrity only**, not completion.
