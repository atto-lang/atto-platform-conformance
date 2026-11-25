import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("aot_gc_validator", ROOT / "bin/verify_aot_gc_receipt.py")
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
M = json.loads((ROOT / "contracts/aot-gc-tenant-evidence-v1.json").read_text())


def receipt(profile="llvm-native-aot", case="counter-source-aot"):
    p = M["profiles"][profile]
    fixture = next(c["fixture"] for c in M["cases"] if c["id"] == case)
    blob = next(f["git_blob_sha"] for f in M["fixtures"] if f["id"] == fixture)
    r = {
        "profile": profile, "case_id": case, "status": "passed",
        "evidence_kind": "compiled-guest",
        "guest_executed": True, "runtime_jit_used": False,
        "artifact_kind": p["artifact_kind"], "selected_gc": p["selected_gc"],
        "command": "atto-llvmc source.atto && ./source",
        "source_head_sha": "a" * 40, "compiler_head_sha": "b" * 40,
        "artifact_sha256": "c" * 64, "guest_fixture_sha256": "d" * 64,
        "fixture_blob_sha": blob, "run_id": 123,
        "workflow_url": "https://github.com/atto-lang/atto-source.llvm/actions/runs/123",
        "executed_job_steps": 7, "exit_code": 0,
    }
    if case in {"two-tenant-state-isolation", "stale-actor-handle-denial", "cross-tenant-unauthorized-pointer"}:
        r.update(boundary="validated-wasm-isolate",
                 enforcement_tested=True, capabilities_authorized=True)
    if case == "actor-tenant-recycling-soak":
        r.update(
            actor_operations=100000, tenant_restarts=100, heap_samples=12,
            heap_start_bytes=1000, heap_end_bytes=1000,
            heap_high_water_bytes=1500, managed_heap_budget_bytes=2000,
            peak_rss_bytes=5000, rss_budget_bytes=6000,
            arena_bytes_before=0, arena_bytes_after=0, arena_slack_bytes=0,
            gc_collections_before=0, gc_collections_after=0,
            gc_pause_p99_ms=0.0, gc_pause_budget_p99_ms=0.0,
        )
    return r


class EvidenceTests(unittest.TestCase):
    def fails(self, r):
        with self.assertRaises(gate.ReceiptError):
            gate.validate_receipt(r, M)

    def test_manifest_sources_are_exact_git_blobs(self):
        cases, fixtures = gate.validate_manifest(M)
        self.assertEqual(len(fixtures), 2)
        self.assertEqual(len(cases), 6)

    def test_positive_synthetic_shape_is_not_trusted_provenance(self):
        gate.validate_receipt(receipt(), M)
        gate.validate_receipt(receipt("graal-native-epsilon-aot", "actor-tenant-recycling-soak"), M)

    def test_zero_step_ci_rejected(self):
        r = receipt()
        r["executed_job_steps"] = 0
        self.fails(r)

    def test_host_only_fraud_rejected(self):
        r = receipt()
        r["evidence_kind"] = "native-host"
        self.fails(r)

    def test_jit_rejected_for_native_aot(self):
        r = receipt("graal-native-epsilon-aot")
        r["runtime_jit_used"] = True
        self.fails(r)

    def test_jvm_artifact_rejected_as_native_aot(self):
        r = receipt()
        r["artifact_kind"] = "jvm-bytecode"
        self.fails(r)

    def test_false_epsilon_selection_rejected(self):
        r = receipt("graal-native-epsilon-aot")
        r["selected_gc"] = "serial"
        self.fails(r)

    def test_wrong_fixture_blob_rejected(self):
        r = receipt()
        r["fixture_blob_sha"] = "a" * 40
        self.fails(r)

    def test_forged_artifact_id_rejected(self):
        r = receipt()
        r["artifact_sha256"] = "pending"
        self.fails(r)

    def test_unexecuted_requires_reason(self):
        r = {"profile": "forge-native-aot", "case_id": "counter-source-aot",
             "status": "not_executed"}
        self.fails(r)
        r["reason"] = "No native compiler guest test"
        gate.validate_receipt(r, M)

    def test_unexecuted_cannot_claim_guest(self):
        r = {"profile": "net-native-aot", "case_id": "counter-source-aot",
             "status": "unsupported", "reason": "Not implemented", "guest_executed": True}
        self.fails(r)

    def test_arena_cannot_claim_sandbox(self):
        r = receipt(case="two-tenant-state-isolation")
        r["boundary"] = "actor-arena-only"
        self.fails(r)

    def test_security_must_actually_execute_enforcement(self):
        r = receipt(case="stale-actor-handle-denial")
        r["enforcement_tested"] = False
        self.fails(r)

    def test_epsilon_collection_fails(self):
        r = receipt("graal-native-epsilon-aot", "actor-tenant-recycling-soak")
        r["gc_collections_after"] = 1
        self.fails(r)

    def test_missing_heap_samples_fails(self):
        r = receipt(case="actor-tenant-recycling-soak")
        r["heap_samples"] = 1
        self.fails(r)

    def test_unbounded_peak_rss_fails(self):
        r = receipt(case="actor-tenant-recycling-soak")
        r["peak_rss_bytes"] = 8000
        self.fails(r)

    def test_nonreclaimed_actor_arena_fails(self):
        r = receipt(case="actor-tenant-recycling-soak")
        r["arena_bytes_after"] = 16
        self.fails(r)

    def test_bounded_heap_requires_true_peak(self):
        r = receipt(case="actor-tenant-recycling-soak")
        r["heap_high_water_bytes"] = 100
        self.fails(r)

    def test_gc_probe_cannot_be_marked_missing_as_zero(self):
        r = receipt("graal-native-epsilon-aot", "actor-tenant-recycling-soak")
        r["gc_collections_after"] = None
        self.fails(r)

    def test_baseline_cannot_promote_without_execution(self):
        m = copy.deepcopy(M)
        m["default_statuses"]["llvm"] = "passed"
        with self.assertRaises(gate.ReceiptError):
            gate.validate_manifest(m)


if __name__ == "__main__":
    unittest.main()
