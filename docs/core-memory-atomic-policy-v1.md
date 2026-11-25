# Core memory, pointer-span and atomic-order conformance v1

This is a **behavioral contract**, not a common `.atto` implementation and
not an executable memory-safety proof. Each `atto-source.*` compiler owns
its `stdlib/core/mem.atto`, `ptr.atto`, and `atomic.atto` independently.

`contracts/core-memory-atomic-policy-v1.json` records 14 public arithmetic
and ordering-policy functions with 63 positive/negative i64 vectors. Return
sentinels are -1 for invalid integer policy decisions and false for rejected
predicates. Signed i64 is exact: all boundary arguments and results are
decimal strings, not lossy JavaScript numeric literals.

## Safety and supported operation boundary

- Memory layout policy can check size, alignment, span or array-budget
  arithmetic. It does not allocate, drop, zeroize, move, authenticate memory,
  or prove an actor-owned region's lifetime.
- Pointer policy checks authenticated-region-relative *arithmetic* only;
  passing the predicate cannot mint or dereference Pointer<T>, prove
  initialization or authorize escaping borrows.
- Atomic policy recognizes relaxed, acquire, release, acq_rel and seq_cst
  as 0/1/2/3/4; defaults to seq_cst. It never implements Atomic<T>, CPU
  fences, CAS, RMW, cross-thread publication or shared actor storage.
- A compiler that cannot prove the appropriate intrinsic, provenance,
  CAS ordering and no-overflow-publication rule MUST reject the guest rather
  than simulate a backend-independent pointer or atomic.

The separate language [atomic specification #175](https://github.com/atto-lang/atto-spec/pull/175)
requires checked `fetch_add`/`fetch_sub` without publishing overflow,
correct failure ordering, and genuine happens-before behavior. LLVM
[Atomic/Box #801](https://github.com/atto-lang/atto-source.llvm/pull/801)
is implementing compiler-native checked CAS loops; Java
[#1771](https://github.com/atto-lang/atto-source.java/pull/1771) has
real ordered `AtomicI64Cell` host overloads, but guest order arguments
remain unsupported by its typechecker. Rust
[local-pointer #419](https://github.com/atto-lang/atto-source.rs/pull/419)
is a bounded candidate, not a general pointer runtime. Canonical
Java `atto.core/*` aliases belong to [#1416](https://github.com/atto-lang/atto-source.java/pull/1416)
and require integration before source import claims.

## Evidence discipline and promotion

The manifest's nine backend entries intentionally say
`guest_import_status=NOT_EXECUTED` and `native_aot_status=NOT_EXECUTED`.
The 63 cases can be exercised by

```sh
node --test tests/core-memory-atomic-policy-v1.test.mjs
```

This only runs an independent **source-free** BigInt oracle and ensures
no backend status is falsely promoted to PASS. It is not real `.atto`
compiler execution, host sanitizer coverage or CI proof for an exact
backend head.

Before claiming `PASS` for a backend, record: exact compiler head and
Git root-tree SHA; each local `.atto` module's blob SHA; exact fixture
bytes; actual parser/type checker and linked guest artifact; native AOT
or target-specific evidence; reject cases showing zero emitted artifacts;
and actual **nonzero runner steps** with recorded success. A zero-step
Actions failure is `NOT_EXECUTED`. No private cross-org Git tree may
be exported without authenticated source authorization, approved
destination/readers/retention and full SHA verification. No shared
canonical source dependency is required.

Remaining runtime conformance groups: checked overflow without
publication; CAS winning/losing and observed value; release/acquire
publication; illegal order rejection *before mutation*; pointer
generation/actor-tenant provenance, borrow/drop/STOP fencing; and
native guest AOT/no-GC verification per backend.
