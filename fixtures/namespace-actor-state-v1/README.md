# Namespace actor-state candidate fixtures

These are **authored future compiler targets**, not evidence that the current Atto parser accepts or executes them.

- `actor.atto`, `state.atto`, `methods.atto` form one manifest-locked three-file unit in namespace `foo`. Expected positive acceptance: exactly one nominal actor `Foo`, one sealed schema, one private lifecycle `init`, and exact actor-targeted public `bar` contract witness. Actual guest execution, mailbox scheduling and state mutation must be separately proved.
- `reject-direct-state.atto` is an independent negative compilation target. It must reject the attempted `u.x` write outside `handle_state`. It is NOT intended to be compiled in the same source set as the positive three-file case.
- More negatives required: duplicate state inline/out-of-line, forged state mode, await inside a loan, returned state reference, cross-namespace schema attachment, stale actor generation, private actor public method and inherited slot ambiguity.

Backend statuses remain `NOT_EXECUTED` in `../../contracts/namespace-actor-state-v1.json`. A source-free host-model pass is not compiler-backed evidence.
