"""Portable equality contract registry integrity — host model, NOT guest execution."""
import json
import hashlib
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/equality-operators-v1.json"

class EqualityContract(unittest.TestCase):
    def test_schema_semantics_and_scope(self):
        doc = json.loads(CONTRACT.read_text())
        self.assertEqual(doc["schema"], "atto.equality-operators.v1")
        self.assertEqual(doc["version"], 1)
        self.assertEqual(doc["semantics"]["value_operators"], ["eq", "neq"])
        self.assertEqual(doc["semantics"]["identity_operators"], ["==", "!="])
        self.assertEqual(doc["semantics"]["primitive_identity"], "COMPILE_TIME_ERROR")
        self.assertEqual(set(doc["backend_status"]), {"rs-browser", "java", "llvm", "net", "wasm-independent", "forge", "cranelift", "js", "hdl"})
        self.assertEqual(doc["backend_status"]["rs-browser"], "FOCUSED_VERIFIED")
        self.assertTrue(all(value == "NOT_VERIFIED" for key, value in doc["backend_status"].items() if key != "rs-browser"))
        evidence = doc["evidence"]["rs-browser"]
        self.assertEqual(evidence["source_tree"], evidence["runner_tree"])
        self.assertEqual(evidence["registry_fixture_blobs_verified"], len(doc["required_cases"]))
        self.assertEqual(len(doc["required_cases"]), 30)
        self.assertEqual(evidence["conformance_failed"], 0)
        self.assertGreaterEqual(evidence["native_vs_wasm_compared"], 467)
        self.assertIn("bait-bikes-test/atto-ci/actions/runs/", evidence["workflow_run"])

    def test_fixtures_exist_and_have_expected_headers(self):
        doc = json.loads(CONTRACT.read_text())
        cases = doc["required_cases"]
        self.assertGreaterEqual(len(cases), 10)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertEqual(len({case["path"] for case in cases}), len(cases))
        for case in cases:
            path = ROOT / case["path"]
            self.assertTrue(path.is_file(), case["path"])
            source_bytes = path.read_bytes()
            source = source_bytes.decode("utf-8")
            if case.get("source_blob_sha"):
                computed = hashlib.sha1(
                    b"blob " + str(len(source_bytes)).encode() + b"\0" + source_bytes
                ).hexdigest()
                self.assertEqual(computed, case["source_blob_sha"], case["path"])
            self.assertIn("pub fnc main(): int", source)
            self.assertLess(len(source), 20_000)
            if case["kind"] == "pass":
                self.assertIn("// expect-exit: " + str(case["expected_exit"]), source)
                self.assertNotIn("expected_error", case)
            else:
                self.assertEqual(case["kind"], "fail")
                self.assertIn("// expect-error: " + case["expected_error"], source)
                self.assertNotIn("expected_exit", case)

    def test_checked_class_dispatch_fails_closed(self):
        doc = json.loads(CONTRACT.read_text())
        cases = {case["id"]: case for case in doc["required_cases"]}
        self.assertIn("equals(Self other): bool", doc["semantics"]["class_value_equality"])
        self.assertIn("borrowed", doc["semantics"]["class_ownership"])
        for name in ["class_equals_checked", "class_neq_method_once"]:
            self.assertEqual(cases[name]["kind"], "pass")
            text = (ROOT / cases[name]["path"]).read_text()
            self.assertIn("pub equals(", text)
        once = cases["class_neq_method_once"]
        self.assertEqual(once["expected_stdout"], "equals called\n")
        self.assertIn("// expect-stdout: equals called", (ROOT / once["path"]).read_text())
        for name, diagnostic in [
            ("class_equals_invalid_signature", "E_EQUALS_SIGNATURE"),
            ("class_equals_borrowed_other_move", "E_BORROW"),
            ("class_equals_missing_method", "E_EQUALS"),
        ]:
            self.assertEqual(cases[name]["expected_error"], diagnostic)

    def test_class_self_identity_is_nonowning(self):
        doc = json.loads(CONTRACT.read_text())
        cases = {case["id"]: case for case in doc["required_cases"]}
        pos = cases["class_self_identity"]
        self.assertEqual(pos["expected_exit"], 43)
        content = (ROOT / pos["path"]).read_text()
        self.assertIn("self == other", content)
        self.assertIn("self != other", content)
        for case_id, error in [
            ("class_self_owner_escape", "E_UNSUPPORTED"),
            ("class_self_primitive_identity", "E_IDENTITY_TYPE"),
        ]:
            self.assertEqual(cases[case_id]["expected_error"], error)
        self.assertIn("non-owning", doc["semantics"]["class_self_identity"])

    def test_inherited_equality_and_absence_gates(self):
        d = json.loads(CONTRACT.read_text())
        cases = {c["id"]: c for c in d["required_cases"]}
        self.assertIn("statically specialized", d["semantics"]["inherited_equality"])
        self.assertIn("no runtime", d["semantics"]["inherited_equality"])
        for name, code in [
            ("inherited_class_equals", 49),
            ("overridden_class_equals", 50),
            ("transitive_inherited_equals", 51),
            ("nan_value_equality", 52),
            ("infinity_value_equality", 53),
        ]:
            self.assertEqual(cases[name]["expected_exit"], code)
            self.assertIn("source_blob_sha", cases[name])
        for name, error in [
            ("inherited_equals_bad_signature", "E_EQUALS_INHERITANCE"),
            ("override_equals_wrong_type", "E_SIGNATURE"),
            ("inherited_equals_with_fields", "E_UNSUPPORTED"),
            ("option_class_unsupported", "E_UNSUPPORTED_TYPE"),
            ("null_literal_unsupported", "E_NULL"),
            ("unrelated_equals_inheritance", "E_AMBIGUOUS_MEMBER"),
        ]:
            self.assertEqual(cases[name]["expected_error"], error)
            self.assertIn("source_blob_sha", cases[name])
        self.assertIn("Option<Class>", d["semantics"]["null"])

    def test_value_vs_identity_stay_distinct(self):
        doc = json.loads(CONTRACT.read_text())
        cases = {c["id"]: c for c in doc["required_cases"]}
        self.assertIn(" eq ", (ROOT / cases["int_value_equal"]["path"]).read_text())
        self.assertIn(" neq ", (ROOT / cases["int_value_unequal"]["path"]).read_text())
        self.assertIn(" == ", (ROOT / cases["class_identity"]["path"]).read_text())
        self.assertIn(" != ", (ROOT / cases["class_identity"]["path"]).read_text())
        for name in ["primitive_identity_equal", "primitive_identity_unequal", "bool_identity_equal"]:
            self.assertEqual(cases[name]["expected_error"], "E_IDENTITY_TYPE")

if __name__ == "__main__":
    unittest.main()
