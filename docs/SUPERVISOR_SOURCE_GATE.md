# Oreslang supervisor source admission contract (draft v1)

**This is a forward-looking semantic contract, NOT proof of `on_panic` source execution.**

A `define supervisor Name as ... end` declaration denotes an independently scheduled single-flight logical supervisor process with a reserved CONTROL lane. It does not denote a class, an actor mailbox in the child, or a method invoked directly on a failing child's carrier.

Initial mandatory hook: `on_panic(f: Failure): void`. The Java parser constructs a distinct `Ast.SupervisorDecl`; unsupported hooks and invalid typed signatures fail closed. Before actual lowering exists, compiler admission intentionally rejects the declaration rather than executing `on_panic` as an ordinary method. LLVM currently rejects the declaration at source admission with an explicit typed CONTROL-lowering diagnostic.

Required lowering gates:
1. Link a supervisor declaration to a private runtime process with immutable supervisor ID and inherited actor-family identity.
2. Materialize an owned, typed `Failure` payload after the failed actor has physically finalized.
3. Admit exactly one CONTROL turn on the supervisor's own single-flight logical lane; no host/guest callback on the failed child's stack.
4. On `await`, release the physical carrier but retain logical turn ownership and a generation-fenced continuation.
5. Authoritative decisions: STOP, RESTART (new generation), ESCALATE (parent CONTROL), ACKNOWLEDGE. Every side effect must commit or fail closed with visible diagnostics and bounded queues.
6. Preserve exception effects, LIFO `defer`, cancellation finalization, and actor memory isolation.
7. Prove the same observable guest fixture through Java/Graal and LLVM on private funded runners at an exact SHA, plus AOT/hybrid and ASan/UBSan.

The native typed panic bridge already proves host-level STOP and multiworker physical-finalization ordering. It does not prove any of the missing source-level execution gates.
