------------------------ MODULE SupervisorCrashTreeV1 ------------------------
EXTENDS Naturals, FiniteSets

\* Finite trusted-guardian model: R -> S -> T -> A, with unaffected sibling B
\* under R. R is an in-process CONTROL authority; host/OS death is out of scope.
\* This intentionally models no recovery after epoch 2.
Nodes == {"R", "S", "T", "A", "B"}
Managed == {"S", "T", "A"}
PhaseNames == {"running", "failed", "stopping", "retired", "reclaimed"}

Parent(n) ==
    IF n = "S" THEN "R"
    ELSE IF n = "T" THEN "S"
    ELSE IF n = "A" THEN "T"
    ELSE "R"

Children(n) ==
    IF n = "R" THEN {"S", "B"}
    ELSE IF n = "S" THEN {"T"}
    ELSE IF n = "T" THEN {"A"}
    ELSE {}

Descendants(n) ==
    IF n = "S" THEN {"T", "A"}
    ELSE IF n = "T" THEN {"A"}
    ELSE {}

VARIABLES phase, generation, fenced, loans, pending
vars == <<phase, generation, fenced, loans, pending>>

Init ==
    /\ phase = [n \in Nodes |-> "running"]
    /\ generation = [n \in Nodes |-> 1]
    /\ fenced = [n \in Nodes |-> FALSE]
    /\ loans = [n \in Nodes |-> 1]
    /\ pending = [n \in Nodes |-> 0]

Controller(n) ==
    IF n = "S" THEN "R"
    ELSE IF n = "T" THEN
        (IF phase["S"] = "running" /\ ~fenced["S"] THEN "S" ELSE "R")
    ELSE
        (IF phase["T"] = "running" /\ ~fenced["T"] THEN "T"
         ELSE IF phase["S"] = "running" /\ ~fenced["S"] THEN "S"
         ELSE "R")

\* Crash atomically closes subtree admission and escrows one failure notice.
Crash(n) ==
    /\ n \in Managed
    /\ phase[n] = "running"
    /\ ~fenced[n]
    /\ generation[n] = 1
    /\ phase' = [phase EXCEPT ![n] = "failed"]
    /\ fenced' = [i \in Nodes |->
        IF i = n \/ i \in Descendants(n) THEN TRUE ELSE fenced[i]]
    /\ pending' = [pending EXCEPT ![n] = generation[n]]
    /\ UNCHANGED <<generation, loans>>

\* Delivered to nearest still-authorized live ancestor, never to a dead
\* supervisor. A physical production receipt must bind this same generation.
Acknowledge(n) ==
    /\ n \in Managed
    /\ pending[n] = generation[n]
    /\ phase[Controller(n)] = "running"
    /\ ~fenced[Controller(n)]
    /\ pending' = [pending EXCEPT ![n] = 0]
    /\ UNCHANGED <<phase, generation, fenced, loans>>

BeginStop(n) ==
    /\ n \in Managed
    /\ (phase[n] = "failed" \/ (phase[n] = "running" /\ fenced[n]))
    /\ phase' = [phase EXCEPT ![n] = "stopping"]
    /\ UNCHANGED <<generation, fenced, loans, pending>>

PhysicalDone(n) ==
    /\ n \in Managed
    /\ phase[n] = "stopping"
    /\ loans[n] = 1
    /\ phase' = [phase EXCEPT ![n] = "retired"]
    /\ loans' = [loans EXCEPT ![n] = 0]
    /\ UNCHANGED <<generation, fenced, pending>>

ChildrenReclaimed(n) ==
    \A c \in Children(n) : phase[c] = "reclaimed"

Reclaim(n) ==
    /\ n \in Managed
    /\ phase[n] = "retired"
    /\ loans[n] = 0
    /\ pending[n] = 0
    /\ ChildrenReclaimed(n)
    /\ phase' = [phase EXCEPT ![n] = "reclaimed"]
    /\ UNCHANGED <<generation, fenced, loans, pending>>

Restart(n) ==
    /\ n \in Managed
    /\ phase[n] = "reclaimed"
    /\ generation[n] = 1
    /\ phase[Parent(n)] = "running"
    /\ ~fenced[Parent(n)]
    /\ phase' = [phase EXCEPT ![n] = "running"]
    /\ generation' = [generation EXCEPT ![n] = @ + 1]
    /\ fenced' = [fenced EXCEPT ![n] = FALSE]
    /\ loans' = [loans EXCEPT ![n] = 1]
    /\ UNCHANGED pending

Next ==
    \E n \in Managed :
        Crash(n) \/ Acknowledge(n) \/ BeginStop(n) \/
        PhysicalDone(n) \/ Reclaim(n) \/ Restart(n)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ phase \in [Nodes -> PhaseNames]
    /\ generation \in [Nodes -> 1..2]
    /\ fenced \in [Nodes -> BOOLEAN]
    /\ loans \in [Nodes -> 0..1]
    /\ pending \in [Nodes -> 0..2]

GuardianAndSiblingSurvive ==
    /\ phase["R"] = "running" /\ ~fenced["R"]
    /\ phase["B"] = "running" /\ ~fenced["B"]
    /\ generation["B"] = 1

FailureFencesDescendants ==
    \A n \in Managed :
      (phase[n] = "failed") =>
        (fenced[n] /\ \A d \in Descendants(n) : fenced[d])

NeverReclaimLiveLoans ==
    \A n \in Managed :
      (phase[n] = "reclaimed") =>
        (loans[n] = 0 /\ pending[n] = 0 /\ ChildrenReclaimed(n))

PendingNoticeHasController ==
    \A n \in Managed :
      (pending[n] # 0) =>
        (pending[n] = generation[n] /\
         phase[Controller(n)] = "running" /\ ~fenced[Controller(n)])

RunningHasLiveGeneration ==
    \A n \in Nodes : (phase[n] = "running") => loans[n] = 1

Ancestors(n) ==
    IF n = "S" THEN {"R"}
    ELSE IF n = "T" THEN {"R", "S"}
    ELSE {"R", "S", "T"}

NoLiveUnfencedChildOfFailedAncestor ==
    \A n \in Managed :
      (phase[n] = "running" /\ ~fenced[n]) =>
        (\A a \in Ancestors(n) : phase[a] # "failed")

Safety ==
    TypeOK /\ GuardianAndSiblingSurvive /\ FailureFencesDescendants /\
    NeverReclaimLiveLoans /\ PendingNoticeHasController /\
    RunningHasLiveGeneration /\ NoLiveUnfencedChildOfFailedAncestor
=============================================================================