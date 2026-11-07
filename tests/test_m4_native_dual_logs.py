"""Negative evidence controls: synthetic samples are NOT real guest evidence."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "bin/check_m4_native_dual_logs.py"
SPEC = importlib.util.spec_from_file_location("m4_native_logs", MODULE)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
CONTRACT = json.loads((ROOT / "contracts/m4-shared-actor-counter-v1.json").read_text())

def samples():
    src = (ROOT / CONTRACT["fixture"]).read_bytes()
    sha256 = hashlib.sha256(src).hexdigest()
    blob = CONTRACT["source_git_blob_sha"]
    llvm = "\n".join([
        "ATTO_M4_IDENTICAL_SOURCE_GIT_BLOB=" + blob,
        "ATTO_M4_LLVM_GUEST_SOURCE_SHA256=" + sha256,
        "ATTO_M4_LLVM_COMPILER_GENERATED_IDENTICAL_SOURCE_GUEST=PASSED",
        "ATTO_M4_LLVM_SOURCE_GUEST_RETURN=43",
        "ATTO_M4_LLVM_ACTOR_CALLS_OBSERVED=3",
        "ATTO_M4_LLVM_OBSERVATION_ACTOR_STOPS=2",
        "ATTO_M4_LLVM_HOST_OBSERVED_ACTOR_DIGEST=7021",
        "ATTO_M4_LLVM_MAIN_GUEST_DRAINED=1",
    ])
    graal = "\n".join([
        "ATTO_M4_IDENTICAL_SOURCE_GIT_BLOB=" + blob,
        "ATTO_GUEST_SOURCE_SHA256=" + sha256,
        "ATTO_STATIC_ACTOR_GRAAL_EPSILON_NATIVE_GUEST=PASSED",
        "ATTO_GUEST_NATIVE_AOT_RETURN=43",
        "ATTO_GUEST_ACTOR_SENDS=3",
        "ATTO_GUEST_ACTOR_CLOSES=2",
        "ATTO_GUEST_ACTOR_STATE_DIGEST=7021",
        "ATTO_GUEST_GC_DELTA=0",
    ])
    metadata = {
        "llvm": {"head_sha": "a" * 40, "conclusion": "success",
                 "runtime_executed": True, "executed_steps": 8,
                 "run_url": "https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
                 "native_artifact_sha256": "1" * 64},
        "graalvm-native": {"head_sha": "b" * 40, "conclusion": "success",
                           "runtime_executed": True, "executed_steps": 7,
                           "run_url": "https://github.com/atto-lang/atto-source.java/actions/runs/124",
                           "native_artifact_sha256": "2" * 64},
    }
    return llvm, graal, metadata

class DualNativeLogs(unittest.TestCase):
    def test_matching_synthetic_shape_is_not_authenticated(self):
        llvm, graal, metadata = samples()
        result = gate.validate_log_pairs(llvm, graal, metadata, CONTRACT)
        self.assertEqual(result["status"], "STRUCTURALLY_CONSISTENT_UNAUTHENTICATED")
        self.assertIn("independent scheduling", " ".join(result["unproven"]))

    def fail(self, llvm=None, graal=None, mutate=None, contract=None):
        original_llvm, original_graal, meta = samples()
        if mutate:
            mutate(meta)
        with self.assertRaises(gate.EvidenceError):
            gate.validate_log_pairs(
                original_llvm if llvm is None else llvm,
                original_graal if graal is None else graal,
                meta, CONTRACT if contract is None else contract)

    def test_reject_missing_llvm_runtime_return(self):
        a, _, _ = samples()
        self.fail(llvm=a.replace("ATTO_M4_LLVM_SOURCE_GUEST_RETURN=43", ""))

    def test_reject_graal_wrong_return(self):
        _, b, _ = samples()
        self.fail(graal=b.replace("ATTO_GUEST_NATIVE_AOT_RETURN=43", "ATTO_GUEST_NATIVE_AOT_RETURN=44"))

    def test_reject_wrong_digest(self):
        a, _, _ = samples()
        self.fail(llvm=a.replace("ACTOR_DIGEST=7021", "ACTOR_DIGEST=7020"))

    def test_reject_conflicting_repeated_marker(self):
        a, _, _ = samples()
        self.fail(llvm=a + "\nATTO_M4_LLVM_SOURCE_GUEST_RETURN=44\n")

    def test_identical_repeated_marker_is_allowed(self):
        a, b, meta = samples()
        a += "\nATTO_M4_LLVM_SOURCE_GUEST_RETURN=43\n"
        self.assertEqual(gate.validate_log_pairs(a, b, meta, CONTRACT)["return"], 43)

    def test_reject_wrong_source_git_blob(self):
        a, _, _ = samples()
        self.fail(llvm=a.replace(CONTRACT["source_git_blob_sha"], "0" * 40))

    def test_reject_fake_source_sha256(self):
        _, b, _ = samples()
        self.fail(graal=b.replace("ATTO_GUEST_SOURCE_SHA256=", "ATTO_GUEST_SOURCE_SHA256=0"))

    def test_reject_graal_nonzero_collection(self):
        _, b, _ = samples()
        self.fail(graal=b.replace("ATTO_GUEST_GC_DELTA=0", "ATTO_GUEST_GC_DELTA=1"))

    def test_reject_llvm_missing_drain(self):
        a, _, _ = samples()
        self.fail(llvm=a.replace("ATTO_M4_LLVM_MAIN_GUEST_DRAINED=1", "ATTO_M4_LLVM_MAIN_GUEST_DRAINED=0"))

    def test_reject_zero_executed_steps(self):
        self.fail(mutate=lambda m: m["llvm"].update(executed_steps=0))

    def test_reject_unexecuted_gha_job(self):
        self.fail(mutate=lambda m: m["graalvm-native"].update(runtime_executed=False))

    def test_reject_failed_job(self):
        self.fail(mutate=lambda m: m["llvm"].update(conclusion="failure"))

    def test_reject_misleading_other_repository(self):
        self.fail(mutate=lambda m: m["llvm"].update(
            run_url="https://github.com/atto-lang/atto-source.java/actions/runs/123"))

    def test_reject_invalid_artifact_digest(self):
        self.fail(mutate=lambda m: m["llvm"].update(native_artifact_sha256="pending"))

    def test_reject_unverified_source_head(self):
        self.fail(mutate=lambda m: m["llvm"].update(head_sha="unknown"))

    def test_reject_graal_message_count_mismatch(self):
        _, b, _ = samples()
        self.fail(graal=b.replace("ATTO_GUEST_ACTOR_SENDS=3", "ATTO_GUEST_ACTOR_SENDS=2"))

    def test_reject_missing_host_actor_reply_evidence(self):
        a, _, _ = samples()
        self.fail(llvm=a.replace("ATTO_M4_LLVM_ACTOR_CALLS_OBSERVED=3", ""))

    def test_reject_falsified_contract(self):
        fake = copy.deepcopy(CONTRACT)
        fake["expected"]["return_i64"] = 44
        self.fail(contract=fake)

if __name__ == "__main__":
    unittest.main()
