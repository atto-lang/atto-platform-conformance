------------------------ MODULE SupervisorCrashEscrowV2 ------------------------
EXTENDS Naturals, FiniteSets

\* Trusted host CONTROL reference, finite R->S->T->A; B is a sibling of S.
\* Per-node terminal slot is pre-reserved. R is a live in-process guardian.
\* This does NOT model native resources, guest code or process-wide crashes.
Nodes == {"R", "S", "T", "A", "B"}
Managed == {"S", "T", "A"}
Phases == {"running", "failed", "stopping", "retired", "reclaimed"}
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
Ancestors(n) ==
    IF n = "S" THEN {"R"}
    ELSE IF n = "T" THEN {"R", "S"}
    ELSE IF n = "A" THEN {"R", "S", "T"}
    ELSE {}

VARIABLES phase, generation, fenced, loans, pending,
          deliveredTo, deliveredGeneration
vars == <<phase, generation, fenced, loans, pending,
          deliveredTo, deliveredGeneration>>

Init ==
    /\ phase = [n \in Nodes |-> "running"]
    /\ generation = [n \in Nodes |-> 1]
    /\ fenced = [n \in Nodes |-> FALSE]
    /\ loans = [n \in Nodes |-> 1]
    /\ pending = [n \in Nodes |-> 0]
    /\ deliveredTo = [n \in Nodes |-> "none"]
    /\ deliveredGeneration = [n \in Nodes |-> 0]

\* The parent can die between delivery and policy acknowledgment. A stale
\* previously delivered grant remains in the ledger until re-delivery, but
\* no longer authorizes acknowledgment.
Healthy(n) == phase[n] = "running" /\ ~fenced[n]
Controller(n) ==
    IF n = "S" THEN "R"
    ELSE IF n = "T" THEN
        (IF Healthy("S") THEN "S" ELSE "R")
    ELSE
        (IF Healthy("T") THEN "T"
         ELSE IF Healthy("S") THEN "S"
         ELSE "R")

Crash(n) ==
    /\ n \in Managed
    /\ phase[n] = "running"
    \* Even an already-fenced in-flight descendant may still fail.
    /\ phase' = [phase EXCEPT ![n] = "failed"]
    /\ fenced' = [i \in Nodes |->
         IF i = n \/ i \in Descendants(n) THEN TRUE ELSE fenced[i]]
    /\ pending' = [pending EXCEPT ![n] = generation[n]]
    /\ deliveredTo' = [deliveredTo EXCEPT ![n] = "none"]
    /\ deliveredGeneration' = [deliveredGeneration EXCEPT ![n] = 0]
    /\ UNCHANGED <<generation, loans>>

Deliver(n) ==
    /\ n \in Managed
    /\ pending[n] = generation[n]
    /\ ~(deliveredTo[n] = Controller(n) /\
         deliveredGeneration[n] = generation[Controller(n)])
    /\ deliveredTo' = [deliveredTo EXCEPT ![n] = Controller(n)]
    /\ deliveredGeneration' =
         [deliveredGeneration EXCEPT ![n] = generation[Controller(n)]]
    /\ UNCHANGED <<phase, generation, fenced, loans, pending>>

Acknowledge(n) ==
    /\ n \in Managed
    /\ pending[n] = generation[n]
    /\ deliveredTo[n] = Controller(n)
    /\ deliveredGeneration[n] = generation[Controller(n)]
    /\ Healthy(Controller(n))
    /\ pending' = [pending EXCEPT ![n] = 0]
    /\ deliveredTo' = [deliveredTo EXCEPT ![n] = "none"]
    /\ deliveredGeneration' = [deliveredGeneration EXCEPT ![n] = 0]
    /\ UNCHANGED <<phase, generation, fenced, loans>>

BeginStop(n) ==
    /\ n \in Managed
    /\ (phase[n] = "failed" \/ (phase[n] = "running" /\ fenced[n]))
    /\ phase' = [phase EXCEPT ![n] = "stopping"]
    /\ UNCHANGED <<generation, fenced, loans, pending,
                   deliveredTo, deliveredGeneration>>

PhysicalDone(n) ==
    /\ n \in Managed
    /\ phase[n] = "stopping"
    /\ loans[n] = 1
    /\ phase' = [phase EXCEPT ![n] = "retired"]
    /\ loans' = [loans EXCEPT ![n] = 0]
    /\ UNCHANGED <<generation, fenced, pending, deliveredTo,
                   deliveredGeneration>>

ChildrenReclaimed(n) ==
    \A c \in Children(n) : phase[c] = "reclaimed"

Reclaim(n) ==
    /\ n \in Managed
    /\ phase[n] = "retired"
    /\ loans[n] = 0
    /\ pending[n] = 0
    /\ ChildrenReclaimed(n)
    /\ phase' = [phase EXCEPT ![n] = "reclaimed"]
    /\ UNCHANGED <<generation, fenced, loans, pending, deliveredTo,
                   deliveredGeneration>>

Restart(n) ==
    /\ n \in Managed
    /\ phase[n] = "reclaimed"
    /\ generation[n] = 1
    /\ Healthy(Parent(n))
    /\ phase' = [phase EXCEPT ![n] = "running"]
    /\ generation' = [generation EXCEPT ![n] = @ + 1]
    /\ fenced' = [fenced EXCEPT ![n] = FALSE]
    /\ loans' = [loans EXCEPT ![n] = 1]
    /\ UNCHANGED <<pending, deliveredTo, deliveredGeneration>>

Next ==
    \E n \in Managed :
        Crash(n) \/ Deliver(n) \/ Acknowledge(n) \/ BeginStop(n) \/
        PhysicalDone(n) \/ Reclaim(n) \/ Restart(n)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ phase \in [Nodes -> Phases]
    /\ generation \in [Nodes -> 1..2]
    /\ fenced \in [Nodes -> BOOLEAN]
    /\ loans \in [Nodes -> 0..1]
    /\ pending \in [Nodes -> 0..2]
    /\ deliveredTo \in [Nodes -> Nodes \cup {"none"}]
    /\ deliveredGeneration \in [Nodes -> 0..2]

RootAndSiblingSurvive ==
    /\ Healthy("R") /\ Healthy("B")
    /\ generation["B"] = 1

FailureFencesDescendants ==
    \A n \in Managed :
        phase[n] = "failed" =>
           (fenced[n] /\ \A d \in Descendants(n) : fenced[d])

NoOrphanLiveActor ==
    \A n \in Managed :
        Healthy(n) => (\A a \in Ancestors(n) : Healthy(a))

NoPrematureReclaim ==
    \A n \in Managed :
        phase[n] = "reclaimed" =>
        (loans[n] = 0 /\ pending[n] = 0 /\ ChildrenReclaimed(n))

NoUnfencedFailedNode ==
    \A n \in Managed :
        phase[n] \in {"failed", "stopping"} => fenced[n]

PendingGenerationBound ==
    \A n \in Managed :
        pending[n] # 0 => pending[n] = generation[n]

NoDeliveryWithoutEscrow ==
    \A n \in Managed :
        (pending[n] = 0) =>
           (deliveredTo[n] = "none" /\ deliveredGeneration[n] = 0)

RunningOwnsLoan ==
    \A n \in Nodes : phase[n] = "running" => loans[n] = 1

Safety ==
    TypeOK /\ RootAndSiblingSurvive /\ FailureFencesDescendants /\
    NoOrphanLiveActor /\ NoPrematureReclaim /\ NoUnfencedFailedNode /\
    PendingGenerationBound /\ NoDeliveryWithoutEscrow /\ RunningOwnsLoan
=============================================================================