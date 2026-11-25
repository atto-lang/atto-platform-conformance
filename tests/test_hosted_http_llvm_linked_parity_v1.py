"""Source-only LLVM compiler candidate check; NO native guest was run here."""
import copy
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "contracts/hosted-http-llvm-linked-namespace-candidate-v1.json"
SHA40 = re.compile(r"^[a-f0-9]{40}$")
BLOBS = {
    "src/main.rs",
    "stdlib/http/message_policy.atto",
    "tests/http_stdlib/namespace_import_canary.atto",
    "ci/test_http_stdlib_policy.sh",
    "ci/test_http_namespace_import.sh",
    ".github/workflows/http-stdlib-guest.yml",
    "frontend/tests/core_ownership_boundary.rs",
    "frontend/tests/fixtures/borrow_move_after_transfer.atto",
    "frontend/tests/fixtures/borrow_move_owner_ok.atto",
}
PROOF = {
    "exact_source_head_and_root_git_tree",
    "packaged_source_blob_identity",
    "independent_ast_parse_plus_type_check",
    "native_llvm_ir_and_executable",
    "positive_exit_42_with_no_guest_stderr",
    "nine_negative_diagnostics_and_no_artifacts",
    "nonzero_executed_workflow_steps",
    "approved_private_source_carrier_if_cross_org",
}


def valid(v):
    if not isinstance(v, dict) or set(v) != {
        "schema", "implementation", "status", "source_repo", "source_pr",
        "source_head", "source_root_tree", "source_blobs",
        "canonical_import", "source_units", "expected_positive_guest_cases",
        "expected_negative_import_cases", "existing_same_unit_policy_cases",
        "guest_executed_cases", "execution_steps", "evidence", "capabilities",
        "proof_requirements"
    }:
        return False
    if (
        v["schema"] != "atto.std.http.llvm_linked_namespace_candidate.v1"
        or v["implementation"] != "BACKEND_LOCAL_ATTO_AST_LINK"
        or v["status"] != "NOT_EXECUTED"
        or v["source_repo"] != "atto-lang/atto-source.llvm"
        or type(v["source_pr"]) is not int or v["source_pr"] != 856
        or v["canonical_import"] != 'import * as http from "std.http";'
        or v["source_units"] != "SEPARATELY_PARSED_NATIVE_ATTO"
        or type(v["expected_positive_guest_cases"]) is not int
        or v["expected_positive_guest_cases"] != 17
        or type(v["expected_negative_import_cases"]) is not int
        or v["expected_negative_import_cases"] != 9
        or type(v["existing_same_unit_policy_cases"]) is not int
        or v["existing_same_unit_policy_cases"] != 46
        or type(v["guest_executed_cases"]) is not int
        or v["guest_executed_cases"] != 0
        or type(v["execution_steps"]) is not int
        or v["execution_steps"] != 0
        or v["evidence"] != "NONE"
    ):
        return False
    if not all(
        isinstance(v[key], str) and SHA40.fullmatch(v[key])
        for key in ("source_head", "source_root_tree")
    ):
        return False
    blobs = v["source_blobs"]
    if not isinstance(blobs, dict) or set(blobs) != BLOBS:
        return False
    if not all(isinstance(h, str) and SHA40.fullmatch(h) for h in blobs.values()):
        return False
    if v["capabilities"] != {
        "qualified_public_scalar_functions": "STAGED_UNVERIFIED",
        "selective_public_modules": "UNSUPPORTED_FAIL_CLOSED",
        "imported_classes": "UNSUPPORTED_FAIL_CLOSED",
        "network_transport": "UNSUPPORTED_FAIL_CLOSED",
        "freestanding_std_http": "DENIED",
    }:
        return False
    return (
        isinstance(v["proof_requirements"], list)
        and len(v["proof_requirements"]) == len(PROOF)
        and set(v["proof_requirements"]) == PROOF
    )


class HttpLlvmLinkedSourceOnlyAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = json.loads(FILE.read_text(encoding="utf-8"))

    def test_authored_candidate_does_not_claim_execution(self):
        self.assertTrue(valid(self.candidate))

    def test_guest_pass_requires_real_stepful_run_and_all_negatives(self):
        for key, value in (
            ("status", "PASS"),
            ("guest_executed_cases", 17),
            ("execution_steps", 4),
            ("expected_negative_import_cases", 0),
            ("source_units", "SOURCE_CONCATENATED"),
        ):
            forged = copy.deepcopy(self.candidate)
            forged[key] = value
            self.assertFalse(valid(forged), key)

    def test_missing_provenance_or_unsupported_feature_claim_fails(self):
        altered = copy.deepcopy(self.candidate)
        altered["source_blobs"].pop("src/main.rs")
        self.assertFalse(valid(altered))
        altered = copy.deepcopy(self.candidate)
        altered["capabilities"]["selective_public_modules"] = "PASS"
        self.assertFalse(valid(altered))


if __name__ == "__main__":
    unittest.main()
