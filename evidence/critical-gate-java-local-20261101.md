# Java 21 critical-gate host verification — November 1, 2026

**Scope: host-only logical scheduler substrate, NOT compiler-generated Oreslang critical{} execution.**

- Source PR: https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2433
- Verified branch head: `ba9a1f7c761d355f07d290d1afbd417a5e7caf7f`
- Git tree: `f418f3fed4b8cd37594f2641437c11d6b5cb48e7`
- Runtime file `src/main/java/dev/oreslang/runtime/CriticalSectionGate.java` Git blob: `142a64d56ae22ddd2a0e1ca06136083894cb9bdf`
- Standalone test `src/test/java/dev/oreslang/CriticalSectionGateStandaloneTest.java` Git blob: `642f872e22dadbd8411e7c711326bb542db6c11a`
- JUnit test `src/test/java/dev/oreslang/CriticalSectionGateJUnitTest.java` Git blob: `4717862a85ceb6a5613611b6ecb1e2c3eb888573`

Local execution used OpenJDK 21, verified these Git blob identities using `git hash-object`, and compiled the two runtime/test sources via:

```sh
javac -Xlint:all -Werror -d classes \
  src/main/java/dev/oreslang/runtime/CriticalSectionGate.java \
  src/test/java/dev/oreslang/CriticalSectionGateStandaloneTest.java
java -ea -cp classes dev.oreslang.CriticalSectionGateStandaloneTest
```

**Result: `PASS host Java CriticalSectionGate assertions=9600`.** Three 300-round loops exercise FIFO, try-enter/no queue, bounded admission, duplicate identity rejection, stale generation, cancellation and reuse, pre-entry retirement, and retirement racing a physically executing Java callback. A tracked script at `scripts/verify-critical-substrate-host.sh` reproduces the test without Maven/Graal dependencies. The JUnit wrapper adds it to the repository's test suite.

**Compiler status:** `critical {}`, `critical gate {}` and `try critical ... else {}` now have dedicated Java AST nodes. The TypeChecker and both Graal interpreter paths reject them with `E_CRITICAL_UNLOWERED` until closed-world transitive-effect proof, a trusted gate binding, async scheduler handoff and guest unwind lowering are implemented. AST presence is not execution.

**Hosted CI:** Java PR head concurrency-contract run #41359140099 job #125005522992 and fast-ci run #41359140085 job #125005523189 both reported zero steps and failure. Classify **NOT_EXECUTED** due to runner admission, not failed tests.

**Remaining:** executable native guest fixture, compiler-proof of non-suspending bodies, bounded selector/CTRL admission, independent review and stepful exact-head CI.
