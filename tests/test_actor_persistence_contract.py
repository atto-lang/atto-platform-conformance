"""Host-only fixture registry validation, not Atto compiler or disk tests."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class PersistenceRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = json.loads((ROOT / "contracts" / "actor-persistence-v1.json").read_text())
    def test_all_cases_have_unique_ids_and_valid_expectations(self):
        r = self.reg
        self.assertEqual(r["status"], "TARGET_ONLY_NO_BACKEND_EXECUTION")
        self.assertTrue(all(s == "NOT_EXECUTED" for s in r["backend_status"].values()))
        cases = r["cases"]
        self.assertEqual(len({x["id"] for x in cases}), len(cases))
        for c in cases:
            self.assertIn(c["phase"], ("parse", "semantic", "runtime"))
            self.assertIn(c["expect"], ("ACCEPT_TARGET_ONLY", "REJECT_TARGET_ONLY", "NOT_EXECUTED"))
            self.assertTrue(c.get("fixture") or c.get("scenario"), c["id"])
            if c["phase"] == "runtime":
                self.assertEqual(c["expect"], "NOT_EXECUTED", c["id"])
            if c["expect"] == "REJECT_TARGET_ONLY":
                self.assertTrue(c.get("diagnostic"), c["id"])
            if c.get("fixture"):
                self.assertTrue((ROOT / c["fixture"]).is_file(), c["fixture"])
    def test_persistent_and_durable_are_not_conflated(self):
        by = {c["id"]: c for c in self.reg["cases"]}
        source = lambda name: (ROOT / by[name]["fixture"]).read_text()
        self.assertIn("define durable actor", source("durable-keyword"))
        self.assertIn("define persistent actor", source("persistent-keyword"))
        self.assertIn("susp fnc load_state", source("persistent-hook-signature-syntax"))
        self.assertIn("susp fnc save_state", source("persistent-hook-signature-syntax"))
        self.assertEqual(by["missing-user-hooks-rejected"]["diagnostic"], "E_PERSIST_HOOKS")
        self.assertEqual(by["durable-user-hook-rejected"]["diagnostic"], "E_DURABLE_HOOK_OVERRIDE")
        self.assertEqual(by["both-keywords-rejected"]["diagnostic"], "E_ACTOR_PERSISTENCE_MODIFIER")
    def test_fail_closed_revival_requirements_present(self):
        ids = {c["id"] for c in self.reg["cases"]}
        for name in ("durable-disk-survival","durable-torn-write","stale-writer-fenced","corrupt-disk-fail-closed","persistent-store-failure","mailbox-delivery-replay"):
            self.assertIn(name, ids)
        checks = self.reg["assertions"]
        for name in ("noSilentFallback","quiescentSnapshotOnly","epochFencingRequired","stableSchemaRequired","noUserDurableHooks"):
            self.assertIs(checks[name], True)
        self.assertIs(checks["externalEffectsExactlyOnce"], False)
        self.assertIs(checks["stackContinuationPersisted"], False)
if __name__ == "__main__":
    unittest.main()
