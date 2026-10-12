----------------------- MODULE SupervisorAdmissionLease -----------------------
EXTENDS Naturals, TLC

(*
 * A bounded RESTART publication transaction. Admission holds a scheduler-
 * owned physical generation gate, while STOP and global shutdown request
 * retirement but cannot apply it until the gate is released.
 *
 * Candidate is hidden from the ordinary message path until the same
 * publication transaction commits supervisor identity and routing.
 * The model abstracts out registry/hash-map allocation failure and assumes
 * that route publication inside a valid lease is an infallible state flip.
 *
 * A pending STOP may overlap the publication transaction; it linearizes as
 * actual physical retirement only after release. This is safety only, not
 * a liveness proof of a blocking host publication gate.
 *)
CONSTANT MaxLease
ASSUME MaxLease \in Nat \\ {0}

VARIABLES phase, physical, gate, issued, lease, committedLease,
          routed, committed, stopRequested, closeRequested, closed, stopApplied

vars == <<phase, physical, gate, issued, lease, committedLease,
          routed, committed, stopRequested, closeRequested, closed, stopApplied>>

Init ==
  /\ phase = "Finalized"
  /\ physical = "None"
  /\ gate = FALSE
  /\ issued = 0
  /\ lease = 0
  /\ committedLease = 0
  /\ routed = FALSE
  /\ committed = FALSE
  /\ stopRequested = FALSE
  /\ closeRequested = FALSE
  /\ closed = FALSE
  /\ stopApplied = FALSE

Reserve ==
  /\ phase = "Finalized"
  /\ ~closeRequested
  /\ phase' = "Reserved"
  /\ UNCHANGED <<physical, gate, issued, lease, committedLease,
                 routed, committed, stopRequested, closeRequested, closed, stopApplied>>

Spawn ==
  /\ phase = "Reserved"
  /\ physical = "None"
  /\ ~closeRequested
  /\ physical' = "Unpublished"
  /\ UNCHANGED <<phase, gate, issued, lease, committedLease,
                 routed, committed, stopRequested, closeRequested, closed, stopApplied>>

Acquire ==
  /\ phase = "Reserved"
  /\ physical = "Unpublished"
  /\ ~gate
  /\ ~stopRequested
  /\ ~closeRequested
  /\ issued < MaxLease
  /\ gate' = TRUE
  /\ issued' = issued + 1
  /\ lease' = issued + 1
  /\ UNCHANGED <<phase, physical, committedLease,
                 routed, committed, stopRequested, closeRequested, closed, stopApplied>>

RequestStop ==
  /\ physical \in {"Unpublished", "Published"}
  /\ ~stopRequested
  /\ stopRequested' = TRUE
  /\ UNCHANGED <<phase, physical, gate, issued, lease, committedLease,
                 routed, committed, closeRequested, closed, stopApplied>>

RequestClose ==
  /\ ~closeRequested
  /\ closeRequested' = TRUE
  /\ UNCHANGED <<phase, physical, gate, issued, lease, committedLease,
                 routed, committed, stopRequested, closed, stopApplied>>

Commit ==
  /\ phase = "Reserved"
  /\ physical = "Unpublished"
  /\ gate
  /\ lease > 0
  /\ ~closed
  /\ ~stopApplied
  /\ phase' = "Active"
  /\ physical' = "Published"
  /\ routed' = TRUE
  /\ committed' = TRUE
  /\ committedLease' = lease
  /\ UNCHANGED <<gate, issued, lease, stopRequested,
                 closeRequested, closed, stopApplied>>

Release ==
  /\ gate
  /\ gate' = FALSE
  /\ lease' = 0
  /\ UNCHANGED <<phase, physical, issued, committedLease,
                 routed, committed, stopRequested, closeRequested, closed, stopApplied>>

ApplyStop ==
  /\ stopRequested
  /\ ~gate
  /\ physical \in {"Unpublished", "Published"}
  /\ physical' = "Done"
  /\ stopApplied' = TRUE
  /\ routed' = FALSE
  /\ UNCHANGED <<phase, gate, issued, lease, committedLease,
                 committed, stopRequested, closeRequested, closed>>

ApplyClose ==
  /\ closeRequested
  /\ ~gate
  /\ ~closed
  /\ closed' = TRUE
  /\ physical' = IF physical \in {"Unpublished", "Published"}
                    THEN "Done" ELSE physical
  /\ routed' = FALSE
  /\ stopApplied' = TRUE
  /\ UNCHANGED <<phase, gate, issued, lease, committedLease,
                 committed, stopRequested, closeRequested>>

Cleanup ==
  /\ phase = "Reserved"
  /\ ~gate
  /\ physical = "Unpublished"
  /\ physical' = "Done"
  /\ UNCHANGED <<phase, gate, issued, lease, committedLease,
                 routed, committed, stopRequested, closeRequested, closed, stopApplied>>

Abort ==
  /\ phase = "Reserved"
  /\ ~gate
  /\ physical \in {"None", "Done"}
  /\ phase' = "Finalized"
  /\ physical' = "None"
  /\ UNCHANGED <<gate, issued, lease, committedLease,
                 routed, committed, stopRequested, closeRequested, closed, stopApplied>>

Next ==
  \/ Reserve \/ Spawn \/ Acquire \/ RequestStop \/ RequestClose
  \/ Commit \/ Release \/ ApplyStop \/ ApplyClose \/ Cleanup \/ Abort

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in {"Finalized", "Reserved", "Active"}
  /\ physical \in {"None", "Unpublished", "Published", "Done"}
  /\ gate \in BOOLEAN
  /\ issued \in 0..MaxLease
  /\ lease \in 0..MaxLease
  /\ committedLease \in 0..MaxLease
  /\ routed \in BOOLEAN
  /\ committed \in BOOLEAN
  /\ stopRequested \in BOOLEAN
  /\ closeRequested \in BOOLEAN
  /\ closed \in BOOLEAN
  /\ stopApplied \in BOOLEAN

LeaseCoherent == gate <=> lease > 0

NoUnleasedCommit ==
  committed => committedLease > 0 /\ committedLease <= issued

NoPrematureRoute ==
  routed => physical = "Published" /\ phase = "Active" /\ committed

NoRetirementDuringLease ==
  gate => ~stopApplied

NoClosedGate ==
  closed => ~gate

(* Negative control: publication with a Boolean readiness snapshot but no
 * scheduler lease. It has no authoritative admission nonce. *)
UnsafeCommitWithoutLease ==
  /\ phase = "Reserved"
  /\ physical = "Unpublished"
  /\ ~gate
  /\ ~closed
  /\ phase' = "Active"
  /\ physical' = "Published"
  /\ routed' = TRUE
  /\ committed' = TRUE
  /\ committedLease' = 0
  /\ UNCHANGED <<gate, issued, lease, stopRequested,
                 closeRequested, closed, stopApplied>>

(* Negative control: STOP invalidates the physical actor despite another
 * host transaction still holding the admission gate. *)
UnsafeStopThroughGate ==
  /\ gate
  /\ physical = "Unpublished"
  /\ physical' = "Done"
  /\ stopApplied' = TRUE
  /\ routed' = FALSE
  /\ UNCHANGED <<phase, gate, issued, lease, committedLease,
                 committed, stopRequested, closeRequested, closed>>

MutantPublishNext == Next \/ UnsafeCommitWithoutLease
MutantStopNext == Next \/ UnsafeStopThroughGate
MutantPublishSpec == Init /\ [][MutantPublishNext]_vars
MutantStopSpec == Init /\ [][MutantStopNext]_vars

=============================================================================
