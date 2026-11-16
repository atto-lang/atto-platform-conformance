"""Validate the versioned return-match / Channel<int> conformance registry.
This is a **metadata and fixture** test, not proof of executing any backend.
"""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/channel-return-ownership-v1.json"
BACKENDS = {"rs-browser", "java", "llvm", "net", "wasm-independent", "forge"}

class ChannelReturnOwnershipContract(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(CONTRACT.read_text())

    def test_schema_and_evidence_stay_scoped(self):
        d = self.data
        self.assertEqual(d["schema"], "atto.channel-return-ownership.v1")
        self.assertEqual(d["version"], 1)
        self.assertIn("AUTOCLEANUP_PENDING", d["status"])
        self.assertEqual(set(d["backend_status"]), BACKENDS)
        self.assertEqual(d["backend_status"]["rs-browser"], "VERIFIED_SCOPED")
        for backend in BACKENDS - {"rs-browser"}:
            self.assertEqual(d["backend_status"][backend], "NOT_EXECUTED")
        self.assertIn("NOT_IMPLEMENTED", d["semantics"]["guest_auto_cleanup"])
        self.assertIn("Busy", d["semantics"]["host_abandon"])
        self.assertEqual(d["semantics"]["return_markers"], ["return", "^"])
        self.assertEqual(d["semantics"]["read_result_type"], "Future<Result<Option<int>,IoError>>")
        evidence = d["rust_browser_evidence"]
        self.assertEqual(evidence["actions_run"], 43952942257)
        self.assertEqual(evidence["steps"], "19/19")
        self.assertEqual(evidence["conformance_passed"], 486)
        self.assertEqual(evidence["native_wasm_comparisons"], 438)
        for field in ("source_head", "source_tree", "carrier_source_commit"):
            self.assertRegex(evidence[field], r"^[0-9a-f]{40}$")
        self.assertIn(str(evidence["actions_run"]), evidence["url"])
        self.assertIn("does not execute every portable fixture", evidence["scope"])

    def test_active_fixtures_have_one_expected_result_each(self):
        cases = self.data["required_cases"]
        self.assertGreaterEqual(len(cases), 6)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        self.assertEqual(len({case["path"] for case in cases}), len(cases))
        for case in cases:
            file = ROOT / case["path"]
            self.assertTrue(file.is_file(), file)
            self.assertEqual(file.suffix, ".atto")
            code = file.read_text()
            self.assertIn("pub ", code)
            self.assertIn("fnc main()", code)
            self.assertLess(len(code), 20_000)
            self.assertNotIn("pending-expected-error:", code)
            if case["kind"] == "pass":
                self.assertEqual(case["expected_exit"], 42)
                self.assertNotIn("expected_error", case)
                self.assertIn("// expect-exit: 42", code)
            else:
                self.assertEqual(case["kind"], "fail")
                self.assertIn(case["expected_error"], ("E_EFFECT", "E_MATCH", "E_MOVED"))
                self.assertNotIn("expected_exit", case)
                self.assertIn("// expect-error: " + case["expected_error"], code)

    def test_future_leak_is_a_pending_failure_not_a_false_pass(self):
        pending = self.data["pending_cases"]
        self.assertGreaterEqual(len(pending), 1)
        active_paths = {case["path"] for case in self.data["required_cases"]}
        for case in pending:
            self.assertEqual(case["kind"], "pending")
            self.assertNotIn(case["path"], active_paths)
            self.assertEqual(case["target_error"], "E_FUTURE_OWNERSHIP")
            text = (ROOT / case["path"]).read_text()
            self.assertIn("pending-expected-error: " + case["target_error"], text)
            self.assertIn("nb readch", text)
            self.assertIn("^ 42", text)
        self.assertIn("exact backend SHA/tree", self.data["evidence_rule"])

if __name__ == "__main__":
    unittest.main()
