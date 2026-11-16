"""Source-only typeof spelling registry test; does NOT execute a guest compiler."""
import json
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class TypeofSpellingContract(unittest.TestCase):
    def test_spelling_matrix_is_complete_and_unexecuted(self):
        manifest=json.loads((ROOT/"contracts/return-type-inference-typeof-v1.json").read_text())
        syntax=manifest["typeof_syntax"]
        self.assertEqual(syntax["canonical"], "typeof name")
        self.assertEqual(syntax["compatible"], ["typeof(name)"])
        self.assertEqual(syntax["implementation_status"], "TARGET_ONLY_NOT_EXECUTED")
        fixtures={case["id"]:case for case in manifest["cases"]}
        for name in ("typeof_bare_parameter","typeof_parenthesized_parameter", "typeof_bare_forward_local", "typeof_parenthesized_forward_local"):
            self.assertEqual(fixtures[name]["expected"], "compile_and_run")
        for name in ("typeof_bang_adjoined","typeof_bang_spaced","typeof_parentheses_empty","typeof_parentheses_multiple","typeof_parenthesized_expression"):
            self.assertEqual(fixtures[name]["expected"], "compile_error_no_artifact")
        for name in fixtures:
            self.assertTrue(all(v=="NOT_EXECUTED" for v in fixtures[name]["backend_status"].values()))

if __name__=="__main__": unittest.main()
