----------------------- MODULE ActorMailboxSafety -----------------------
EXTENDS Naturals, Sequences, FiniteSets, TLC

(*
  Bounded actor mailbox reference, NOT a proof of compiled Atto code.
  Two DATA identities per generation, two generations, DATA capacity two.
  A CONTROL notice uses a separate reserved lane.
  Unsafe toggles are independently exercised by TLC in CI.
*)
CONSTANTS UnsafePriority, UnsafeStale, UnsafeLost
ASSUME /\ UnsafePriority \in BOOLEAN
       /\ UnsafeStale \in BOOLEAN
       /\ UnsafeLost \in BOOLEAN

Messages == {"m1", "m2", "m3", "m4"}
Owner(m) == IF m \in {"m1", "m2"} THEN 1 ELSE 2
Capacity == 2

VARIABLES generation, phase, queue, accepted, completed, cancelled,
          control, active, stale_checked, overtook
vars == <<generation, phase, queue, accepted, completed, cancelled,
          control, active, stale_checked, overtook>>

QueueSet == {queue[i] : i \in 1..Len(queue)}
Flight == IF active = "none" THEN {} ELSE {active}

Init ==
  /\ generation = 1
  /\ phase = "live"
  /\ queue = <<>>
  /\ accepted = {}
  /\ completed = {}
  /\ cancelled = {}
  /\ control = FALSE
  /\ active = "none"
  /\ stale_checked = FALSE
  /\ overtook = FALSE

Admit(m) ==
  /\ phase = "live"
  /\ Owner(m) = generation
  /\ m \notin accepted
  /\ Len(queue) < Capacity
  /\ queue' = Append(queue, m)
  /\ accepted' = accepted \cup {m}
  /\ UNCHANGED <<generation, phase, completed, cancelled,
                 control, active, stale_checked, overtook>>

RequestControl ==
  /\ phase = "live"
  /\ ~control
  /\ control' = TRUE
  /\ UNCHANGED <<generation, phase, queue, accepted, completed,
                 cancelled, active, stale_checked, overtook>>

DispatchData ==
  /\ phase = "live"
  /\ active = "none"
  /\ ~control
  /\ Len(queue) > 0
  /\ active' = Head(queue)
  /\ queue' = Tail(queue)
  /\ UNCHANGED <<generation, phase, accepted, completed, cancelled,
                 control, stale_checked, overtook>>

CompleteData ==
  /\ phase = "live"
  /\ active \in Messages
  /\ completed' = completed \cup {active}
  /\ active' = "none"
  /\ UNCHANGED <<generation, phase, queue, accepted, cancelled,
                 control, stale_checked, overtook>>

DispatchControl ==
  /\ phase = "live"
  /\ control
  /\ active = "none"
  /\ control' = FALSE
  /\ phase' = "fenced"
  /\ UNCHANGED <<generation, queue, accepted, completed, cancelled,
                 active, stale_checked, overtook>>

FinalizeStop ==
  /\ phase = "fenced"
  /\ active = "none"
  /\ phase' = "stopped"
  /\ cancelled' = cancelled \cup QueueSet
  /\ queue' = <<>>
  /\ UNCHANGED <<generation, accepted, completed, control,
                 active, stale_checked, overtook>>

Restart ==
  /\ phase = "stopped"
  /\ generation = 1
  /\ generation' = 2
  /\ phase' = "live"
  /\ stale_checked' = FALSE
  /\ UNCHANGED <<queue, accepted, completed, cancelled, control,
                 active, overtook>>

RejectStale ==
  /\ phase = "live"
  /\ generation = 2
  /\ ~stale_checked
  /\ stale_checked' = TRUE
  /\ UNCHANGED <<generation, phase, queue, accepted, completed,
                 cancelled, control, active, overtook>>

(* Three independent intentional bugs with falsifiable counterexamples. *)
UnsafeOvertake ==
  /\ UnsafePriority
  /\ phase = "live"
  /\ control
  /\ active = "none"
  /\ Len(queue) > 0
  /\ active' = Head(queue)
  /\ queue' = Tail(queue)
  /\ overtook' = TRUE
  /\ UNCHANGED <<generation, phase, accepted, completed, cancelled,
                 control, stale_checked>>

UnsafeAdmitStale ==
  /\ UnsafeStale
  /\ phase = "live"
  /\ generation = 2
  /\ ~stale_checked
  /\ "m1" \notin accepted
  /\ Len(queue) < Capacity
  /\ queue' = Append(queue, "m1")
  /\ accepted' = accepted \cup {"m1"}
  /\ stale_checked' = TRUE
  /\ UNCHANGED <<generation, phase, completed, cancelled,
                 control, active, overtook>>

UnsafeLoseHead ==
  /\ UnsafeLost
  /\ phase = "live"
  /\ Len(queue) > 0
  /\ queue' = Tail(queue)
  /\ UNCHANGED <<generation, phase, accepted, completed, cancelled,
                 control, active, stale_checked, overtook>>

Next ==
  \/ \E m \in Messages : Admit(m)
  \/ RequestControl
  \/ DispatchData
  \/ CompleteData
  \/ DispatchControl
  \/ FinalizeStop
  \/ Restart
  \/ RejectStale
  \/ UnsafeOvertake
  \/ UnsafeAdmitStale
  \/ UnsafeLoseHead

TypeOK ==
  /\ generation \in {1, 2}
  /\ phase \in {"live", "fenced", "stopped"}
  /\ queue \in Seq(Messages)
  /\ accepted \subseteq Messages
  /\ completed \subseteq Messages
  /\ cancelled \subseteq Messages
  /\ control \in BOOLEAN
  /\ active \in Messages \cup {"none"}
  /\ stale_checked \in BOOLEAN
  /\ overtook \in BOOLEAN

QueueCapacity == Len(queue) <= Capacity
NoQueueDuplicates == Len(queue) = Cardinality(QueueSet)
OnlyCurrentGeneration ==
  /\ \A m \in QueueSet : Owner(m) = generation
  /\ \A m \in Flight : Owner(m) = generation
ControlNeverOvertaken == ~overtook
UniqueDisposition ==
  /\ (QueueSet \cap completed) = {}
  /\ (QueueSet \cap cancelled) = {}
  /\ (Flight \cap QueueSet) = {}
  /\ (Flight \cap completed) = {}
  /\ (Flight \cap cancelled) = {}
  /\ (completed \cap cancelled) = {}
Conservation ==
  /\ accepted = QueueSet \cup Flight \cup completed \cup cancelled
  /\ Cardinality(accepted) =
       Cardinality(QueueSet) + Cardinality(Flight) +
       Cardinality(completed) + Cardinality(cancelled)
TerminalDrained ==
  (phase = "stopped") => (queue = <<>> /\ active = "none" /\ ~control)

Spec == Init /\ [][Next]_vars
=============================================================================
