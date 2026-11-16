"""Source-only fixture manifest checks. Does NOT compile AttoLang."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class ReturnTypeManifestTests(unittest.TestCase):
    def test_registry_sources_and_status(self):
        data = json.loads((ROOT / "contracts/return-type-inference-typeof-v1.json").read_text())
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["status"], "TARGET_ONLY_NOT_EXECUTED")
        self.assertEqual(data["source_compiler_execution"], "NOT_EXECUTED")
        self.assertGreaterEqual(len(data["cases"]), 30)
        seen = set()
        for case in data["cases"]:
            self.assertNotIn(case["id"], seen)
            seen.add(case["id"])
            p = (ROOT / case["path"]).resolve()
            self.assertTrue(p.is_relative_to(ROOT))
            self.assertTrue(p.is_file(), case["id"])
            self.assertEqual(p.suffix, ".atto")
            source = p.read_text()
            self.assertTrue(source.strip())
            self.assertTrue(any(x in source for x in ("infer", "typeof", "type<")))
            self.assertEqual(set(case["backend_status"]), {"java", "llvm", "net", "wasm", "forge", "rs_wasm"})
            self.assertTrue(all(s == "NOT_EXECUTED" for s in case["backend_status"].values()))
            if case["expected"] == "compile_error_no_artifact":
                self.assertTrue(case["diagnostic_category"].startswith("E_"))
                self.assertIn("/fail/", case["path"])
            else:
                self.assertEqual(case["expected"], "compile_and_run")
                self.assertIn("/pass/", case["path"])
                self.assertIsInstance(case["expected_exit"], int)

    def test_legacy_compat_and_type_expression_denials(self):
        data = json.loads((ROOT / "contracts/return-type-inference-typeof-v1.json").read_text())
        names = {c["id"] for c in data["cases"]}
        for name in ("typeof_legacy_value", "typeof_legacy_callable", "typeof_generic_value",
                     "typeof_void_type", "typeof_ambiguous_overload", "infer_recursion"):
            self.assertIn(name, names)

if __name__ == "__main__":
    unittest.main()
