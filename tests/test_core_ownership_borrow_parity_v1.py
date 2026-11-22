"""Fail-closed eleven-backend core borrow ownership conformance ledger.

These are SOURCE_ONLY manifest checks, not a compiled Atto or Rust test pass.
"""
import copy
import json
import unittest
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "contracts/core-borrow-ownership-parity-v1.json"
BACKENDS = {"java", "llvm", "net", "wasm", "rs", "forge",
            "cranelift", "js", "atto", "hdl", "realtime"}
OBLIGATIONS = {
    "copy_scalar_allowed": "POSITIVE",
    "move_new_owner_allowed": "POSITIVE",
    "use_after_move_denied": "NEGATIVE",
    "borrowed_self_escape_denied": "NEGATIVE",
    "mut_shared_overlap_denied": "NEGATIVE",
    "suspension_borrow_crossing_denied": "NEGATIVE",
    "import_noncopy_without_contract_denied": "NEGATIVE",
    "copy_only_generics_guarded": "NEGATIVE",
}
REQUIRED_RELEASE = {
    "source_only_never_pass", "test_real_backend_atto",
    "typed_negative_diagnostics", "runtime_guest_evidence_when_supported",
    "no_borrow_escape_across_await", "no_noncopy_without_checker",
    "independent_atto_sources_allowed", "exact_source_tree_required",
}


def valid(m):
    if not isinstance(m, dict) or set(m) != {
        "schema", "status", "library_rule", "proof_scope",
        "copy_types", "ownership_obligations", "llvm_source_candidates",
        "backend_rows", "release_requirements",
    }:
        return False
    if (m["schema"] != "atto.core.borrow_ownership_parity.v1"
            or m["status"] != "ALL_GUEST_NOT_EXECUTED"
            or m["library_rule"] != "COMPILER_LOCAL_ATTO_IMPLEMENTATION"
            or m["proof_scope"] != "COMPILED_GUEST_AND_TYPED_CHECKER"
            or m["copy_types"] != ["int", "bool"]):
        return False
    obligations = m["ownership_obligations"]
    if not isinstance(obligations, list) or len(obligations) != len(OBLIGATIONS):
        return False
    found = {}
    for x in obligations:
        if not isinstance(x, dict) or set(x) != {"id", "kind", "description"}:
            return False
        ident = x["id"]
        if ident in found or ident not in OBLIGATIONS or x["kind"] != OBLIGATIONS[ident]:
            return False
        if not isinstance(x["description"], str) or not x["description"]:
            return False
        found[ident] = True
    if set(found) != set(OBLIGATIONS):
        return False
    llvm = m["llvm_source_candidates"]
    if not isinstance(llvm, dict) or set(llvm) != {
        "head", "paths", "staged_evidence", "compiler_test_status",
        "owned_copy_boundary", "generic_collection_status", "tests_staged",
    }:
        return False
    if (not isinstance(llvm["head"], str) or len(llvm["head"]) != 40
            or any(c not in "0123456789abcdef" for c in llvm["head"])
            or llvm["staged_evidence"] != "SOURCE_ONLY"
            or llvm["compiler_test_status"] != "NOT_EXECUTED"
            or llvm["generic_collection_status"] !=
            "UNPROVEN_COPY_BOUNDS_NOT_EXECUTABLE"
            or llvm["owned_copy_boundary"] !=
            "std.http scalar import enforces int/bool parameters and return"
            or type(llvm["tests_staged"]) is not int or llvm["tests_staged"] != 4
            or not isinstance(llvm["paths"], list) or len(llvm["paths"]) != 4
            or len(set(llvm["paths"])) != 4
            or not all(isinstance(p, str) and p.startswith(
                "atto-lang/atto-source.llvm/") for p in llvm["paths"])):
        return False
    rows = m["backend_rows"]
    if not isinstance(rows, list) or len(rows) != len(BACKENDS):
        return False
    found = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            "backend", "repository", "source_state",
            "guest_execution", "guest_cases_executed",
            "complete_ownership_parity", "evidence",
        }:
            return False
        name = row["backend"]
        if name in found or name not in BACKENDS:
            return False
        found.add(name)
        if (row["repository"] != "atto-lang/atto-source." + name
                or row["source_state"] != (
                    "SCALAR_CORE_AND_HTTP_COPY_GATE_STAGED_UNVERIFIED"
                    if name == "llvm" else "UNASSESSED")
                or row["guest_execution"] != "NOT_EXECUTED"
                or type(row["guest_cases_executed"]) is not int
                or row["guest_cases_executed"] != 0
                or row["complete_ownership_parity"] is not False
                or row["evidence"] != "NONE"):
            return False
    return (found == BACKENDS
            and isinstance(m["release_requirements"], dict)
            and set(m["release_requirements"]) == REQUIRED_RELEASE
            and all(v is True for v in m["release_requirements"].values()))


class CoreBorrowSourceAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_eleven_backends_and_copy_ownership_contract_are_staged(self):
        self.assertTrue(valid(self.m))

    def test_every_backend_rejects_forged_guest_pass(self):
        for backend in BACKENDS:
            for key, fake in (
                ("guest_execution", "PASS"),
                ("guest_cases_executed", 1),
                ("complete_ownership_parity", True),
            ):
                m = copy.deepcopy(self.m)
                row = next(r for r in m["backend_rows"] if r["backend"] == backend)
                row[key] = fake
                self.assertFalse(valid(m), (backend, key))

    def test_no_borrow_suspension_or_generic_copy_gap_can_be_silenced(self):
        for obligation in ("suspension_borrow_crossing_denied",
                           "copy_only_generics_guarded",
                           "import_noncopy_without_contract_denied"):
            m = copy.deepcopy(self.m)
            m["ownership_obligations"] = [
                o for o in m["ownership_obligations"] if o["id"] != obligation
            ]
            self.assertFalse(valid(m), obligation)

    def test_source_only_or_fake_llvm_copy_gate_cannot_promote_release(self):
        for key, fake in (
            ("compiler_test_status", "PASS"),
            ("generic_collection_status", "COPY_PARITY_PASS"),
            ("tests_staged", 0),
        ):
            m = copy.deepcopy(self.m)
            m["llvm_source_candidates"][key] = fake
            self.assertFalse(valid(m), key)


if __name__ == "__main__":
    unittest.main()
