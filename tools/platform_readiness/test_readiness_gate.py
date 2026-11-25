"""Adversarial source-free readiness tests; no GitHub API or private sources."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from readiness_gate import InvalidEvidence, evaluate, read_snapshot

HEAD = "a"*40
STEP = {"name":"Real guest tests","status":"completed","conclusion":"success"}
JOB = {"head_sha":HEAD,"run_id":123,"run_attempt":1,"job_id":456,
       "status":"completed","conclusion":"success","steps":[STEP]}
PR = {"repository":"ores-truffle-oreslang/oreslang-platform.mobile",
      "number":17,"head_sha":HEAD,"author":"author","draft":False,"mergeable":True,
      "approvals":["reviewer"],"ci_job":JOB}
BACKEND = {"guest_execution":"EXECUTED","source_sha":HEAD,
           "artifact_sha256":"b"*64,"compiler_executed":True,
           "guest_executed":True,"verified_output":True,"source_ci_job":JOB}
GOOD = {"schema":"atto.platform.readiness.v1","snapshot_date":"2026-11-06",
        "source_organization":"ores-truffle-oreslang",
        "protection":{"main_protection_verified":True,"independent_review_enforced":True},
        "security":{"cross_org_export_requested":False,"open_export_incidents":[]},
        "pull_requests":[PR],
        "backends":{name:BACKEND for name in ("java","llvm","wasm","forge","net")}}

class ReadinessTests(unittest.TestCase):
    def data(self):
        return copy.deepcopy(GOOD)

    def blocked(self, data, finding):
        result=evaluate(data)
        self.assertEqual(result["merge_state"],"BLOCKED")
        self.assertIn(finding,result["pull_requests"][0]["findings"])

    def invalid(self, data):
        with self.assertRaises(InvalidEvidence):
            evaluate(data)

    def test_all_green_remains_advisory(self):
        result=evaluate(self.data())
        self.assertEqual(result["merge_state"],"REQUIRES_LIVE_ATTESTATION")
        self.assertEqual(result["release_state"],"REQUIRES_LIVE_ATTESTATION")
        self.assertIn("NEVER_AUTHORIZES",result["limit"])

    def test_draft(self):
        s=self.data();s["pull_requests"][0]["draft"]=True;self.blocked(s,"DRAFT")

    def test_conflict(self):
        s=self.data();s["pull_requests"][0]["mergeable"]=False;self.blocked(s,"CONFLICT")

    def test_protection_absent(self):
        s=self.data();s["protection"]["main_protection_verified"]=False
        self.blocked(s,"PROTECTION_UNVERIFIED")

    def test_unenforced_review(self):
        s=self.data();s["protection"]["independent_review_enforced"]=False
        self.blocked(s,"REVIEW_ENFORCEMENT_UNVERIFIED")

    def test_no_review(self):
        s=self.data();s["pull_requests"][0]["approvals"]=[]
        self.blocked(s,"NO_INDEPENDENT_REVIEW")

    def test_self_review(self):
        s=self.data();s["pull_requests"][0]["approvals"]=["AUTHOR"]
        self.blocked(s,"NO_INDEPENDENT_REVIEW")

    def test_zero_step(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["steps"]=[]
        self.blocked(s,"NO_EXECUTED_STEPS")

    def test_housekeeping_only_is_not_test(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["steps"]=[
          {"name":"Set up job","status":"completed","conclusion":"success"},
          {"name":"Complete job","status":"completed","conclusion":"success"}]
        self.blocked(s,"NO_TEST_STEP_EVIDENCE")

    def test_checkout_setup_upload_only_is_not_execution(self):
        s=self.data()
        s["pull_requests"][0]["ci_job"]["steps"]=[
            {"name":"Run actions/checkout@1111111111111111111111111111111111111111","status":"completed","conclusion":"success"},
            {"name":"Run actions/setup-python@2222222222222222222222222222222222222222","status":"completed","conclusion":"success"},
            {"name":"Upload test results artifact","status":"completed","conclusion":"success"},
            {"name":"Post Run actions/checkout@1111111111111111111111111111111111111111","status":"completed","conclusion":"success"}]
        self.blocked(s,"NO_TEST_STEP_EVIDENCE")

    def test_build_and_metadata_only_are_not_guest_execution(self):
        s=self.data()
        s["pull_requests"][0]["ci_job"]["steps"]=[
            {"name":"Confirm exact checked-out commit","status":"completed","conclusion":"success"},
            {"name":"Build native compiler","status":"completed","conclusion":"success"},
            {"name":"Verify source SHA","status":"completed","conclusion":"success"}]
        self.blocked(s,"NO_TEST_STEP_EVIDENCE")

    def test_sourcefree_regression_steps_are_only_advisory(self):
        s=self.data()
        s["pull_requests"][0]["ci_job"]["steps"]=[
            {"name":"Execute source-free offline gate regression tests","status":"completed","conclusion":"success"}]
        self.assertEqual(evaluate(s)["merge_state"],"REQUIRES_LIVE_ATTESTATION")

    def test_real_native_assertions_candidate_remains_advisory(self):
        s=self.data()
        s["pull_requests"][0]["ci_job"]["steps"]=[
            {"name":"Execute native syntax assertions with real engine","status":"completed","conclusion":"success"}]
        self.assertEqual(evaluate(s)["merge_state"],"REQUIRES_LIVE_ATTESTATION")

    def test_action_name_with_test_token_cannot_spoof_execution(self):
        s=self.data()
        s["pull_requests"][0]["ci_job"]["steps"]=[
            {"name":"Run actions/setup-tests@3333333333333333333333333333333333333333","status":"completed","conclusion":"success"}]
        self.blocked(s,"NO_TEST_STEP_EVIDENCE")

    def test_wrong_head(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["head_sha"]="c"*40
        self.blocked(s,"HEAD_MISMATCH")

    def test_failed_job(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["conclusion"]="failure"
        self.blocked(s,"CI_NOT_SUCCESSFUL")

    def test_failed_step(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["steps"][0]["conclusion"]="failure"
        self.blocked(s,"STEP_NOT_SUCCESSFUL")

    def test_missing_attempt(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["run_attempt"]=None
        self.blocked(s,"RUN_ATTEMPT_UNVERIFIED")

    def test_boolean_run_id_rejected(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["run_id"]=True
        self.invalid(s)

    def test_boolean_attempt_rejected(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["run_attempt"]=True
        self.invalid(s)

    def test_duplicate_pr_rejected(self):
        s=self.data();s["pull_requests"]=[PR,copy.deepcopy(PR)]
        self.invalid(s)

    def test_missing_backend_rejected(self):
        s=self.data();s["backends"].pop("forge");self.invalid(s)

    def test_extra_field_rejected(self):
        s=self.data();s["extra"]="fake-approval";self.invalid(s)

    def test_unpinned_artifact(self):
        s=self.data();s["backends"]["llvm"]["artifact_sha256"]=None
        self.assertIn("SOURCE_OR_ARTIFACT_NOT_PINNED",evaluate(s)["backend_findings"]["llvm"])

    def test_guest_not_executed(self):
        s=self.data();s["backends"]["net"]["guest_execution"]="NOT_EXECUTED"
        self.assertIn("COMPILED_GUEST_NOT_EXECUTED",evaluate(s)["backend_findings"]["net"])

    def test_missing_guest_receipt(self):
        s=self.data();s["backends"]["wasm"]["source_ci_job"]=None
        self.assertIn("SOURCE_CI_RECEIPT_MISSING",evaluate(s)["backend_findings"]["wasm"])

    def test_export_denied_with_incident(self):
        s=self.data();s["security"]={"cross_org_export_requested":True,"open_export_incidents":["#22"]}
        self.assertEqual(evaluate(s)["export_state"],"BLOCKED")

    def test_export_not_authorized_even_without_incident(self):
        s=self.data();s["security"]={"cross_org_export_requested":True,"open_export_incidents":[]}
        self.assertEqual(evaluate(s)["export_state"],"BLOCKED")

    def test_invalid_date(self):
        s=self.data();s["snapshot_date"]="2026-02-30";self.invalid(s)

    def test_valid_leap_date(self):
        s=self.data();s["snapshot_date"]="2028-02-29"
        self.assertEqual(evaluate(s)["schema"],"atto.platform.readiness.result.v1")

    def test_duplicate_json_key(self):
        self.assert_bad_json('{"a":1,"\\u0061":2}')

    def test_invalid_utf16_surrogate(self):
        self.assert_bad_json(r'{"title":"\uD800"}')

    def test_nonfinite_exponent(self):
        self.assert_bad_json('{"value":1e9999}')

    def test_nan_constant(self):
        self.assert_bad_json('{"value":NaN}')

    def test_trailing_garbage(self):
        self.assert_bad_json('{}{}')

    def test_oversize_file(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"large.json";f.write_bytes(b"x"*1048577)
            with self.assertRaises(InvalidEvidence):read_snapshot(f)

    def test_cli_never_returns_zero_for_green_offline(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"good.json";f.write_text(json.dumps(self.data()))
            exe=Path(__file__).with_name("readiness_gate.py")
            result=subprocess.run([sys.executable,str(exe),str(f)],capture_output=True,text=True)
            self.assertEqual(result.returncode,3)

    def test_cli_fails_for_zero_step(self):
        s=self.data();s["pull_requests"][0]["ci_job"]["steps"]=[]
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"blocked.json";f.write_text(json.dumps(s))
            exe=Path(__file__).with_name("readiness_gate.py")
            result=subprocess.run([sys.executable,str(exe),str(f)],capture_output=True,text=True)
            self.assertEqual(result.returncode,1)

    def assert_bad_json(self, raw):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/"evidence.json";f.write_text(raw)
            with self.assertRaises(InvalidEvidence):read_snapshot(f)

    def test_safe_json_integer_boundary_is_admitted(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "safe.json"
            f.write_text('{"id":9007199254740991}', encoding="utf-8")
            value, _ = read_snapshot(f)
            self.assertEqual(value["id"], 9007199254740991)

    def test_unsafe_positive_json_integer_denied(self):
        self.assert_bad_json('{"id":9007199254740992}')

    def test_unsafe_negative_json_integer_denied(self):
        self.assert_bad_json('{"id":-9007199254740992}')

    def test_unsafe_direct_pr_number_denied(self):
        s = self.data()
        s["pull_requests"][0]["number"] = 9007199254740992
        self.invalid(s)

    def test_unsafe_direct_job_id_denied(self):
        s = self.data()
        s["pull_requests"][0]["ci_job"]["job_id"] = 9007199254740992
        self.invalid(s)

    def test_exact_64_level_array_budget_admitted(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "bounded.json"
            f.write_text("[" * 64 + "0" + "]" * 64, encoding="utf-8")
            value, _ = read_snapshot(f)
            self.assertIsInstance(value, list)

    def test_65_level_array_budget_denied(self):
        self.assert_bad_json("[" * 65 + "0" + "]" * 65)

    def test_pathological_deep_json_denied_without_uncaught_recursion(self):
        self.assert_bad_json("[" * 1500 + "0" + "]" * 1500)

    def test_more_than_20000_json_nodes_denied(self):
        self.assert_bad_json("[" + ",".join(["0"] * 20001) + "]")

    def test_nested_escaped_surrogate_remains_denied(self):
        self.assert_bad_json('{"sub":{"value":"\\ud800"}}')


if __name__ == "__main__":
    unittest.main()
