# Universal tree-shaking contract v1

Oreslang backends must not invent independent definitions of "unused". The
front-end/build linker emits a backend-neutral reachability receipt using schema
`oreslang.reachability/1`; target backends may remove more implementation
detail, but they may not resurrect guest declarations that the common
reachability graph removed or silently remove declarations retained by it.

The receipt records:

- executable entry points or library-public-API mode;
- retained and removed guest symbols;
- external bindings still required after pruning;
- retained language features such as actors, channels, async, allocation and
  closures;
- retained compiler-owned runtime operations.

All set-like arrays are sorted and unique. Retained and removed symbol sets are
disjoint. Unknown fields fail closed so semantic changes require a schema
version bump.

This manifest is a **semantic reachability receipt**, not proof that the final
linker actually discarded bytes. Backend conformance therefore has two gates:

1. validate the receipt and compare expected reachability;
2. inspect the final artifact (native symbols/sections, JVM image modules, Wasm
   imports/functions, firmware sections, or hardware synthesis resources) and
   prove forbidden/dead components are absent.

Validate a manifest with:

```sh
node bin/verify-reachability-manifest.mjs /path/to/reachability.json
```

## Backend requirements

JVM/GraalVM, LLVM/native, Wasm, embedded/RTOS, mobile and desktop builds should
consume the same semantic receipt before target-specific DCE/LTO/linker-GC.
FPGA/ASIC flows should use the same roots to prune generated kernels/modules
before synthesis and then record synthesis-level resource evidence separately.

Dynamic loading, reflection, FFI, actor proxy/artifact admission and other
open-world mechanisms must add explicit roots or external/runtime requirements.
A backend must fail closed when it cannot prove such reachability.

## Size evidence

A smaller byte count alone is insufficient: a compiler can get smaller by
accidentally deleting live behavior. Conversely, a correct semantic manifest
alone does not prove the packaged executable is small. Release CI should retain
both the manifest and target-specific size/symbol evidence.
