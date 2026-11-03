# AttoLang MCP developer control plane — M0 security contract

Status: **SOURCE_FREE_REFERENCE_ONLY**. Tracks #323. No listener, runtime mutation, guest semantic change, compiler execution, reflection, scanning, dynamic code, JIT or backend parity is claimed.

## Threat model
Untrusted clients include AI assistants, local processes and compromised tools. Threats: forged principal/clientInfo, cross-tenant resource reads, generation reuse, scope escalation, replay, nonce-cache saturation, parsing/serialization resource exhaustion, audit bypass, leakage of actor state/pointers/secrets, upgrade-artifact forgery and arbitrary guest invocation. Transport and local OS identity are not sufficient by themselves for tenant authority.

## Admission
Default disabled, no listener or host import. A future local UDS or restrictive named pipe requires authenticated OS peer **and** a separately minted short-lived credential bound to boot, principal, runtime, tenant, generation, expiry and exact read scopes. Never derive authority from client-supplied JSON or MCP clientInfo. Remote/TLS is out of scope. Reject stale boot/generation, unknown versions and scopes. Principal, request target and URI target must all agree. No wildcard tenant.

Contract version `atto.mcp.dev-control.m0.v1`. MCP protocol pinned to `2026-07-28`; M0 does not support initialize/session fallback. Request security metadata includes `schema_version`, `nonce` (>=128 random bits), `issued_at_ms`, `runtime_id`, `tenant_id`, `expected_generation`. Host-resolved principal never appears as caller-writable input.

## Read-only surface
Allowed methods: `server/discover`, `tools/list` (always empty), `resources/list`, `resources/read`. Discovery/list require `inspect:catalog`; reads require matching `inspect:summary`, `inspect:metrics` or `inspect:upgrade_status`. Only exact URIs under `atto-dev://runtime/{runtime}/tenant/{tenant}/` with suffix `process/summary`, `actors/counters`, `tasks/counters`, `scheduler/counters`, `upgrade/status`. Catalog is principal-filtered. Responses permit only explicitly enumerated counters/statuses, never raw state, pointers, secrets, source or arbitrary heap traversal.

Explicitly unsupported: `initialize`, `notifications/initialized`, `tools/call`, prompts, subscriptions, roots, logging, sampling, elicitation, tasks, guest eval/method invocation, memory writes, upgrade prepare/commit/rollback and artifact installation. Unsupported method denial precedes any side effects; forged signatures cannot activate an unsupported method.

## Budgets
Preallocation frame limit 32 KiB; response 64 KiB; JSON depth <=12; 60 requests per rolling minute and 8 per second per principal; <=2 concurrent; monotonic deadline <=500ms; catalog <=32 entries; issued-at skew <=30s; replay nonce cache 60s/128 entries per principal (fail closed if full); audit record <=2 KiB. M2 must add global and unauthenticated peer quotas, duplicate JSON key rejection, UTF-8 validation and preallocation parser checks. Replay key includes boot and trusted principal. Concurrent duplicate JSON-RPC IDs reject; ID reuse with fresh nonce after completion is not itself replay.

## Audit
`atto.mcp.audit.v1`: UTC timestamp, keyed/salted hashes for principal/tenant/runtime/request ID, sanitized method and coarse resource kind, allow/deny and finite reason code, byte counts, elapsed milliseconds and generation. Never log credentials, raw URI, request/response bodies, secret state. Audit failure denies admission.

## Minimum hostile tests
Disabled endpoint; unauthenticated/expired peer; cross-tenant/runtime URI or metadata; forged clientInfo; missing catalog/read scope; stale generation/boot; unknown version; nonce replay; concurrent duplicate request ID; clock skew; per-second/minute/inflight quota; replay-cache saturation; oversized/deep/malformed/duplicate-key frame; deadline/cancel/disconnect; response overflow; forged upgrade artifact; guest invocation; secret/pointer injection; audit failure.

## Promotion
M0: schema and source-free policy model only. M1: compiler-owned deterministic AOT descriptors, no reflection/JIT. M2: actual authenticated local server round trip, bounded transport parser, durable audit. M3: generation-consistent guest-backed redacted snapshots. M4: independently approved signed upgrade/rollback. Java, LLVM, Wasm, .NET NativeAOT and Forge parity independently proven. Require exact commit/tree, schema/tool versions, nonzero executed CI steps, real invocation receipts and independent security review. Zero-step = NOT_EXECUTED.
## 2026-07-28 MCP interoperability correction (M0 hardening)

MCP `clientInfo` is optional, self-reported and must never grant authority. `clientCapabilities` is required and may be nonempty; it is bounded and explicitly ignored for authorization. Optional `logLevel` is accepted without triggering logs unless an authorized implementation later opts in. The host boot ID is not caller-writable: policy admission compares a trusted host boot identifier against the credential's boot binding. M0 source-only tests for a duplicate live JSON-RPC ID and cancellation cleanup are **reference-ledger simulations**, not proofs of atomic network dispatch or durable audit. The additional `resourceSummary` schema is a strict output whitelist to prevent pointer, credential and unredacted state fields. Do not use it as evidence of live snapshots.

Protocol source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/index.mdx and https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts


## M0 reference admission ledger (November 3, 2026)

`bin/mcp-m0-admission-ledger.mjs` is an **explicitly source-free, same-event-loop test model**; it is not a credential issuer, an MCP network listener, a cross-process synchronization mechanism, or a live runtime admission path. It accepts a *host-resolved* principal, authenticated-peer flag, boot identity and **host-current runtime generation**. A caller-controlled `clientInfo`, capabilities declaration or URI never grants an additional scope. The host-owned timestamp inputs must be trusted in a real integration.

The reference model does all allowlist, replay and request-ID checks synchronously before reserving an opaque one-time ticket. Per-principal rolling rate windows are 8 requests/second and 60/minute, with 2 inflight per principal, 64 principal states and 128 globally inflight. A successful reservation consumes its nonce even if processing is subsequently cancelled; completing a ticket releases concurrency but never refunds its nonce or rate consumption. Stale ticket completion cannot release a newer request ID. Live tickets are fenced by monotonic 500ms deadline, runtime generation and **credential expiry**. Only idle principal states with fully expired replay/rate evidence can be reclaimed. An absent, throwing, async or unsuccessful audit sink fails closed; the sample synchronous sink does **not** establish durable audit.

`tests/mcp-m0-admission-ledger.test.mjs` is the accompanying negative matrix. Successful local Node tests on pinned Git blob identities are source-free host evidence, never compiler-backed or hosted CI evidence. The test runner has not supplied any peer credential attestation, OS socket, native AOT descriptor, guest application execution, durable audit fsync or backend parity receipt.

### M2-specific obligations still open

Trustworthy OS-peer identification and boot-bound credential issuance; duplicate-key rejection on the actual transport; cross-process replay-cache atomicity where relevant; bounded global unauthenticated requests; real transport cancellation/disconnect and timeouts; response serialization budget; durable append-only audit; exact-head stepful CI; and independent security approval. Do not enable the server or upgrades on the strength of this M0 model.
