import Std

/-! Per-resource ownership ledger. Arbitrary finite products can be indexed by
    resource identity; a step changes a leaf's ledger, not an entire aggregate.
    No allocator, alias resolution, compiler MIR, suspension or unwind claim. -/
namespace Atto.OwnershipLedger

structure Ledger where
  root : Nat
  local : Nat
  dropped : Nat
  shared : Nat
  exclusive : Bool
  deriving Repr

def initial : Ledger := ⟨1, 0, 0, 0, false⟩

def conserved (s : Ledger) : Prop :=
  s.root + s.local + s.dropped = 1

def loansSafe (s : Ledger) : Prop :=
  (s.shared > 0 → s.root = 1) ∧
  (s.exclusive = true → s.root = 1 ∧ s.shared = 0)

inductive Op where
  | move | dropRoot | dropLocal | acquireShared | acquireExclusive
  | releaseShared | releaseExclusive | readRoot
  deriving DecidableEq

inductive Step : Ledger → Op → Ledger → Prop where
  | move (s : Ledger) : s.root = 1 → s.shared = 0 → s.exclusive = false →
      Step s .move ⟨0, s.local + 1, s.dropped, 0, false⟩
  | dropRoot (s : Ledger) : s.root = 1 → s.shared = 0 → s.exclusive = false →
      Step s .dropRoot ⟨0, s.local, s.dropped + 1, 0, false⟩
  | dropLocal (s : Ledger) : s.local = 1 →
      Step s .dropLocal {s with local := 0, dropped := s.dropped + 1}
  | acquireShared (s : Ledger) : s.root = 1 → s.exclusive = false →
      Step s .acquireShared {s with shared := s.shared + 1}
  | acquireExclusive (s : Ledger) : s.root = 1 → s.shared = 0 → s.exclusive = false →
      Step s .acquireExclusive {s with exclusive := true}
  | releaseShared (s : Ledger) : s.shared > 0 →
      Step s .releaseShared {s with shared := s.shared - 1}
  | releaseExclusive (s : Ledger) : s.exclusive = true →
      Step s .releaseExclusive {s with exclusive := false}
  | readRoot (s : Ledger) : s.root = 1 → s.exclusive = false →
      Step s .readRoot s

theorem conservation_step {s t : Ledger} {op : Op}
    (h : Step s op t) (hs : conserved s) : conserved t := by
  cases h <;> simp_all [conserved] <;> omega

theorem loan_safety_step {s t : Ledger} {op : Op}
    (h : Step s op t) (hs : loansSafe s) : loansSafe t := by
  cases h <;> simp_all [loansSafe] <;> omega

theorem moved_root_absent {s t : Ledger} (h : Step s .move t) :
    t.root = 0 := by
  cases h
  rfl

theorem no_root_resurrection {s t : Ledger} {op : Op}
    (h : Step s op t) (hs : s.root = 0) : t.root = 0 := by
  cases h <;> simp_all

theorem read_requires_live_root {s t : Ledger} (h : Step s .readRoot t) :
    s.root = 1 := by
  cases h with
  | readRoot _ live _ => exact live

theorem no_move_with_loan {s t : Ledger} (h : Step s .move t) :
    s.shared = 0 ∧ s.exclusive = false := by
  cases h with
  | move _ _ shared exclusive => exact ⟨shared, exclusive⟩

inductive Trace : Ledger → Ledger → Prop where
  | refl (s : Ledger) : Trace s s
  | next {s t u : Ledger} {op : Op} : Trace s t → Step t op u → Trace s u

theorem trace_conservation {s t : Ledger} (h : Trace s t)
    (hs : conserved s) : conserved t := by
  induction h with
  | refl _ => exact hs
  | next _ step ih => exact conservation_step step ih

theorem trace_loans_safe {s t : Ledger} (h : Trace s t)
    (hs : loansSafe s) : loansSafe t := by
  induction h with
  | refl _ => exact hs
  | next _ step ih => exact loan_safety_step step ih

theorem trace_no_resurrection {s t : Ledger} (h : Trace s t)
    (hs : s.root = 0) : t.root = 0 := by
  induction h with
  | refl _ => exact hs
  | next _ step ih => exact no_root_resurrection step ih

theorem use_after_move_rejected {s t u v : Ledger}
    (m : Step s .move t) (tail : Trace t u) (r : Step u .readRoot v) : False := by
  have gone := trace_no_resurrection tail (moved_root_absent m)
  have live := read_requires_live_root r
  omega

theorem complete_cleanup_exactly_once {s : Ledger} (h : Trace initial s)
    (hr : s.root = 0) (hl : s.local = 0) : s.dropped = 1 := by
  have hc := trace_conservation h (by decide : conserved initial)
  unfold conserved at hc
  omega

-- Pointwise lifting: arbitrary identities, not a fixed three-leaf state space.
def ProductTrace {Id : Type} (before after : Id → Ledger) : Prop :=
  ∀ i, Trace (before i) (after i)

theorem product_ownership_conservation {Id : Type} {before after : Id → Ledger}
    (h : ProductTrace before after) (hi : ∀ i, conserved (before i)) :
    ∀ i, conserved (after i) := by
  intro i
  exact trace_conservation (h i) (hi i)

theorem product_partial_move {Id : Type} {before after : Id → Ledger}
    (h : ProductTrace before after) (i : Id) (gone : (before i).root = 0) :
    (after i).root = 0 :=
  trace_no_resurrection (h i) gone

#print axioms conservation_step
#print axioms loan_safety_step
#print axioms use_after_move_rejected
#print axioms complete_cleanup_exactly_once
#print axioms product_ownership_conservation
#print axioms product_partial_move

end Atto.OwnershipLedger
