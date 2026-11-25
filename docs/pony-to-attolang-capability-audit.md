# Pony-inspired reference-capability safety — AttoLang audit

This is an *implementation-gap* audit, not certification of compiled AttoLang.
Pony iso/trn/ref/val/box/tag and recover are semantic inspirations, NOT
additional AttoLang syntax. The user-facing language retains rt take,
rt share, rt borrow, rt borrow mut, and sealed actor handle_state calls.

## P0 compiler requirements

| Pony idea | AttoLang requirement | Present proof level |
|---|---|---|
| iso | Consume exclusive full reachable mutable graph after successful admission; failed sends retain the owner | Finite graph model only |
| trn | Mutable construction with readonly local aliases, then checked one-way freeze | Finite model only |
| ref | Local mutable loan never carried to foreign actor | Finite model only |
| val | rt share yields permanently deeply immutable graph; it cannot be unshared | Corrected M5 model and new graph contract |
| box | rt borrow is temporary readonly view; never automatically sendable | Finite model only |
| tag | Opaque actor identity cannot read state or grant I/O | Finite model only |
| recover | No writable external captures or aliases through a cycle | Conservative model only |
| viewpoint adaptation | Field read/write capability determined by origin and field; six-by-six matrix | Contract only; no full compiler lowering |

## Runtime security and memory obligations

Pony ORCA reference tracking is NOT a substitute for AttoLang's deterministic
actor-owned memory reclamation. LLVM must retain full native AOT and zero
tracing-GC. GraalVM Native Image must retain full native AOT and its strict
zero-collection execution profile; Java/JVM requires minimal GC. Epsilon's
zero collections do not imply zero allocations or stable memory. An executed
M5 100,000-message host-worker test grew managed heap by **25,690,112 bytes**,
exceeding the proposed 8 MiB budget. The sustainability gate is
NOT_QUALIFIED even though native functionality passed.

A bounded mailbox must couple ownership consumption to successful admission.
A full/closed mailbox must not consume an isolated graph. Actor restart
must revoke stale generation capabilities. Unhandled actor panic travels
on a supervisor-only CONTROL priority path, independently of normal data
capacity. Actor-local arenas alone do not sandbox hostile native tenants;
cross-tenant graphs require broker-authorized copy/serialization.

## Executed and missing tests

- This PR: 46 graph capability tests, 512 seeded transfer/freeze traces,
  plus 23 corrected baseline ownership/supervisor model tests.
- LLVM/GraalVM restricted checked-AST-to-application-specific-Native-Image:
  previously executed for one scalar actor fixture. This is NOT general
  async actor or graph transfer parity.
- LLVM compiler follow-up draft: explicit refusal of unprojected effects,
  Pony keywords, rt borrow/borrow mut/share in the narrow actor projection.
- GraalVM compiler follow-up draft: deny duplicate JSON keys, malformed
  authority, unsafe checked-IR extensions, mutable executable check/exec
  replacement during canonical parser invocation.
- NOT EXECUTED: complete typed HIR/MIR graph borrow/freeze/recover,
  independent compiled guest asynchronous rt take, five-backend parity,
  hostile-tenant OS/isolate security, hard real-time and bounded zero-GC soak.

## Production gates

All five backend compilers must reject illegal transitive graph aliases
before code generation. Require exact-head stepful native/guest CI with
source/binary provenance, actual overflow/move/borrow counterexamples,
concurrent producer linearizability checks, sanitizer lanes when supported,
arena charge/RSS/managed heap memory measurements, and independent review.

Source references: official Pony reference capability, passing/sharing,
recover and combining-capabilities tutorials (URLs in the JSON contract).
