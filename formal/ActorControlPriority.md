# Actor supervisor CONTROL/DATA protocol — bounded model

This independent, stdlib-only Python explicit-state model exhaustively enumerates all bounded interleavings with two generations, two DATA messages per generation, DATA capacity two, a separately reserved CONTROL slot and one non-preemptive physical execution carrier.

The verified ABSTRACT properties are:
- CONTROL stop admission stays possible with the DATA mailbox saturated; the next idle physical carrier dispatches CONTROL ahead of DATA, without preempting an already-running DATA turn.
- Stop fencing drains accepted queued DATA and terminates with no pending carrier or mailbox work.
- Stale generation-one envelopes are rejected when replayed after a restart into generation two.
- Each accepted DATA envelope belongs to exactly one of queued, in-flight, completed or explicitly cancelled. No successful settlement may happen twice.
- Both DATA and CONTROL mailboxes have bounded capacity.

The checker uses breadth-first search and produces a shortest discovered counterexample trace in JSON. Five required negative mutants demonstrate detection of priority bypass, stale authority admission, duplicate settlement, cancelled-envelope resurrection, and silent loss without settlement. Coverage tests assert reachable corner cases rather than freezing state counts.

Run on Python 3.10+ without dependencies:

    python3 -m unittest discover -s tests -p test_actor_control_formal.py -v
    python3 formal/actor_control_model.py --json
    python3 formal/actor_control_model.py --mutant priority --json
    python3 formal/actor_control_model.py --mutant stale-admission --json
    python3 formal/actor_control_model.py --mutant duplicate-settlement --json
    python3 formal/actor_control_model.py --mutant cancelled-resurrection --json
    python3 formal/actor_control_model.py --mutant lost-message --json

All five mutant invocations MUST fail with a nonzero exit status and identify, respectively, ControlPriority, QueueIncarnation, AtMostOnce, NoResurrection and DataConservation.

The NoResurrection invariant is checked *across* restart, not only at the instant of stopped state; stopped already entails empty queues, so a stop-only queue check is insufficient.

## Critical proof boundary

This is exhaustive FINITE-STATE MODEL checking, NOT a proof of implementation behavior, unbounded linearizability, scheduler fairness, real-time guarantees, physical kill, or cross-process delivery. To upgrade the evidence, independently instrument the exact-head Java and LLVM guest runtimes to emit actor ID, generation, ticket, lane, enqueue/accept/reject, physical carrier enter/leave, commit/cancel/fence/stop/restart. Check runtime traces against this model with overlapping STOP/data completion, full DATA mailbox, delayed stale delivery after restart and duplicate reply. An accepted message cancelled at shutdown is NOT the same event as an admission rejection.

The related contracts/actor-reliability-v1.json reports Java as foundation-in-progress and LLVM as not-certified. A green abstract model must NEVER promote either backend to certified. Model, executable guest trace refinement, and actual CI step evidence are separate gates.
