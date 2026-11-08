# Untrusted actor checkpoint coverage: source-free post-optimization CFG admission

**Status (2026-11-07): executable source-free verifier model only. NOT a
compiler integration, runtime sandbox, LLVM pass, guest-execution receipt,
tenant revoker or merge certification.**

## Contract

Every *reachable* potentially unbounded cycle must encounter a mandatory
**hard-fuel charge**. The cost of charging one reduction is distinct from
the expensive 128-step soft fairness/scheduler poll. A `rt cooperate`
hint cannot substitute for charged hard fuel in an untrusted guest.

The source-free `verifyUntrustedCheckpointCFG` policy models the proof by
removing compiler-verified hard-charge blocks, then finding cycles in
the remaining reachable control-flow graph. A cycle still present is a
concrete bypass witness. This is deliberately stronger than checking
whether a strongly connected component merely contains *one*
checkpoint: a different route may avoid it forever.

The interprocedural graph conservatively follows direct and enumerated
indirect call targets to catch recursion. Unknown indirect calls fail
closed. Reachable foreign/native calls with neither certified bounded
execution nor independently bounded isolate revocation fail closed,
even for acyclic graphs. The model requires post-commit provenance on
each hard charge and rejects malformed and oversized graphs.

## Evidence and safety limitations

An arbitrary AttoLang program **must not** supply this JSON graph, claim
`fuelCharge: true`, request `foreign: 'bounded'`, or choose its own
`revocationBoundMs` value. Only a trusted compiler pass may build the
graph from a finalized, post-optimization CFG with genuine runtime
metering and authorized isolate revocation.

The future production verifier must prove that:
- Every real executable edge (including exception, unwind, callback,
  recursion and optimizer-created edges) is represented conservatively.
- Each hard-fuel charge is compiler-private, cannot be optimized out,
  charges the *logical tenant task* across dispatches, and occurs at
  a replay-safe committed boundary.
- No unmetered, non-revocable native/FFI call can run unboundedly.
- Revocation, process ownership, pinned actor heaps, and effect
  commit/cancellation semantics are separately verified.
- Both O0 and O2/O3 generated-guest tests show actual quota exhaustion,
  bounded peer progress and negative mutation failures.

The model runs in linear time with bounded memory for up to 4096 blocks
and 16,384 edges. It uses iterative DFS and returns a concrete bypass
cycle witness when admission fails. These sizes constrain only the model,
not what a future production compiler must support.

## Local verification

The two precise files `src/untrusted-checkpoint-cfg.mjs` and
`tests/untrusted-checkpoint-cfg.test.mjs` were read back from GitHub
and compared to local Git blob hashes. Node 22 executed the exact
source-free files: **14/14 test cases passed**. Tests include unmetered
infinite loops, a checkpoint-bypass edge, independently metered
nested loops, mutual and indirect recursion, unsafe FFI, missing
post-commit evidence, unreachable code, and a 3000-block deep cycle.

This does **not** prove either Java or LLVM's compiler emits such a
verified CFG. Do not promote backend parity from these model tests.

```sh
node --test tests/untrusted-checkpoint-cfg.test.mjs
```
