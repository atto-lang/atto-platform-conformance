---------------------- MODULE NativeIdentityRecycling ----------------------
EXTENDS Naturals, FiniteSets, TLC

(*
 * Bounded scheduler abstraction: an ACTIVE physical generation can only be
 * recycled after all callbacks drain and the normal-exit barrier is sealed.
 * Legacy slot-only callbacks and PANIC-attempted generations cannot recycle.
 * Delayed callback-held references must retain the old generation and must
 * never affect its replacement.
 *
 * The model does not prove runtime lock ordering or complete compiler
 * refinement. It does exercise a positive bounded lifecycle plus mutants.
 *)
CONSTANT MaxGeneration
ASSUME /\ MaxGeneration \in Nat
       /\ MaxGeneration > 1

VARIABLES mode, generation, phase, published, mailbox, callbackActive,
          callbackGeneration, lastCallbackGeneration, normalSealed, panic,
          proven, panicHistory, recycled, staleDelivered, rejectedStale

vars == <<mode, generation, phase, published, mailbox, callbackActive,
          callbackGeneration, lastCallbackGeneration, normalSealed, panic,
          proven, panicHistory, recycled, staleDelivered, rejectedStale>>

Init ==
  /\ mode \in {"Identity", "Legacy"}
  /\ generation = 1
  /\ phase = "Ready"
  /\ published = TRUE
  /\ mailbox = FALSE
  /\ callbackActive = FALSE
  /\ callbackGeneration = 0
  /\ lastCallbackGeneration = 0
  /\ normalSealed = FALSE
  /\ panic = FALSE
  /\ proven = {}
  /\ panicHistory = {}
  /\ recycled = {}
  /\ staleDelivered = FALSE
  /\ rejectedStale = 0

Send ==
  /\ phase = "Ready"
  /\ published
  /\ ~mailbox
  /\ ~callbackActive
  /\ mailbox' = TRUE
  /\ UNCHANGED <<mode, generation, phase, published, callbackActive,
       callbackGeneration, lastCallbackGeneration, normalSealed, panic,
       proven, panicHistory, recycled, staleDelivered, rejectedStale>>

BeginCallback ==
  /\ mailbox
  /\ ~callbackActive
  /\ callbackActive' = TRUE
  /\ callbackGeneration' = generation
  /\ mailbox' = FALSE
  /\ UNCHANGED <<mode, generation, phase, published,
       lastCallbackGeneration, normalSealed, panic, proven, panicHistory,
       recycled, staleDelivered, rejectedStale>>

FinishCallback ==
  /\ callbackActive
  /\ callbackActive' = FALSE
  /\ lastCallbackGeneration' = callbackGeneration
  /\ callbackGeneration' = 0
  /\ UNCHANGED <<mode, generation, phase, published, mailbox,
       normalSealed, panic, proven, panicHistory,
       recycled, staleDelivered, rejectedStale>>

Stop ==
  /\ phase = "Ready"
  /\ phase' = "Stopping"
  /\ UNCHANGED <<mode, generation, published, mailbox, callbackActive,
       callbackGeneration, lastCallbackGeneration, normalSealed, panic,
       proven, panicHistory, recycled, staleDelivered, rejectedStale>>

SealNormal ==
  /\ phase = "Stopping"
  /\ ~mailbox
  /\ ~callbackActive
  /\ ~panic
  /\ ~normalSealed
  /\ normalSealed' = TRUE
  /\ proven' = proven \cup {generation}
  /\ UNCHANGED <<mode, generation, phase, published, mailbox,
       callbackActive, callbackGeneration, lastCallbackGeneration, panic,
       panicHistory, recycled, staleDelivered, rejectedStale>>

PanicAttempt ==
  /\ phase = "Stopping"
  /\ ~normalSealed
  /\ ~panic
  /\ panic' = TRUE
  /\ panicHistory' = panicHistory \cup {generation}
  /\ UNCHANGED <<mode, generation, phase, published, mailbox,
       callbackActive, callbackGeneration, lastCallbackGeneration,
       normalSealed, proven, recycled, staleDelivered, rejectedStale>>

RecycleNormal ==
  /\ mode = "Identity"
  /\ phase = "Stopping"
  /\ normalSealed
  /\ ~panic
  /\ ~mailbox
  /\ ~callbackActive
  /\ generation < MaxGeneration
  /\ recycled' = recycled \cup {generation}
  /\ generation' = generation + 1
  /\ phase' = "Ready"
  /\ published' = FALSE
  /\ normalSealed' = FALSE
  /\ UNCHANGED <<mode, mailbox, callbackActive, callbackGeneration,
       lastCallbackGeneration, panic, proven, panicHistory,
       staleDelivered, rejectedStale>>

PublishUnderLease ==
  /\ phase = "Ready"
  /\ ~published
  /\ published' = TRUE
  /\ UNCHANGED <<mode, generation, phase, mailbox, callbackActive,
       callbackGeneration, lastCallbackGeneration, normalSealed, panic,
       proven, panicHistory, recycled, staleDelivered, rejectedStale>>

RejectOldCallback ==
  /\ mode = "Identity"
  /\ lastCallbackGeneration > 0
  /\ lastCallbackGeneration < generation
  /\ rejectedStale < MaxGeneration
  /\ rejectedStale' = rejectedStale + 1
  /\ UNCHANGED <<mode, generation, phase, published, mailbox,
       callbackActive, callbackGeneration, lastCallbackGeneration,
       normalSealed, panic, proven, panicHistory, recycled, staleDelivered>>

Next == Send \/ BeginCallback \/ FinishCallback \/ Stop \/ SealNormal
        \/ PanicAttempt \/ RecycleNormal \/ PublishUnderLease
        \/ RejectOldCallback
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ mode \in {"Identity", "Legacy"}
  /\ generation \in 1..MaxGeneration
  /\ phase \in {"Ready", "Stopping"}
  /\ published \in BOOLEAN
  /\ mailbox \in BOOLEAN
  /\ callbackActive \in BOOLEAN
  /\ callbackGeneration \in 0..MaxGeneration
  /\ lastCallbackGeneration \in 0..MaxGeneration
  /\ normalSealed \in BOOLEAN
  /\ panic \in BOOLEAN
  /\ proven \subseteq 1..MaxGeneration
  /\ panicHistory \subseteq 1..MaxGeneration
  /\ recycled \subseteq 1..MaxGeneration
  /\ staleDelivered \in BOOLEAN
  /\ rejectedStale \in 0..MaxGeneration

NoUnsealedRecycle == recycled \subseteq proven
NoPanicReuse == recycled \cap panicHistory = {}
NoLegacyReuse == mode = "Legacy" => recycled = {}
CallbackGenerationExact ==
  callbackActive => callbackGeneration = generation
NoStaleEffect == ~staleDelivered
NoHiddenCallbackAdmission ==
  ~published => (~mailbox /\ ~callbackActive)

UnsafeRecycleBeforeSeal ==
  /\ mode = "Identity"
  /\ phase = "Stopping"
  /\ ~normalSealed
  /\ generation < MaxGeneration
  /\ generation' = generation + 1
  /\ recycled' = recycled \cup {generation}
  /\ phase' = "Ready"
  /\ published' = FALSE
  /\ normalSealed' = FALSE
  /\ mailbox' = FALSE
  /\ callbackActive' = FALSE
  /\ callbackGeneration' = 0
  /\ UNCHANGED <<mode, lastCallbackGeneration, panic, proven,
                 panicHistory, staleDelivered, rejectedStale>>

UnsafeLegacyReuse ==
  /\ mode = "Legacy"
  /\ phase = "Stopping"
  /\ normalSealed
  /\ generation < MaxGeneration
  /\ generation' = generation + 1
  /\ recycled' = recycled \cup {generation}
  /\ phase' = "Ready"
  /\ published' = FALSE
  /\ normalSealed' = FALSE
  /\ UNCHANGED <<mode, mailbox, callbackActive, callbackGeneration,
       lastCallbackGeneration, panic, proven, panicHistory,
       staleDelivered, rejectedStale>>

UnsafePanicReuse ==
  /\ mode = "Identity"
  /\ phase = "Stopping"
  /\ panic
  /\ ~callbackActive
  /\ ~mailbox
  /\ generation < MaxGeneration
  /\ generation' = generation + 1
  /\ recycled' = recycled \cup {generation}
  /\ phase' = "Ready"
  /\ published' = FALSE
  /\ panic' = FALSE
  /\ UNCHANGED <<mode, mailbox, callbackActive, callbackGeneration,
       lastCallbackGeneration, normalSealed, proven, panicHistory,
       staleDelivered, rejectedStale>>

UnsafeDeliverRetainedCallback ==
  /\ mode = "Identity"
  /\ lastCallbackGeneration > 0
  /\ lastCallbackGeneration < generation
  /\ ~staleDelivered
  /\ staleDelivered' = TRUE
  /\ UNCHANGED <<mode, generation, phase, published, mailbox,
       callbackActive, callbackGeneration, lastCallbackGeneration,
       normalSealed, panic, proven, panicHistory, recycled, rejectedStale>>

EarlySpec == Init /\ [][Next \/ UnsafeRecycleBeforeSeal]_vars
LegacySpec == Init /\ [][Next \/ UnsafeLegacyReuse]_vars
PanicSpec == Init /\ [][Next \/ UnsafePanicReuse]_vars
StaleSpec == Init /\ [][Next \/ UnsafeDeliverRetainedCallback]_vars
=============================================================================
