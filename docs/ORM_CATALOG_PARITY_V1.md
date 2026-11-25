# ORM catalog, drift and PostgreSQL v1 cross-backend receipt contract

This document defines a **nonpromoting, nonexecuting** evidence contract for
six Oreslang source repositories: Java, LLVM, WASM, Cranelift, Forge and .NET.
The separate Cranelift source repository is an independent target, not a
renaming of Forge. The repository inventory is not a parity claim.

The checked-in `contracts/orm-backend-parity-v1.json` enumerates 14
conceptual catalog/review/snapshot/PostgreSQL projection outcome oracles.
These are **NOT executable Oreslang guest fixtures**. The current ORM host
Python fixtures and JSON Schema checks cover some shared semantics, but no
backend may report them as compiler-guest passes without actually compiling
and executing the corresponding target fixtures.

## Evidence admission

`node bin/verify-orm-backend-receipt.mjs /path/to/receipt.json` checks
the following consistency requirements:

- Exact registered backend repository identity and recognized backend mode
- Canonical fixed fixture identities and accepted/rejected expectations
- Exact source head SHA equal to the reported workflow head and a successful
  workflow with at least one **executed** step
- A compiler-produced guest, not a JavaScript/Python host substitute
- Target execution and both compiler/artifact SHA-256 digests
- Full, duplicate-free, guest-executed coverage of all 14 conceptual oracles
- SHA-256 of the exact pinned contract bytes

`ORM_BACKEND_RECEIPT_CONSISTENT_NOT_AUTHENTICATED` means only that the
untrusted receipt is internally consistent. **It does not independently
authenticate GitHub run IDs, compiler binaries, target execution, source
revision, hashes, or semantic correctness.** A fully synthetic receipt can
satisfy these structure checks, as explicitly demonstrated in verifier
unit tests. A release gate must independently fetch the exact run/jobs and
verified binary artifacts, inspect actual steps, and execute each compiled
guest case. Zero-step Actions runs cannot supply this proof.

## Backend adoption order

1. Implement a real guest harness for each of the 14 cases in the compiler
   source tree, using pure Oreslang/portable schema data and no DB credentials.
2. Java: execute JIT and Graal Native Image AOT; LLVM: zero-GC native AOT,
   ASan/UBSan and hard-real-time-appropriate allocation boundaries.
3. WASM: execute actual worker/Wasmtime or browser target; Cranelift: real
   Cranelift JIT/AOT target execution; Forge: separate engine execution.
   .NET: Native AOT for supported Windows/Linux targets.
4. Host-only Python projector and JSON Schema checks are preconditions,
   never substitutes for native guest execution or live PostgreSQL 17.
5. Confirm native diff/snapshot/rename/review equivalence, actor-owned DB
   connection lifecycle and no unsafe cross-isolate shared pointers.
6. Only then allow authenticated per-backend promotion receipts. Full
   cross-backend parity requires **all six** relevant backend receipts
   independently verified, not a single host oracle replicated six times.

No cross-organization private source transfer is permitted while the
existing security incident hold remains active. The conformance contract
contains no private source code and does not need repo mirrors.
