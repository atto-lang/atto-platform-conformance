/-! Separate pattern and runtime value trees. Fits is a static admission witness;
    scalar kinds are explicit. No claims about parser, nominal layouts or loans. -/
namespace Atto.TypedProjection

inductive Kind where
  | int | bool
  deriving DecidableEq, Repr

inductive Scalar where
  | int (value : Int)
  | bool (value : Bool)
  deriving DecidableEq, Repr

def kind : Scalar → Kind
  | .int _ => .int
  | .bool _ => .bool

inductive Pattern where
  | leaf (name : Option String) (expected : Kind)
  | pair (left right : Pattern)
  deriving Repr

inductive Value where
  | scalar (value : Scalar)
  | pair (left right : Value)
  deriving Repr

inductive Fits : Pattern → Value → Prop where
  | leaf (name : Option String) (value : Scalar) :
      Fits (.leaf name (kind value)) (.scalar value)
  | pair {p q : Pattern} {v w : Value} :
      Fits p v → Fits q w → Fits (.pair p q) (.pair v w)

abbrev Binding := String × Scalar
abbrev Path := List Bool
abbrev Instruction := String × Kind × Path

def reference : Pattern → Value → Option (List Binding)
  | .leaf name expected, .scalar value =>
      if expected = kind value then
        some (match name with | none => [] | some n => [(n, value)])
      else none
  | .pair p q, .pair v w => do
      let l ← reference p v
      let r ← reference q w
      pure (l ++ r)
  | _, _ => none

def project : Value → Path → Option Scalar
  | .scalar value, [] => some value
  | .pair left _, false :: rest => project left rest
  | .pair _ right, true :: rest => project right rest
  | _, _ => none

def lower : Pattern → List Instruction
  | .leaf none _ => []
  | .leaf (some name) expected => [(name, expected, [])]
  | .pair p q =>
      (lower p).map (fun (name, expected, path) => (name, expected, false :: path)) ++
      (lower q).map (fun (name, expected, path) => (name, expected, true :: path))

def runInstruction (root : Value) (i : Instruction) : Option Binding := do
  let value ← project root i.2.2
  if kind value = i.2.1 then some (i.1, value) else none

def execute (root : Value) (plan : List Instruction) : List (Option Binding) :=
  plan.map (runInstruction root)

theorem execute_left (v w : Value) (plan : List Instruction) :
    execute (.pair v w)
      (plan.map (fun (name, expected, path) => (name, expected, false :: path))) =
    execute v plan := by
  induction plan with
  | nil => rfl
  | cons head tail ih =>
    rcases head with ⟨name, expected, path⟩
    simp [execute, runInstruction, project] at *

theorem execute_right (v w : Value) (plan : List Instruction) :
    execute (.pair v w)
      (plan.map (fun (name, expected, path) => (name, expected, true :: path))) =
    execute w plan := by
  induction plan with
  | nil => rfl
  | cons head tail ih =>
    rcases head with ⟨name, expected, path⟩
    simp [execute, runInstruction, project] at *

/-- On any independently supplied value satisfying admission, lowering is total,
    type checked and returns the ordered reference binding trace. -/
theorem typed_refinement {p : Pattern} {v : Value} (h : Fits p v) :
    ∃ bindings, reference p v = some bindings ∧
      execute v (lower p) = bindings.map some := by
  induction h with
  | leaf name value =>
    cases name with
    | none => exact ⟨[], by simp [reference, lower, execute]⟩
    | some n => exact ⟨[(n, value)], by simp [reference, lower, execute, runInstruction, project]⟩
  | @pair p q v w hp hq ihp ihq =>
    obtain ⟨left, hl, el⟩ := ihp
    obtain ⟨right, hr, er⟩ := ihq
    refine ⟨left ++ right, ?_, ?_⟩
    · simp [reference, hl, hr]
    · simp only [lower, execute, List.map_append]
      change execute (.pair v w)
        ((lower p).map (fun (name, expected, path) => (name, expected, false :: path))) ++
        execute (.pair v w)
        ((lower q).map (fun (name, expected, path) => (name, expected, true :: path))) =
        left.map some ++ right.map some
      rw [execute_left, execute_right, el, er]

/-- A successful instruction cannot return a scalar of the wrong kind. -/
theorem instruction_type_preserved (v : Value) (i : Instruction) (b : Binding)
    (h : runInstruction v i = some b) : kind b.2 = i.2.1 := by
  unfold runInstruction at h
  cases he : project v i.2.2 with
  | none => simp [he] at h
  | some value =>
    by_cases ht : kind value = i.2.1
    · simp [he, ht] at h
      cases h
      exact ht
    · simp [he, ht] at h

#print axioms typed_refinement
#print axioms instruction_type_preserved
end Atto.TypedProjection
