# Critical gate: exact Git blob Java 21 + LLVM native local validation (2026-11-02)

## Java/Graal source PR #2433 (host runtime only)

- PR head: `1d9e94a8aee687017eec4088e95988ca0664b0ae`; Git tree `58c948b56bb70a1a10ecc28a8d7eb6e9690ac167`.
- Byte-exact `src/main/java/dev/oreslang/runtime/CriticalSectionGate.java` Git blob: `e3e2a63dd6d4f5a0a407ee46acc400b2b58f2a9f`.
- Byte-exact checked-in `src/test/java/dev/oreslang/CriticalSectionGateStandaloneTest.java` Git blob: `e7136f75a94441578ec812479c574ce8bd2dd7ed`.
- Both blob hashes verified locally with `git hash-object`, matching the GitHub connector's file SHA.
- OpenJDK 21 host-only compilation: `javac -Xlint:all -Werror -d classes CriticalSectionGate.java CriticalSectionGateStandaloneTest.java`.
- **PASS 23,651** assertions from the actual committed standalone test, including 300 rounds of the new `whenReadyOn` exactly-one scheduler registration regression.
- A separate non-committed host audit (`GateAudit`) executed **PASS 19,205** checks, covering 10,000 logical protected increments, retirement, deferred delivery, and 8,192 scheduler-rejected waiters. The audit is supplemental, not the checked-in standalone suite.
- A duplicate registration was reproduced before the Java fix (`whenReadyOn` enqueued 2 tasks); after the fix only 1 registration was permitted, and all host tests passed.
- GitHub `fast-ci` run [41396105445](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/41396105445) job `125117658315` had **0 executed steps**, so hosted Java guest/JUnit/Graal checks remain **NOT_EXECUTED**.

## LLVM native host gate (exact current source)

- LLVM PR #1289 head `c31a5a633f476914c19f7f3938dcd21490660eb6`; Git tree `ac456ee9bcaeff13df23dd1f9b647df8ebfee464`.
- Exact Git blobs: `CriticalGate.hpp` `ecb65f1111a37f1ea0991a9ad03bdced2df6f50f`, `LogicalMutex.hpp` `f03082fc83ce645dd16c6db7aefa98a1d57be04d`, checked-in capacity/handoff test `eec7b97ae764f4cd31a8112d42d7da5ef1c83d4d`.
- Native C++17 GCC and Clang builds used `-O1 -g -Wall -Wextra -Wpedantic -Werror -pthread -fsanitize=address,undefined -fno-omit-frame-pointer`.
- **PASS 20,925** GCC assertions and **PASS 20,956** Clang assertions, including 8,192 FIFO waiters and 1,000 retirement-versus-handoff races; no ASan/UBSan findings.
- Both compilers accepted two scalar/void copy-out forms and rejected five unsupported protected borrow/aggregate escape forms: **7/7 compile checks each**.
- Native compiler/guest CI run [41394979327](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41394979327) job `125114240116` had **0 executed steps**; LLVM native guest compilation is **NOT_EXECUTED**.

## Scope and release hold

Java proof validates the *host-only scheduler primitive*, not language lowering, actor continuations or Graal guest fixtures. LLVM proof validates the *host runtime headers*, not compiler-generated `.ores` IR. The source-free conformance receipt is not guest parity. All five `guest_parity_verified` flags remain false.

Java source `main` branch is not protected; private cross-org source transfer requires reviewed policy, independent authorization and a permitted receiver. Do not use another organization's Actions minutes to bypass failed export controls. Governance issue: https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962 .

Gate the draft PRs until stepful exact-head end-to-end guest execution on an authorized runner.
