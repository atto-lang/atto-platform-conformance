/-!
  A small machine-checkable structural refinement theorem.
  Scope: finite ordered trees of immutable scalar leaves, with bind/discard.
  Shape, visibility and ownership admission are separate obligations.
  No axioms, sorry, or runtime/compiler certification.
-/
namespace Atto.PatternProof

inductive Scalar where
  | int (value : Int)
  | bool (value : Bool)
  deriving DecidableEq, Repr

inductive Tree where
  | leaf (name : Option String) (value : Scalar)
  | node (left right : Tree)
  deriving Repr

abbrev Binding := String × Scalar
abbrev Path := List Bool

def reference : Tree → List Binding
  | .leaf none _ => []
  | .leaf (some name) value => [(name, value)]
  | .node left right => reference left ++ reference right

def project : Tree → Path → Option Scalar
  | .leaf _ value, [] => some value
  | .node left _, false :: rest => project left rest
  | .node _ right, true :: rest => project right rest
  | _, _ => none

abbrev Instruction := String × Path

def lower : Tree → List Instruction
  | .leaf none _ => []
  | .leaf (some name) _ => [(name, [])]
  | .node left right =>
      (lower left).map (fun (name, path) => (name, false :: path)) ++
      (lower right).map (fun (name, path) => (name, true :: path))

def execute (root : Tree) (plan : List Instruction) : List (Option Binding) :=
  plan.map (fun (name, path) => (project root path).map (fun value => (name, value)))

theorem execute_left (left right : Tree) (plan : List Instruction) :
    execute (.node left right)
      (plan.map (fun (name, path) => (name, false :: path))) =
    execute left plan := by
  induction plan with
  | nil => rfl
  | cons head tail ih =>
    rcases head with ⟨name, path⟩
    simp [execute, project] at *

theorem execute_right (left right : Tree) (plan : List Instruction) :
    execute (.node left right)
      (plan.map (fun (name, path) => (name, true :: path))) =
    execute right plan := by
  induction plan with
  | nil => rfl
  | cons head tail ih =>
    rcases head with ⟨name, path⟩
    simp [execute, project] at *

/-- Every lowered binding resolves to its reference value, in source order.
    Unlike bounded enumeration, this quantifies over every finite tree. -/
theorem projection_refinement (tree : Tree) :
    execute tree (lower tree) = (reference tree).map some := by
  induction tree with
  | leaf name value =>
    cases name <;> rfl
  | node left right ihL ihR =>
    simp only [lower, reference, execute, List.map_append]
    change execute (.node left right)
      ((lower left).map (fun (name, path) => (name, false :: path))) ++
      execute (.node left right)
      ((lower right).map (fun (name, path) => (name, true :: path))) =
      (reference left).map some ++ (reference right).map some
    rw [execute_left, execute_right, ihL, ihR]

theorem binding_count (tree : Tree) :
    (lower tree).length = (reference tree).length := by
  have h := congrArg List.length (projection_refinement tree)
  simpa [execute] using h

#print axioms projection_refinement
#print axioms binding_count

end Atto.PatternProof
