# AttoLang NLL last-use candidates and source-free runner admission canary

The JS last-use/field-reinit model is NON-PROMOTING and every result remains ok=false and verified=false. It rejects ambiguous or incomplete lexical loan-use claims, branch paths, hidden uses, and reinitialization without an exactly moved owner and source write. This cannot authenticate SSA/MIR use-def completeness or allow compiler acceptance.

The new 20 source-only test groups passed in isolated V8. The inherited 143 groups plus 20 new ones yield 163 source-only groups; the source-owned Node workflow requires 164 groups including one CLI subprocess test not executed in isolated V8. No hosted Node or .atto guest proof is claimed.

.github/workflows/atto-runner-admission-canary.yml is a source-free Ubuntu Actions job in this same organization: no checkout, secrets, artifacts or private code export. Only a real assigned runner and completed job step emitting ATTO_SOURCE_FREE_ADMISSION=STEP_EXECUTED establishes runner admission. A job with steps=null remains RUNNER_ADMISSION / NOT_EXECUTED and cannot be counted as a test run. Examine actual Actions annotations, organization budgets and runner eligibility without inferring a specific cause.

Remaining gates: source-owned LLVM native CTests, Java parser/ownership JUnit, SSA last-use completeness, exact guest semantics, independent review and backend parity across LLVM, Java, .NET NativeAOT, Wasm and Forge/Cranelift.
