# Virtual actor directory and supervisor inspection conformance v1

**Status: candidate-unattested.** This contract is additive to `state-container-virtual-actor-v1`; it does not change the 20 pre-existing VA01–VA20 cases or their evidence.

## Scope

The target semantics are stable virtual-actor logical identity; versioned canonical address; side-effect-free resolve/inspect; one exact supervisor ownership edge; host-only inspection through bounded CONTROL; revision-fenced bounded listing; monotonically increasing activation generations; payload-free terminal metadata; proxy/target lifecycle separation; stable logical persistence key with a separate provider durable epoch.

The shared target backends are Java, LLVM, Wasm, Forge and .NET. A missing implementation, missing compiler, empty/zero-step CI job or mocked host model remains `NOT_EXECUTED`, never a pass.

## Canonical address vector

Identity:
- tenant/domain: `tenant-a`
- namespace-qualified declaration: `7:defaultCart`
- key: `42`

Canonical encoded address:
`atto-va1.dGVuYW50LWE.NzpkZWZhdWx0Q2FydA.NDI`

This is Base64URL encoding, not encryption or authorization. The address is a locator, not a bearer capability.

## Required evidence

For every backend, an eventual PASS must carry exact compiler/runtime source commit and Git tree, canonical fixture SHA-256, nonzero executed steps, raw logs, guest artifact or execution receipt where applicable, negative mutation evidence, and independent review. Contract-structure tests do not attest a compiler or runtime.

Run the local contract integrity checks with:

```sh
npm test
```

The added `tests/virtual-actor-directory-inspection-v1.test.mjs` confirms the versioned schema, canonical address vector, unique 12 cases, five-backend target inventory, and explicit NOT_EXECUTED statuses. It is not a language or runtime conformance run.

## Twelve target oracles

1. Address V1 canonical vector and round trip.
2. Unknown ID/address lookup is non-allocating and non-activating.
3. Resolve returns a logical reference without starting an activation.
4. Exactly one supervisor owner; exact managed-worker proof, not ActorGroup cooperation membership.
5. Session/tenant/supervisor-scoped inspection via bounded CONTROL, no inline fallback.
6. One atomic queued-timeout versus CONTROL-start winner, with capacity retained until stale queued work drains.
7. Stable deterministic bounded pagination and stale-cursor rejection after any directory metadata revision.
8. Monotonic activation generation, burned aborted generation and stale-generation denial.
9. Physical terminal outcome distinguishes passivation/cancellation/failure without Throwable, message or stack retention.
10. Proxy actor identity/supervision remains independent from the virtual target identity.
11. Logical persistence key stable across activation/supervisor facade replacement, with durable provider epoch kept separate.
12. Cross-tenant denial and strict malformed/noncanonical address rejection.

All 12 cases currently have **NOT_EXECUTED** on every backend. Do not update evidence status from source inspection, documentation tests, host-only registry tests, or zero-step Actions workflows.
