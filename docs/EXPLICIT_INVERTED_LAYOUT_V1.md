# Explicit inverted class, inverted struct and inverted collection v1

**Status:** proposed cross-backend source/ABI contract with an executable **JavaScript reference model**. This document does not certify any Oreslang compiler, native ABI, JIT/AOT, Wasm guest, GraalVM executable, or production-safe borrow checker. All primary backend results are **NOT_EXECUTED** until genuine guest-source tests run on independently verifiable exact heads.

## Three explicit independent constructs

- A **normal** class/struct has normal object/value semantics. `Array<T>` does not automatically become SoA.
- `define inverted class T as ... end` is a nominal class-like *row API* requiring explicitly owned, columnar row storage for mutable live rows. It retains callable methods, but not a separate heap allocation for each stored row.
- `define inverted struct T as ... end` is a nominal fixed-layout **value schema** eligible for explicitly owned, columnar row storage. It does not gain class identity or virtual methods. A standalone detached snapshot is a value, not a mutable column alias.
- `InvertedArray<T>` explicitly owns a **SoA collection**, including when T is a fixed-width eligible *ordinary* class/struct. `InvertedArray<T>` is never silently substituted for `Array<T>`, and no implicit AoS ↔ SoA conversion is permitted.
- Both inverted declarations and inverted collections may be used without an actor. Each mutable owner nevertheless belongs to one execution/ownership domain. No cross-actor mutable alias is implied.

**Proposed syntax (not yet a compiler acceptance claim):**

```ores
define struct Vec3 as
    float x;
    float y;
    float z;
end

define inverted struct Position as
    float x;
    float y;
end

define inverted class Particle as
    Vec3 velocity;
    Position position;
    float mass;

    move(float dt): void {
        self.mass += dt;
    }
end

let positions = InvertedArray<Position>.with_capacity(1000);
```

The `Position position` member of `Particle` above is **not currently admitted as an implicit nested inversion**: it must fail with a dedicated diagnostic until a separately specified explicit packed-value or collection boundary is implemented. A nested *ordinary* `Vec3` member, by contrast, is one complete packed value in exactly one top-level `velocity[]` column.

## Exact physical layout boundary

For a root inverted type, **each directly declared field has exactly one physically owned column** with row count equal to all other columns. Scalar fields are contiguous, typed and fixed-width. A nested ordinary fixed-layout struct remains **one packed element per row of its parent column**; its inner fields MUST NOT be recursively split into columns. Arrays of strings, pointers, resources, inheritance, virtual dispatch, recursive value types, unbounded fields and nested inverted declarations are rejected from v1 row storage unless separately lowered by an approved extension.

```text
define inverted class Body {
  Vec3 position;    // ordinary nested struct
  Vec3 velocity;    // ordinary nested struct
  f64 mass;
}

SoA Body owner:
  position[]: [Vec3, Vec3, Vec3, ...]   // ONE column
  velocity[]: [Vec3, Vec3, Vec3, ...]   // ONE column
  mass[]:     [f64,  f64,  f64,  ...]   // ONE column
```

A nested inverted type is **not** a request for recursive flattening. In v1 it is rejected with a compiler-owned error instead of silently flattened, boxed, allocated or treated as another owner.

## Required semantics and safety gates

1. The type checker validates a closed schema, exact resolved member IDs/types, fixed-size pointer-free transitive payloads, no forbidden lifecycle methods, bounded alignment/size arithmetic, no unsupported inheritance/virtual/resource ownership. Root `inverted struct` is a value schema, not a nominal class object.
2. `InvertedArray<T>` must be a language intrinsic with verified syntax/typing/ownership and physical SoA codegen, never a string/reflection macro. Normal `Array<T>` stays unchanged. Inverted row constructors must be accepted only through an explicit owner or explicit detached-snapshot operation.
3. `rows[i]` means a checked dense position; `rows[h]` means an opaque issued owner+slot+generation logical row identity. Neither exposes a raw pointer, and neither may outlive the owner. Swap deletion can move dense rows, but surviving handles follow their logical row. Deleted, stale, foreign, forged, closed and overflowed identities fail.
4. All row insertions/updates validate first; allocation or admission failures never produce partially visible rows. Every column has the same logical live length, and teardown scrubs/revokes storage and handles before arena reuse.
5. Single-field borrows are field-granular: any number of same-field readers, or one writer, while disjoint fields may be accessed independently. Resizing, swap-delete, conversion, close and owner move require **global loan quiescence**. No unproven `await`, Task or actor escape.
6. Reading a row snapshot detaches all packed child values. A live row projection is nonescaping; its methods operate on the authoritative (owner, row) fields, not a proxy object with a second mutable copy.
7. Explicit conversion may copy and yields a new owner. If a zero-copy transformation is ever admitted, it must invalidate the previous owner and prove exact allocation-layout compatibility.
8. Narrow initial scalar admission: signed `i64`, `f64` (including IEEE signed zero/NaN behavior) and canonical `bool`. Packed nested ordinary structs may contain only permitted fixed-width scalar members and explicitly supported nested ordinary packed values. Every backend must specify byte widths, padding, alignment, endian normalization and checked 32-bit offset arithmetic. The JS model is **not** the ABI.

## Acceptance matrix: do not mark parity from the model

| Backend | Required genuine guest evidence | Current certification |
| --- | --- | --- |
| Java / GraalVM | Source lexer/parser/type checker/ownership + compiled guest/JUnit, AOT where applicable | NOT_EXECUTED |
| LLVM native | Real typed AST/MIR → LLVM source, O0/O2 native, ASan/UBSan, pointer/loan rejection | NOT_EXECUTED |
| LLVM → Wasm32 | Actual compiler-generated Wasm, browser/Node, i64 exactness, bounds/growth, private owner memory | NOT_EXECUTED |
| .NET CIL / Native AOT | Typed CIL source lowering, independent unmanaged columns, published Native AOT process | NOT_EXECUTED |
| Forge | Independent source parser/lowering/JIT or AOT, native allocator and sanitizer runs | NOT_EXECUTED |
| JavaScript (optional sixth) | Source → ESM + actual Node/browser Worker execution | NOT_EXECUTED |

Each target must run the same positive and negative `.ores` fixtures (not merely parse text or run host unit tests), with exact source tree identities and nonzero job steps. Compiler failures must assert a compiler-owned diagnostic, not an arbitrary parser crash. Branch protection and private-carrier destination allowlisting must be independently authorized before any private source export; running this **source-free** model does not authorize a mirror.

## Reference model scope

`src/inverted-layout-reference.mjs` and `tests/inverted-layout.test.mjs` establish a runnable *logical storage/ownership oracle*: explicit named class/struct descriptors, one-level packed nested values, no recursive inverted nesting, typed field copies, generation/owner-issued handles, swap-delete, disjoint field loans and randomized differential checking. The model uses ordinary JavaScript arrays (NOT native contiguous typed columns), has no Oreslang frontend, and cannot prove GC, zero-alloc, SIMD, memory-safe FFI, native alignment, cross-domain suspension, GPU or backend parity.

Related existing trackers: Java #1424 and #2036; LLVM #658; Wasm #155; .NET #195; Forge #118; cross-backend draft conformance PR #195.
