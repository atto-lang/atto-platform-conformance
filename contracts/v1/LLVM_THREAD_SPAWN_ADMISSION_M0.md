# AttoLang LLVM thread.spawn M0 compiler-admission fixtures

Status: **DRAFT COMPILER ADMISSION ONLY — not runnable thread guest parity.**

The canonical source extension for every fixture is `.atto`. This matrix
tests the currently unsupported native source boundary in LLVM PR #1345 / #1357.
It is deliberately separate from the 38 target requirements in
`thread-task-actor-local-v1.json`.

- Ten negative sources must terminate with nonzero exit, empty stdout, a
  `THREAD_SPAWN_BACKEND_UNSUPPORTED` diagnostic, no visible or hidden artifact
  in the isolated case working directory, and unchanged source SHA256.
- The positive control, a normal user function named `thread`, must compile
  successfully and emit LLVM IR. All eleven paths are real `.atto` files.
- The checker invokes a configured compiler binary directly with `shell:false`,
  bounds per-case time/output, and records a compiler SHA256.
- A missing binary is `NOT_EXECUTED`; a direct CLI invocation without one
  exits nonzero. Caller-supplied LLVM Git commit/tree fields are marked
  **supplied, not attested**. This checker never asserts that the binary was
  built from those fields. That binding requires an exact-head CI checkout,
  compiler build receipt, and independent verification.
- A compiler admission PASS is not a guest OS-thread spawn PASS. The source
  parser remains fail-closed until compiled `ThreadSpawn` ownership proofs,
  isolate-scoped thread admission and nonblocking scheduler joins are tested.

Run after building the actual LLVM compiler:

```sh
node src/llvm-thread-spawn-m0.mjs \
  --compiler=/absolute/path/to/oreslang-llvmc \
  --head=40_lowercase_hex_head_sha \
  --tree=40_lowercase_hex_tree_sha
```

Run the source-free harness tests with
`node --test tests/llvm-thread-spawn-m0.test.mjs`. The included mock compiler
tests the checker, **never** the language implementation.

Actual LLVM thread parity additionally requires a real compiled `.atto`
program launching four OS threads with correctly owned capture data, safe
nonblocking joins, cancellation/tenant-generation fences, and zero leaked
native handles. Compiler admission is only M0.
