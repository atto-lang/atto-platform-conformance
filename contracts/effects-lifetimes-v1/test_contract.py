import copy
import json
import tempfile
import unittest
from pathlib import Path
from verify import CONTRACT, ROOT, evaluate, git_blob_sha, verify, verify_llvm_observation

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads(CONTRACT.read_text())

    def test_candidates_have_no_fake_backend_passes(self):
        self.assertEqual(verify(self.base), 4)

    def test_nll_positive_requires_last_use_before_move(self):
        last = self.base["cases"][-1]
        self.assertEqual(evaluate(last["trace"]), "accept")
        altered = copy.deepcopy(last["trace"])
        altered.append({"op": "use", "loan": "view"})
        self.assertEqual(evaluate(altered), "move_while_borrowed")

    def test_unpinned_await_rejects_but_dead_loan_does_not(self):
        trace = self.base["cases"][2]["trace"]
        self.assertEqual(evaluate(trace), "borrow_across_suspension")
        self.assertEqual(evaluate([trace[0], trace[2], trace[1]]), "accept")

    def test_mutation_of_fixture_blob_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            for case in self.base["cases"]:
                p = dest / case["path"]
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes((ROOT / case["path"]).read_bytes())
            p = dest / self.base["cases"][0]["path"]
            p.write_bytes(p.read_bytes() + b"// mutation\n")
            with self.assertRaises(AssertionError):
                verify(self.base, dest)

    def test_generic_parse_failure_cannot_fake_target_diagnostic(self):
        self.base["cases"][0]["diagnostic"] = "parse_error"
        with self.assertRaises(AssertionError):
            verify(self.base)


    def test_llvm_observation_does_not_promote_generic_rejections(self):
        observation_path = ROOT / "contracts/effects-lifetimes-v1/observations/llvm-fulltree-execution-20261111.json"
        observation = json.loads(observation_path.read_text())
        self.assertEqual(observation["status"], "EXECUTED_COMPILER_FEATURES_NOT_VERIFIED")
        self.assertEqual(observation["evidence_tier"], "COMPILER_EXECUTED_GUEST_TASK_SUBSET_ONLY")
        self.assertEqual(observation["source"]["tree"], observation["mirror"]["snapshot_tree"])
        self.assertGreater(observation["mirror"]["run_id"], 0)
        self.assertGreater(observation["mirror"]["job_id"], 0)
        self.assertEqual(verify_llvm_observation(observation, self.base), 4)
        rows = observation["candidate_fixture_evidence"]
        self.assertEqual(len(rows), len(self.base["cases"]))
        by_id = {row["id"]: row for row in rows}
        self.assertEqual(len(by_id), len(rows))
        for candidate in self.base["cases"]:
            row = by_id[candidate["id"]]
            self.assertEqual(row["fixture_git_blob"], candidate["blob_sha"])
            self.assertEqual(row["result"], "NOT_VERIFIED")
            self.assertNotEqual(row["compiler_exit"], 0)
            self.assertTrue(row["observed"])
            if candidate["kind"] == "compile_reject":
                self.assertEqual(row["expected_diagnostic"], candidate["diagnostic"])
                # A parser/frontend error is not proof of the targeted ownership diagnostic.
                self.assertNotIn(candidate["diagnostic"], row["observed"])
            else:
                self.assertIn("exit 42", row["expected_result"])
        self.assertEqual(
            [row["result"] for row in rows],
            ["NOT_VERIFIED"] * len(rows),
        )

    def test_llvm_observation_mutated_promotion_must_fail(self):
        observed = json.loads(
            (ROOT / "contracts/effects-lifetimes-v1/observations/llvm-fulltree-execution-20261111.json").read_text()
        )
        first = observed["candidate_fixture_evidence"][0]
        first["result"] = "PASS"
        with self.assertRaisesRegex(ValueError, "false promotion"):
            verify_llvm_observation(observed, self.base)

        observed["candidate_fixture_evidence"][0]["result"] = "NOT_VERIFIED"
        observed["candidate_fixture_evidence"][0]["fixture_git_blob"] = "0" * 40
        with self.assertRaisesRegex(ValueError, "blob"):
            verify_llvm_observation(observed, self.base)

if __name__ == "__main__":
    unittest.main()
