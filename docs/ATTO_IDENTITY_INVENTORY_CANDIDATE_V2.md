# Ownership identity inventory — portable candidate model

Every response is ok=false, verified=false, independentStorageVerified=false. JSON inputs are not authenticated compiler provenance.

src/ownership-identity-inventory-v1.mjs rejects zero/duplicate BindingIds and two live owned slots claiming the same positive allocation OriginId. It retains a moved historical source plus a live destination of the same origin, and permits borrowed views without owner elevation. Unknown OriginId zero is conservative. Malformed moved flags and forged positive status fields are rejected.

tests/ownership-identity-inventory-v1.test.mjs adds 15 cases, 15/15 passed using exact authored sources in isolated V8. Four deliberately weakened variants were detected: bypassing duplicate bindings, bypassing live owner collision, forged verified=true, or accepting malformed places. The full source-only isolated suite is 143/143 and the hosted Node workflow expects 144 groups including one actual CLI subprocess group NOT_EXECUTED in isolated V8.

The portable AttoLang guest corpus remains 18 candidate fixtures. LLVM adds 30 host C++ invariants; Java adds 15 real-parser/checker JUnit candidates. None of these evidence types may be conflated. Real source-org CI with nonzero executed steps, independent review and compiler-backed guest receipts remain required.
