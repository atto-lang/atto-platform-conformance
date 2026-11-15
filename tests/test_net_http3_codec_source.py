"""Exact-blob native Atto QUIC and HTTP3 test/receipt audit; not a wire test."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/net-http3-codec-v1.json"


def git_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


class Http3CodecSourceAudit(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(MANIFEST.read_text())

    def test_exhaustive_native_atto_fixtures_have_exact_bytes(self):
        self.assertEqual(self.manifest["schema"], "atto.conformance.http3.codec.v1")
        self.assertEqual(len(self.manifest["fixtures"]), 4)
        total = 0
        for record in self.manifest["fixtures"]:
            path = record["path"]
            self.assertTrue(path.startswith("fixtures/net/") and path.endswith(".atto"))
            src = (ROOT / path).read_bytes()
            self.assertEqual(git_sha(src), record["git_blob_sha"])
            self.assertTrue(src.startswith(b"// expect-exit: 42\n"))
            self.assertTrue(src.endswith(b"\n"))
            self.assertNotIn(b"\r", src)
            main = src.rsplit(b"pub fnc main(): int {", 1)[1]
            checks = sum(line.startswith(b"  if ") for line in main.splitlines())
            self.assertEqual(checks, record["cases"])
            self.assertEqual(record["expected_exit_code"], 42)
            total += checks
        self.assertEqual(total, 1255)

    def test_llvm_native_aot_receipt_is_real_and_scope_limited(self):
        evidence = self.manifest["llvm_native_aot_evidence"]
        raw = (ROOT / evidence["receipt"]).read_bytes()
        self.assertEqual(git_sha(raw), evidence["git_blob_sha"])
        receipt = json.loads(raw)
        self.assertEqual(receipt["runner"]["run"], evidence["url"])
        self.assertEqual(receipt["source_snapshot"]["commit"],
                         evidence["verified_source_head"])
        self.assertEqual(receipt["source_snapshot"]["full_tree"],
                         evidence["verified_source_tree"])
        self.assertEqual(sum(x["cases"] for x in receipt["fixtures"]), 1255)
        self.assertTrue(receipt["execution"]["actual_guest_execute"])
        self.assertTrue(receipt["execution"]["direct_cli_native_elf_verified"])
        self.assertTrue(receipt["execution"]["asan_ubsan_smoke_passed"])
        self.assertFalse(receipt["execution"]["runtime_guest_vm"])
        self.assertFalse(receipt["execution"]["runtime_jit"])
        self.assertFalse(evidence["actor_runtime"])
        self.assertFalse(evidence["quic_tls_network"])
        self.assertFalse(evidence["full_language_aot"])
        self.assertFalse(receipt["unsupported"]["http3_client_server_wire"])
        self.assertEqual(evidence["scalar_pure_cases"], 1255)

    def test_llvm_artifact_hardening_passes_without_wire_claims(self):
        r = self.manifest["llvm_native_aot_output_hardening"]
        raw = (ROOT / r["evidence"]).read_bytes()
        self.assertEqual(git_sha(raw), r["git_blob_sha"])
        proof = json.loads(raw)
        self.assertEqual(proof["status"],
                         "PASS_LINUX_X86_64_SCALAR_GUEST_AND_OUTPUT_HARDENING")
        self.assertEqual(proof["runner"]["run"], r["executed_run"])
        self.assertEqual(proof["audited_source_commit"],
                         r["exact_source_commit"])
        self.assertEqual(proof["audited_full_tree"],
                         r["exact_source_tree"])
        self.assertEqual(proof["verification"]["total_native_atto_cases"],
                         r["native_guests"])
        for guard in ("source_output_alias_rejected",
                      "hardlink_to_input_rejected",
                      "symlink_to_input_rejected",
                      "output_commits_only_after_full_success",
                      "prior_output_preserved_after_source_or_clang_failure",
                      "fake_successful_clang_without_artifact_rejected",
                      "fake_successful_clang_with_invalid_elf_rejected",
                      "verified_linux_x86_64_elf_header_and_executable_mode",
                      "staged_temporary_artifacts_removed"):
            self.assertTrue(proof["verification"][guard], guard)
        self.assertFalse(proof["limitations"]["http3_wire_client_server"])
        self.assertFalse(proof["limitations"]["actor_runtime_implemented"])
        self.assertFalse(r["quic_tls_wire_executed"])
        self.assertFalse(r["actor_runtime_executed"])

    def test_shared_native_actor_fixtures_are_sha_exact(self):
        rows = self.manifest["actor_fixtures"]
        self.assertEqual(len(rows), 7)
        passed = [r for r in rows if "/pass/" in r["path"]]
        rejected = [r for r in rows if "/fail/" in r["path"]]
        self.assertEqual(len(passed), 4)
        self.assertEqual(len(rejected), 3)
        self.assertEqual(sum(r["executions"] for r in passed), 80)
        for row in rows:
            path = row["path"]
            self.assertTrue(path.startswith("fixtures/actors/"))
            self.assertTrue(path.endswith(".atto"))
            self.assertEqual(git_sha((ROOT / path).read_bytes()),
                             row["git_blob_sha"])
            if row in passed:
                self.assertEqual(row["result"], "PASS_LLVM_NATIVE_ELF")
            else:
                self.assertEqual(row["result"], "REJECTED_LLVM_COMPILER")

    def test_llvm_bounded_actor_receipts_and_capacity_proof(self):
        e = self.manifest["llvm_actor_native_evidence"]
        early_raw = (ROOT / e["baseline_receipt"]).read_bytes()
        later_raw = (ROOT / e["hardening_receipt"]).read_bytes()
        self.assertEqual(git_sha(early_raw), e["baseline_sha"])
        self.assertEqual(git_sha(later_raw), e["hardening_sha"])
        early, later = json.loads(early_raw), json.loads(later_raw)
        self.assertEqual(early["carrier"]["run"], e["baseline_url"])
        self.assertEqual(early["source"]["full_git_tree"],
                         e["baseline_exact_tree"])
        self.assertEqual(later["runner"]["run"], e["hardening_url"])
        self.assertEqual(later["code_source"]["full_tree"],
                         e["hardening_exact_tree"])
        self.assertEqual(later["base_actor_receipt_blob"],
                         e["baseline_sha"])
        self.assertEqual(later["verified"]["maximum_actor_instances"],
                         e["actor_instance_limit_proven"])
        self.assertTrue(later["verified"]["maximum_actor_instances_actually_tested"])
        self.assertTrue(later["verified"]["thirty_third_spawn_rejected"])
        self.assertEqual(later["verified"]["abi_accepted_messages_total"],
                         e["concurrent_mailbox_messages"])
        self.assertEqual(later["verified"]["actor_native_guest_executions"],
                         e["guest_executions"])
        self.assertFalse(e["actual_quic_tls_http3_network"])
        self.assertFalse(e["full_actor_model"])
        self.assertEqual(e["actor_runtime_scope"],
                         "BOUNDED_LEGACY_ACTORS_ONLY")
        self.assertFalse(early["unsupported"]["supervisor_priority_control"])
        self.assertFalse(later["unsupported"]["critical_read_write_sealed_state"])

    def test_evidence_does_not_claim_actual_http3_networking(self):
        r = self.manifest["guest_evidence"]
        self.assertEqual(r["carrier_head"], "20fa8c4e421d5a438c1db337868bd66bbeb7a184")
        self.assertIn("/actions/runs/43645771501", r["carrier_workflow_run"])
        self.assertEqual(r["compiler_source_head"], "860137bcdc50684ab6cb6aa8f89932506b3beec4")
        self.assertEqual(r["host_imports"], 0)
        self.assertTrue(r["deterministic_wasm"])
        self.assertFalse(r["actual_network_io"])
        self.assertFalse(r["native_machine_aot_test"])
        self.assertEqual([x["cases"] for x in r["results"]], [308, 406])
        self.assertEqual([x["actual_exit_code"] for x in r["results"]], [42, 42])
        old = r
        self.assertEqual(old["evidence_scope"],
                         "HISTORICAL_GUEST_BEFORE_62BIT_AND_STATE_HARDENING")
        hard = self.manifest["hardening_evidence"]
        self.assertIn("/actions/runs/43647064377", hard["run"])
        self.assertEqual(hard["carrier_head"], "943f4186932bc9a49a1067e0f5535273cd0d2665")
        self.assertEqual(hard["source_compiler_commit"],
                         "860137bcdc50684ab6cb6aa8f89932506b3beec4")
        self.assertEqual(hard["cases"], 1255)
        self.assertEqual(hard["additional_cases_vs_pre_hardening"], 541)
        self.assertEqual(hard["host_imports"], 0)
        self.assertTrue(hard["guest_wasm_compiled"])
        self.assertTrue(hard["guest_wasm_executed"])
        self.assertTrue(hard["deterministic_artifacts"])
        self.assertEqual(hard["expected_exit_code"], 42)
        self.assertEqual(hard["negative_input"], "E_UNBOUND_FAIL_CLOSED")
        self.assertFalse(hard["network_execution"])
        self.assertFalse(hard["other_backend_execution"])
        self.assertFalse(hard["native_machine_aot"])
        self.assertEqual(
            [row["path"] for row in hard["fixture_artifacts"]],
            [row["path"] for row in self.manifest["fixtures"]],
        )
        self.assertEqual(self.manifest["status"],
                         "RS_WASM_AND_LLVM_ELF_SCALAR_GUESTS_PASSED_NO_HTTP3_WIRE")
        self.assertEqual({x["backend"] for x in self.manifest["targets"]},
                         {"llvm", "java", "net", "rs", "wasm"})
        for x in self.manifest["targets"]:
            self.assertEqual(x["http3_wire"], "NOT_IMPLEMENTED")
            self.assertEqual(x["client_server_loopback"], "NOT_EXECUTED")
            if x["backend"] == "rs":
                self.assertEqual(x["guest_codec_execution"], "PASS_RUST_TO_WASM")
            elif x["backend"] == "llvm":
                self.assertEqual(x["guest_codec_execution"], "PASS_LLVM_NATIVE_ELF_SCALAR_AOT")
                self.assertTrue(x["scalar_zero_guest_gc"])
                self.assertEqual(x["actor_runtime"],
                                 "PASS_BOUNDED_NATIVE_LEGACY_ACTOR_ONLY")
                self.assertTrue(x["native_actor_arena_isolated"])
                self.assertFalse(x["actor_vm_or_jit_required"])
                self.assertFalse(x["new_receiver_mtd_supported"])
                self.assertFalse(x["sealed_state_critical_supported"])
                self.assertFalse(x["actor_supervisor_control_supported"])
            else:
                self.assertEqual(x["guest_codec_execution"], "NOT_EXECUTED")


if __name__ == "__main__":
    unittest.main()
