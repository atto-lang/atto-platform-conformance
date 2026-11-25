# Functor ADT v1 — 17-case immutable guest conformance corpus

**Java/GraalVM JVM and no-fallback Native Image AOT passed; five-backend parity not certified.**

Source: [Java draft PR #2830](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2830), immutable commit `faa149c6bcc7510a659c86499f614efdaffcc4e8`. Exact fixture subtree SHA `be201b1c667057582a6e7e53025bb1d1938179c6`. All 17 checked-in `.atto` fixtures have byte-identical Git blob hashes from that source: **two positive guest programs (36 assertions) and fifteen rejected compiler programs**.

**JVM/GraalVM actual guest PASS:** [private Actions #42957069176](https://github.com/numerics-atto/mirror-oreslang-source.java/actions/runs/42957069176), **three JUnit tests, zero failures/errors/skips, Maven BUILD SUCCESS**. Both positive programs were executed through the language Context after parse/typechecking, while all 15 negatives threw static-compiler errors.

**Native Image AOT actual guest PASS:** [private Actions #42957329288](https://github.com/numerics-atto/mirror-oreslang-source.java/actions/runs/42957329288), current source `faa149c...`, private carrier commit `57e8c563878bcc70e3bae75849946bba6dd00c41`. No-fallback executable was built successfully; `--build-info` reported `build_mode=aot`, `guest_execution=interpreter-no-jit`. It executed **both** real guest positives and compared exact outputs `FNV1:` + 16 ones + `:END` and `FNV2:` + 20 ones + `:END`; all **15 native compiler --check negatives** were rejected with a semantic/type-like diagnostic and were screened for common fatal runtime/bootstrap failures. The Native Image binary is compiled ahead of time; the guest executes inside its interpreter **without a JIT**, which must not be misrepresented as independent AOT codegen for every guest function.

**Exact source subset, not full tree:** Both private carrier workflows checked identical `src/main` (all 265 files), `stdlib`, `pom.xml`, and functor fixture subtree hashes against source PR. JVM also checked the selected official JUnit source hash. Unrelated historical test/docs source files were not fully mirrored; no cross-org secrets/tokens were used.

**Independent conformance SHA oracle:** [private Actions #42957635700](https://github.com/voxletra/voxletra-e2e/actions/runs/42957635700) verified the 17 initial case files and registry while no AOT receipt was claimed for the new head; final receipt must be independently retested after updating the registry. The Node integrity test does **not** compile or execute an AttoLang guest.

**Remaining unverified:** LLVM, Wasm, Forge, .NET Native AOT, Cranelift; full-source-tree parity; exact per-fixture diagnostic-category assertions; native guest machine-code generation separate from Native Image's interpreted guest execution. Keep this PR in draft pending multi-backend conformance.
