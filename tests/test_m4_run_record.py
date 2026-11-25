"""Structural record validation only: not an authenticated CI attestation."""
import copy
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "contracts/m4-shared-actor-counter-v1.json").read_text())
EVIDENCE = json.loads((ROOT / "evidence/m4/dual-native-actor-observations-20261107.json").read_text())
SHA40 = re.compile("[0-9a-f]{40}\Z")
SHA64 = re.compile("[0-9a-f]{64}\Z")

def require(cond, cause):
    if not cond:
        raise AssertionError(cause)

def validate(m):
    require(m["schema"] == "atto.m4.actual-dual-native-runs.v1", "schema")
    source = m["source"]
    fixture = ROOT / CONTRACT["fixture"]
    raw = fixture.read_bytes()
    expected_sha256 = hashlib.sha256(raw).hexdigest()
    require(source["path"] == CONTRACT["fixture"], "fixture path")
    require(source["git_blob_sha"] == CONTRACT["source_git_blob_sha"], "source git blob")
    require(source["sha256"] == expected_sha256, "fixture sha256")
    require(m["claim"] == "TWO_COMPILER_EXECUTED_IDENTICAL_SOURCE_RESTRICTED_ACTOR_OBSERVATIONS",
            "claim inflated")
    for key, repo in [("llvm", "atto-source.llvm"), ("graalvm-native", "atto-source.java")]:
        run = m[key]
        require(SHA40.fullmatch(run["head_sha"]) is not None, "head sha")
        require(run["run_url"].startswith("https://github.com/atto-lang/" + repo +
                                          "/actions/runs/"), "run URL")
        require(run["conclusion"] == "success", "workflow conclusion")
        require(run["runtime_executed"] is True, "executed guest")
        require(type(run["executed_steps"]) is int and run["executed_steps"] >= 3,
                "zero-step or fake-executed job")
        require(SHA64.fullmatch(run["native_artifact_sha256"]) is not None,
                "artifact SHA256 missing")
        require("limits" in run and len(run["limits"]) >= 80, "scope absent")
    e = CONTRACT["expected"]
    a = m["llvm"]["observed"]
    b = m["graalvm-native"]["observed"]
    require(a == {"main_return":e["return_i64"], "host_actor_calls":e["sends"],
                  "host_actor_stops":e["stops"], "host_reply_digest":e["rolling_digest"],
                  "compiled_main_guest_drained":True}, "LLVM outcome")
    require(b == {"main_return":e["return_i64"], "synchronous_guest_sends":e["sends"],
                  "actor_arena_closes":e["stops"],
                  "guest_actor_state_digest":e["rolling_digest"],
                  "gc_collection_delta":0}, "Graal outcome")
    require("checked-in receipt is structural evidence" in " ".join(m["limitations"]),
            "receipt must disclaim unauthenticated provenance")
    status = m["release_gate_status"]
    require(status["identical_source_compiled_guest_execution"] == "OBSERVED_TWO_BACKENDS",
            "observed dual fixture not recorded")
    for key in ("independent_actor_scheduler_equivalence", "ownership_type_checker_parity",
                "cross_tenant_adversarial_security", "graalvm_zero_gc_long_lived_heap_soak",
                "five_backend_parity"):
        require(status[key] == "NOT_EXECUTED", "unearned backend/security certification")
    return True

class M4EvidenceRecordTests(unittest.TestCase):
    def test_record_consistent_but_not_authenticated(self):
        self.assertTrue(validate(EVIDENCE))

    def denied(self, mutation):
        record = copy.deepcopy(EVIDENCE)
        mutation(record)
        with self.assertRaises((AssertionError, KeyError, TypeError)):
            validate(record)

    def test_wrong_source_hash(self):
        self.denied(lambda r: r["source"].update(sha256="0"*64))

    def test_llvm_guest_not_run(self):
        self.denied(lambda r: r["llvm"].update(runtime_executed=False))

    def test_graal_zero_step_job(self):
        self.denied(lambda r: r["graalvm-native"].update(executed_steps=0))

    def test_fake_native_digest(self):
        self.denied(lambda r: r["llvm"].update(native_artifact_sha256="pending"))

    def test_crossed_ci_urls(self):
        self.denied(lambda r: r["llvm"].update(
            run_url=r["graalvm-native"]["run_url"]))

    def test_llvm_wrong_guest_return(self):
        self.denied(lambda r: r["llvm"]["observed"].update(main_return=44))

    def test_graal_wrong_actor_digest(self):
        self.denied(lambda r: r["graalvm-native"]["observed"].update(
            guest_actor_state_digest=999))

    def test_graal_fake_no_gc(self):
        self.denied(lambda r: r["graalvm-native"]["observed"].update(
            gc_collection_delta="UNKNOWN"))

    def test_no_scheduler_claim_without_execution(self):
        self.denied(lambda r: r["release_gate_status"].update(
            independent_actor_scheduler_equivalence="PASSED"))

    def test_no_five_backend_claim(self):
        self.denied(lambda r: r["release_gate_status"].update(
            five_backend_parity="PASSED"))

    def test_no_tenant_security_claim(self):
        self.denied(lambda r: r["release_gate_status"].update(
            cross_tenant_adversarial_security="PASSED"))

    def test_no_provenance_disclaimer_removal(self):
        self.denied(lambda r: r.update(limitations=[]))

if __name__ == "__main__":
    unittest.main()
