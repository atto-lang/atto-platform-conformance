"""Host-only AOT guest fixture and receipt integrity; no Atto compiler run."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/aot-adt-guarded-guest-v1.json"
S = importlib.util.spec_from_file_location("aot_adt_receipt", ROOT / "bin/verify_aot_adt_guest_receipt.py")
verify = importlib.util.module_from_spec(S)
S.loader.exec_module(verify)

class GuardedADTGuestMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MANIFEST.read_text())

    def test_pinned_source_and_exact_10_case_coverage(self):
        m = self.data
        self.assertEqual(m["schema"], "atto.aot-adt-guarded-guest.v1")
        self.assertEqual(m["source"]["commit"], "e2d18c418c9d46dde3e7bf4b1936d39139ffefee")
        self.assertEqual(m["source"]["root_tree"], "24035e0b26d52b56c770792cc7d6771e98262ec3")
        self.assertEqual(len(m["cases"]), 10)
        self.assertEqual(sum(r["kind"] == "pass" for r in m["cases"]), 5)
        self.assertEqual(sum(r["kind"] == "fail" for r in m["cases"]), 5)
        self.assertEqual(len({r["id"] for r in m["cases"]}), 10)

    def test_copy_is_original_git_blob_and_expected_result_header(self):
        for row in self.data["cases"]:
            with self.subTest(case=row["id"]):
                path = ROOT / row["path"]
                raw = path.read_bytes()
                self.assertEqual(path.name, pathlib.Path(row["upstream_path"]).name)
                sha = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\\0" + raw).hexdigest()
                self.assertEqual(sha, row["git_blob_sha"], "fixture altered since source PR")
                self.assertIn(b"pub fnc main(): int", raw)
                self.assertLess(len(raw), 20000)
                if row["kind"] == "pass":
                    self.assertIn(("// expect-exit: " + str(row["expected_exit"])).encode(), raw)
                    self.assertNotIn("expected_error", row)
                    stdout = [line.split(b": ",1)[1].decode() for line in raw.splitlines() if line.startswith(b"// expect-stdout: ")]
                    self.assertEqual(row["expected_stdout"], "".join(s + "\\n" for s in stdout))
                else:
                    self.assertIn(("// expect-error: " + row["expected_error"]).encode(), raw)
                    self.assertNotIn("expected_exit", row)

    def test_native_target_status_and_known_unsupported(self):
        self.assertEqual(set(self.data["backends"]), {"rust-wasm-precompiled","java-native-image","llvm-native","dotnet-nativeaot"})
        self.assertTrue(all(v == "NOT_EXECUTED" for v in self.data["backends"].values()))
        self.assertIn("Result<Option<int>,Error>", self.data["unsupported_not_yet_proven"])

    def specimen(self):
        m=self.data
        rows=[]
        for x in m["cases"]:
            row={"id":x["id"],"git_blob_sha":x["git_blob_sha"],"compile_invoked":True}
            if x["kind"] == "pass":
                row.update(compile_success=True,artifact_emitted=True,guest_executed=True,exit_code=x["expected_exit"],stdout=x["expected_stdout"])
            else:
                row.update(compile_success=False,artifact_emitted=False,guest_executed=False,error_code=x["expected_error"])
            rows.append(row)
        return {
            "schema":verify.SCHEMA,"target":"rust-wasm-precompiled",
            "source_commit":m["source"]["commit"],"source_root_tree":m["source"]["root_tree"],
            "compiler_commit":"a"*40,"compiler_tree":"b"*40,"build_artifact_sha256":"c"*64,
            "build_mode":"rust-wasm-precompiled","runtime_atto_compiler":False,"runtime_jit_required":False,
            "toolchain":"test-only hypothetical toolchain",
            "ci_run":{"url":"https://github.com/example/carrier/actions/runs/999","job_id":1,"steps_executed":True,"conclusion":"success"},
            "cases":rows
        }

    def test_receipt_mutants_must_fail_closed(self):
        modifications=[
            lambda x: x["cases"].pop(),
            lambda x: x["cases"][0].update(guest_executed=False),
            lambda x: x["cases"][0].update(exit_code=999),
            lambda x: x["cases"][0].update(git_blob_sha="0"*40),
            lambda x: x["cases"][-1].update(artifact_emitted=True),
            lambda x: x["cases"][-1].update(compile_success=True),
            lambda x: x.update(runtime_jit_required=True),
            lambda x: x.update(runtime_atto_compiler=True),
            lambda x: x.update(source_root_tree="0"*40),
            lambda x: x["ci_run"].update(steps_executed=False),
            lambda x: x["ci_run"].update(conclusion="failure"),
            lambda x: x.update(build_mode="managed-only"),
        ]
        for i,mutate in enumerate(modifications):
            with self.subTest(i=i):
                receipt = self.specimen()
                mutate(receipt)
                with self.assertRaises(verify.EvidenceError):
                    verify.validate(self.data,receipt)

    def test_structure_is_not_attestation(self):
        # An invented receipt can pass shape checks. Never promote a backend
        # to PASS without independently validating run/steps/real artifacts.
        self.assertEqual(verify.validate(self.data,self.specimen()), 10)

if __name__ == "__main__":
    unittest.main()
