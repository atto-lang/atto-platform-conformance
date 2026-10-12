---------------------- MODULE SupervisorInitialAdmission ----------------------
EXTENDS Naturals, FiniteSets, TLC

(*
 * Bounded host-only initial child registration vs physical STOP and
 * supervisor close. A scheduler registration lease pins an already published
 * physical actor generation until logical registration commits. Reincarnation
 * uses monotonically increasing generation, never reuses a previous key.
 *
 * CONTROL close requests are allowed while the host transaction is in
 * progress, but actual closure linearizes after outstanding leases release.
 * This proves safety of an abstraction, not Java/LLVM implementation
 * refinement or unconditional liveness.
 *)
CONSTANTS Actors, MaxGeneration
ASSUME /\ IsFiniteSet(Actors)
       /\ Actors # {}
       /\ MaxGeneration \in Nat \ {0}

VARIABLES physical, published, generation, leased, requestedStop,
          registered, registeredAt, provedAt, closeRequested, closed

vars == <<physical, published, generation, leased, requestedStop,
          registered, registeredAt, provedAt, closeRequested, closed>>

Init ==
    /\ physical = [a \in Actors |-> "Ready"]
    /\ published = [a \in Actors |-> TRUE]
    /\ generation = [a \in Actors |-> 1]
    /\ leased = [a \in Actors |-> FALSE]
    /\ requestedStop = [a \in Actors |-> FALSE]
    /\ registered = [a \in Actors |-> FALSE]
    /\ registeredAt = [a \in Actors |-> 0]
    /\ provedAt = [a \in Actors |-> 0]
    /\ closeRequested = FALSE
    /\ closed = FALSE

AcquireRegistration(a) ==
    /\ ~closed
    /\ physical[a] = "Ready"
    /\ published[a]
    /\ ~requestedStop[a]
    /\ ~leased[a]
    /\ ~registered[a]
    /\ leased' = [leased EXCEPT ![a] = TRUE]
    /\ UNCHANGED <<physical, published, generation, requestedStop,
                   registered, registeredAt, provedAt, closeRequested, closed>>

CommitRegistration(a) ==
    /\ leased[a]
    /\ ~closed
    /\ physical[a] = "Ready"
    /\ published[a]
    /\ ~registered[a]
    /\ registered' = [registered EXCEPT ![a] = TRUE]
    /\ registeredAt' = [registeredAt EXCEPT ![a] = generation[a]]
    /\ provedAt' = [provedAt EXCEPT ![a] = generation[a]]
    /\ UNCHANGED <<physical, published, generation, leased, requestedStop,
                   closeRequested, closed>>

ReleaseRegistration(a) ==
    /\ leased[a]
    /\ leased' = [leased EXCEPT ![a] = FALSE]
    /\ UNCHANGED <<physical, published, generation, requestedStop,
                   registered, registeredAt, provedAt, closeRequested, closed>>

RequestStop(a) ==
    /\ physical[a] = "Ready"
    /\ ~requestedStop[a]
    /\ requestedStop' = [requestedStop EXCEPT ![a] = TRUE]
    /\ UNCHANGED <<physical, published, generation, leased,
                   registered, registeredAt, provedAt, closeRequested, closed>>

ApplyStop(a) ==
    /\ requestedStop[a]
    /\ ~leased[a]
    /\ physical[a] = "Ready"
    /\ physical' = [physical EXCEPT ![a] = "Stopped"]
    /\ published' = [published EXCEPT ![a] = FALSE]
    /\ UNCHANGED <<generation, leased, requestedStop, registered,
                   registeredAt, provedAt, closeRequested, closed>>

RequestClose ==
    /\ ~closeRequested
    /\ closeRequested' = TRUE
    /\ UNCHANGED <<physical, published, generation, leased, requestedStop,
                   registered, registeredAt, provedAt, closed>>

ApplyClose ==
    /\ closeRequested
    /\ ~closed
    /\ \A a \in Actors : ~leased[a]
    /\ closed' = TRUE
    /\ physical' = [a \in Actors |-> "Stopped"]
    /\ published' = [a \in Actors |-> FALSE]
    /\ UNCHANGED <<generation, leased, requestedStop, registered,
                   registeredAt, provedAt, closeRequested>>

Reincarnate(a) ==
    /\ ~closed
    /\ physical[a] = "Stopped"
    /\ ~leased[a]
    /\ generation[a] < MaxGeneration
    /\ physical' = [physical EXCEPT ![a] = "Ready"]
    /\ published' = [published EXCEPT ![a] = TRUE]
    /\ generation' = [generation EXCEPT ![a] = @ + 1]
    /\ requestedStop' = [requestedStop EXCEPT ![a] = FALSE]
    /\ registered' = [registered EXCEPT ![a] = FALSE]
    /\ registeredAt' = [registeredAt EXCEPT ![a] = 0]
    /\ provedAt' = [provedAt EXCEPT ![a] = 0]
    /\ UNCHANGED <<leased, closeRequested, closed>>

Next ==
    \/ \E a \in Actors :
         AcquireRegistration(a) \/ CommitRegistration(a)
         \/ ReleaseRegistration(a) \/ RequestStop(a)
         \/ ApplyStop(a) \/ Reincarnate(a)
    \/ RequestClose \/ ApplyClose

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ physical \in [Actors -> {"Ready", "Stopped"}]
    /\ published \in [Actors -> BOOLEAN]
    /\ generation \in [Actors -> 1..MaxGeneration]
    /\ leased \in [Actors -> BOOLEAN]
    /\ requestedStop \in [Actors -> BOOLEAN]
    /\ registered \in [Actors -> BOOLEAN]
    /\ registeredAt \in [Actors -> 0..MaxGeneration]
    /\ provedAt \in [Actors -> 0..MaxGeneration]
    /\ closeRequested \in BOOLEAN
    /\ closed \in BOOLEAN

NoStopWhileLeased ==
    \A a \in Actors : leased[a] => physical[a] = "Ready"

NoUnroutableLease ==
    \A a \in Actors : leased[a] => published[a]

RegistrationProofCoherent ==
    \A a \in Actors :
        registered[a] => (registeredAt[a] = provedAt[a] /\ provedAt[a] > 0)

NoStaleRegistration ==
    \A a \in Actors :
        registered[a] => registeredAt[a] = generation[a]

NoClosedAdmission ==
    closed => \A a \in Actors : ~leased[a]

NoUnpublishedPhysicalReady ==
    \A a \in Actors : published[a] => physical[a] = "Ready"

(* A Boolean readiness snapshot, without a scheduler lease, cannot prove
 * admission. This mutant deliberately publishes no matching proof. *)
UnsafeRegisterUnleased(a) ==
    /\ physical[a] = "Ready"
    /\ published[a]
    /\ ~leased[a]
    /\ ~registered[a]
    /\ registered' = [registered EXCEPT ![a] = TRUE]
    /\ registeredAt' = [registeredAt EXCEPT ![a] = generation[a]]
    /\ UNCHANGED <<physical, published, generation, leased, requestedStop,
                   provedAt, closeRequested, closed>>

(* Physical STOP must never cross a pinned registration generation. *)
UnsafeStopLeased(a) ==
    /\ leased[a]
    /\ physical[a] = "Ready"
    /\ physical' = [physical EXCEPT ![a] = "Stopped"]
    /\ published' = [published EXCEPT ![a] = FALSE]
    /\ UNCHANGED <<generation, leased, requestedStop, registered,
                   registeredAt, provedAt, closeRequested, closed>>

(* A stale callback from generation N-1 must not publish incarnation N. *)
UnsafeRegisterStaleGeneration(a) ==
    /\ generation[a] > 1
    /\ leased[a]
    /\ physical[a] = "Ready"
    /\ ~registered[a]
    /\ registered' = [registered EXCEPT ![a] = TRUE]
    /\ registeredAt' = [registeredAt EXCEPT ![a] = generation[a] - 1]
    /\ provedAt' = [provedAt EXCEPT ![a] = generation[a] - 1]
    /\ UNCHANGED <<physical, published, generation, leased, requestedStop,
                   closeRequested, closed>>

UnleasedNext == Next \/ \E a \in Actors : UnsafeRegisterUnleased(a)
ThroughGateNext == Next \/ \E a \in Actors : UnsafeStopLeased(a)
StaleNext == Next \/ \E a \in Actors : UnsafeRegisterStaleGeneration(a)
UnleasedSpec == Init /\ [][UnleasedNext]_vars
ThroughGateSpec == Init /\ [][ThroughGateNext]_vars
StaleSpec == Init /\ [][StaleNext]_vars

=============================================================================
