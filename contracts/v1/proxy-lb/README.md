# Proxy load-balancing selection parity contract — source-only candidate

Status: **SOURCE_ONLY / NOT_EXECUTED on all five target guests**. The vector
registry describes one narrow deterministic scheduling oracle, not a live
HAProxy/NGINX proxy and not a compiler/runtime parity certificate.

## Scope

- `selection-vectors.json`: 24 deterministic positive and rejection cases
  for `round_robin`, `weighted_round_robin` and `least_conn`.
- `src/proxy-lb-reference.mjs`: a synthetic Node reference, **not** the
  authoritative Oreslang implementation.
- `tests/proxy-lb-reference.test.mjs`: 24 vector checks plus 4096 seeded
  trials with a non-vacuity assertion, and invalid-input checks.
- `fixtures/proxy-lb-v1/manifest.json`: five exact Git-blob-pinned
  zero-argument scalar `.ores` fixtures testing the signed 64-bit comparison
  `active_a * weight_b - active_b * weight_a` in the common basic arithmetic
  subset, including tie and bounded extreme inputs. These must be run as
  **actual guests** before making any parity claim.
- `backend-status.pending.json`: explicit NOT_EXECUTED per backend.

Run hosted reference checks (no private guest compiler required):

```sh
node --test tests/proxy-lb-reference.test.mjs tests/proxy-lb-fixtures.test.mjs
```

## Backends (exact targets)

| Target | Current known path | First executable promotion gate |
| --- | --- | --- |
| Java/Graal | Host pinned HTTP substrate and actor memory/I/O loans | Guest scalar and then actor-owned LB ledger + loopback upstream proof |
| LLVM | Zero-GC native actor/slab/reactor substrate | Guest scalar, ASan/UBSan and native connection lease integration |
| Wasm | Zero-import core Wasm worker host | Scalar fixture via llvmc to Wasm; network LB requires an explicitly added capability profile |
| Cranelift | Independent Rust+Cranelift scalar JIT only | All five scalar fixtures with actual signed64 returns; reject actor/network features until implemented |
| .NET | Native AOT HTTP ingress host provider | Signed64 source lowering, then host-to-guest proxy I/O and Native AOT tests |

Forge is a **separate sixth backend** with its own independent C++ implementation,
not a Cranelift alias. Do not substitute Forge test results for Cranelift.

## Security and consistency gates

1. The proxy's strict declarative YAML grammar is versioned `ores.proxy/v2`
   for upstream pools; `ores.proxy/v1` retains direct origins.
2. Pure selection does **not** reserve capacity. Actor-exclusive
   `lb_ledger` reference model reserves a backend slot with an epoch/nonce,
   rejects malformed snapshots and duplicate/stale releases, and starts with
   all endpoints unhealthy. Production requires an **actual** single-writer
   actor, a verified health receipt, a concrete network capability and physical
   I/O completion before release.
3. No overflow: weights 1..16, active 0..1024; cross-products at most 16384.
4. Selection and ledger are not permission checks: pin DNS/IP, verify TLS
   peer identity, require authentication, enforce retries only for replayable
   bodies and reject request smuggling at the raw ingress adapter.
5. Host model/JSON Git blob checks are not compiler proof. Re-run every
   source fixture through the actual five compiler toolchains, with source
   commit/tree, compiler binary, artifacts, executed steps, target mode and
   observed guest result. Distinguish unsupported from failed and unexecuted.
6. Do not use unapproved private-source cross-org mirroring. Runners must be
   isolated; source CI failing before allocation is NOT_EXECUTED.

Original proxy code: `oreslang-reverse-proxy-demo.ores` feature branch
`feature/declarative-lb-pools-20261031`, and forward CONNECT slot proof on
`oreslang-forward-proxy-demo.ores` feature branch
`feature/forward-egress-lease-20261031`. These are not merged or released.
