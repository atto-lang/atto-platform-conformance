# Java post-await panic and cleanup execution

- Java candidate commit `96efff7b2073f825d237ba5f30e0e06dcefc7c1a`. [Java #3117](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3117)
- [Guest fixture](https://github.com/ores-truffle-oreslang/oreslang-source.java/blob/96efff7b2073f825d237ba5f30e0e06dcefc7c1a/src/test/resources/exception-boundaries/actor_panic_after_await.atto), Git blob `7bcd0b3bc36fd39d0bd70934c14f0f67ac230edc`, SHA-256 `0cbba0f7324ec2db2250cc7cde8fae8791155b87a1a42dc36b49891f180a5026`.
- OpenJDK 25.0.5, Maven 3.9.9, Truffle 25.3.4.1 JVM interpreter. The prepared build matched 392 compiler, test and resource blobs from the parent, 127 additional repository fixture files and the three changed blobs from the candidate.
- Reproduce with `mvn -B -ntp -Dtest=TrapOptionSemanticsTest,TypedExceptionalEffectAdmissionTest,SourceActorEndCleanupExecutionTest,SourceBoundaryTraceTest test`. **31 tests passed, zero skipped.**
- The test evaluated the guest source through the OresLanguage polyglot entry point. It asserted a resumed `receive` task, panic propagation through `get_done()`, and exact output `resumed|inner|outer|`. Catch and normal completion markers were absent.
- The full Maven test selection ran 2,261 tests, with 8 failures, 4 errors and 2 skips. The parent revision ran 2,259 with 11 failures, 5 errors and 2 skips. All 12 remaining failures/errors also occurred on the parent. Four failed recovery tests passed after the change. The broader draft still has TrapResult/Option compatibility and other baseline failures.

Focused Maven log SHA-256 `485ec4a3a62d6263f4506ffa22bdf3e0ce9853478d52062be917c649570a4770`.

```text
28cd6113e662cd1212d68436b19522dac38d2fb4579aad87a01f5d4ea04aaf78  java-tools/baseline-full.log
406a92aef97ebdbee1dc11b2245afb20194725fd4426503121076f46350ee234  java-tools/full-with-fixtures.log
```

Supervisor CONTROL delivery under DATA saturation remains NOT_EXECUTED. The fixture observes actor-local cleanup and terminal failure only. Native Image and other backend runs of this fixture remain NOT_EXECUTED.
