#!/usr/bin/env python3
"""Independent, source-free Draft 2020-12 Zorde handoff schema tests.

These synthetic receipts never authenticate private GitHub source or guest execution.
"""
import copy
import json
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "schemas/zorde-contract-handoff-v1.schema.json").read_text("utf-8"))
Draft202012Validator.check_schema(SCHEMA)
VALIDATOR = Draft202012Validator(SCHEMA)


def pending():
    return dict(status="NOT_EXECUTED", executedSteps=0, executedTests=0, evidenceSha256=None)


def fixture():
    return {
        "schemaVersion": 1,
        "suite": "zorde-dual-authority-wit-v1",
        "source": {
            "repository": "ores-truffle-oreslang/oreslang-serialization-and-validation",
            "commitSha": "a" * 40,
            "treeSha": "b" * 40,
        },
        "authorities": {
            "typeSpec": {"path": "contracts/zorde/main.tsp", "gitBlobSha": "c" * 40},
            "jsonSchema": {"path": "contracts/zorde/authored.schema.json", "gitBlobSha": "d" * 40},
            "wit": {"path": "wit/zorde-validation.wit", "gitBlobSha": "e" * 40},
        },
        "checks": {
            "dualAuthority": pending(),
            "witParser": pending(),
            "nativeGuest": pending(),
        },
        "disposition": "STRUCTURE_ONLY_UNAUTHENTICATED",
        "privateSourceExportAuthorized": False,
    }


def accepted(data):
    return not list(VALIDATOR.iter_errors(data))


class HandoffSchemaTests(unittest.TestCase):
    def test_original_is_well_formed_and_never_admitted(self):
        self.assertEqual(SCHEMA["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertTrue(accepted(fixture()))
        self.assertEqual(fixture()["disposition"], "STRUCTURE_ONLY_UNAUTHENTICATED")

    def test_all_lanes_can_report_executed_without_self_certifying(self):
        receipt = fixture()
        for lane in receipt["checks"].values():
            lane.update(status="EXECUTED_UNATTESTED", executedSteps=3,
                        executedTests=2, evidenceSha256="f" * 64)
        self.assertTrue(accepted(receipt))
        receipt["disposition"] = "VERIFIED"
        self.assertFalse(accepted(receipt))

    def test_zero_step_and_ambiguous_status_attack_matrix(self):
        for name in ("dualAuthority", "witParser", "nativeGuest"):
            for change in (
                {"status": "PASS", "executedSteps": 1, "executedTests": 1, "evidenceSha256": "f" * 64},
                {"status": "EXECUTED_UNATTESTED"},
                {"status": "REJECTED"},
                {"status": "NOT_EXECUTED", "executedSteps": 1},
                {"status": "NOT_EXECUTED", "executedTests": 1},
                {"status": "NOT_EXECUTED", "evidenceSha256": "f" * 64},
            ):
                with self.subTest(name=name, change=change):
                    r = fixture()
                    r["checks"][name].update(change)
                    self.assertFalse(accepted(r))
            for invalid in (0, -1, True, 100001):
                with self.subTest(name=name, invalid=invalid):
                    r = fixture()
                    r["checks"][name].update(
                        status="EXECUTED_UNATTESTED", executedSteps=invalid,
                        executedTests=1, evidenceSha256="f" * 64)
                    self.assertFalse(accepted(r))
            r = fixture()
            r["checks"][name].update(
                status="REJECTED", executedSteps=1, executedTests=1,
                evidenceSha256="f" * 64)
            self.assertTrue(accepted(r))

    def test_identity_and_authority_pin_substitution_fails_closed(self):
        mutations = [
            lambda x: x["source"].update(repository="untrusted/carrier"),
            lambda x: x["source"].update(commitSha="0" * 40),
            lambda x: x["source"].update(treeSha="a" * 39),
            lambda x: x["authorities"]["wit"].update(path="../untrusted.wit"),
            lambda x: x["authorities"]["typeSpec"].update(path="generated/main.tsp"),
            lambda x: x["authorities"]["jsonSchema"].update(gitBlobSha="0" * 40),
            lambda x: x["authorities"].pop("wit"),
            lambda x: x["checks"].pop("nativeGuest"),
            lambda x: x["checks"].update(fakeGuest=pending()),
            lambda x: x.update(privateSourceExportAuthorized=True),
            lambda x: x.update(disposition="GUEST_CONFORMANCE_VERIFIED"),
            lambda x: x.update(extraClaim=True),
        ]
        for change in mutations:
            r = fixture()
            change(r)
            with self.subTest(change=str(change)):
                self.assertFalse(accepted(r))

    def test_evidence_digest_is_required_only_for_nonzero_execution(self):
        r = fixture()
        r["checks"]["witParser"].update(
            status="EXECUTED_UNATTESTED", executedSteps=1,
            executedTests=1, evidenceSha256="f" * 64)
        self.assertTrue(accepted(r))
        for bad in (None, "0" * 64, "F" * 64, "a" * 63):
            x = copy.deepcopy(r)
            x["checks"]["witParser"]["evidenceSha256"] = bad
            self.assertFalse(accepted(x))


    def test_pinned_real_contract_metadata_is_only_pending(self):
        # Bytes remain in the source repository; these are Git object identities,
        # NOT source transfer authorization or executed TypeSpec/WIT evidence.
        pinned = json.loads(
            (ROOT / "evidence/zorde-contract-handoff.pending.json").read_text("utf-8")
        )
        self.assertTrue(accepted(pinned))
        self.assertEqual(pinned["source"], {
            "repository": "ores-truffle-oreslang/oreslang-serialization-and-validation",
            "commitSha": "bafdbe8fd41aa7a220491acc03be4c6ce57a58fa",
            "treeSha": "8774cc6b4f817d469dd0bedca8301004917e3d9d",
        })
        self.assertEqual(
            {name: value["gitBlobSha"] for name, value in pinned["authorities"].items()},
            {
                "typeSpec": "c5728bd100f1dd36007918038fe54610e0259268",
                "jsonSchema": "0d8f3ca66952969e8aa9125e9ef427c313b89321",
                "wit": "8100dbe91514e38a11beea8070a5a5cfc6b639fc",
            }
        )
        self.assertEqual(pinned["disposition"], "STRUCTURE_ONLY_UNAUTHENTICATED")
        self.assertIs(pinned["privateSourceExportAuthorized"], False)
        for check in pinned["checks"].values():
            self.assertEqual(check, pending())

        # A human-edited forged promotion cannot be blessed by schema-only CI.
        for mutation in (
            lambda v: v.update(disposition="VERIFIED"),
            lambda v: v.update(privateSourceExportAuthorized=True),
            lambda v: v["checks"]["nativeGuest"].update(status="VERIFIED"),
            lambda v: v["checks"]["dualAuthority"].update(executedSteps=1),
        ):
            forged = copy.deepcopy(pinned)
            mutation(forged)
            self.assertFalse(accepted(forged))


if __name__ == "__main__":
    unittest.main()
