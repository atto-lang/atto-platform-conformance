"""Fail-closed source/metadata validation, NOT compiled guest execution."""
import copy
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/hosted-http-namespace-parity-v1.json"
BACKENDS = {"llvm", "java", "net", "wasm", "rs", "forge", "cranelift", "js",
            "atto", "hdl", "realtime"}
NEGATIVES = {"PRIVATE_MODULE_EXPORT_DENIED",
             "PRIVATE_NAMESPACE_MEMBER_DENIED",
             "UNREGISTERED_BUILTIN_DENIED",
             "DUPLICATE_IMPORT_BINDING"}
POSITIVES = {"BUILTIN_NAMESPACE", "PUBLIC_MODULE"}
SOURCE_ROOT = "fixtures/hosted-async-http-fs-v1/namespace/"


def valid_manifest(data: dict, root: Path = ROOT) -> bool:
    if not isinstance(data, dict) or set(data) != {
        "schema", "status", "authority", "source_policy", "canonical_import",
        "selective_import", "public_module_declaration",
        "default_module_visibility", "import_contract", "fixtures",
        "execution_rules", "backends"
    }:
        return False
    if (data["schema"] != "atto.namespace_http.import_parity.v1"
            or data["status"] != "ALL_NOT_EXECUTED"
            or data["source_policy"] != "COMPILER_OWNED_BACKEND_LOCAL_NATIVE_ATTO"
            or data["canonical_import"] != 'import * as http from "std.http";'
            or data["selective_import"] !=
            'import module http3 from "./library_public.atto";'
            or data["public_module_declaration"] != "define pub module http3 as"
            or data["default_module_visibility"] != "PRIVATE"):
        return False
    c = data["import_contract"]
    if (set(c) != {"builtin", "symbol", "symbol_return", "argument",
                   "example_true", "example_false",
                   "builtin_must_be_registered",
                   "ambient_file_or_package_fallback",
                   "module_export_visibility",
                   "module_namespace_and_selective_module_differ",
                   "capability_granted_by_import"}
            or c["builtin"] != "std.http"
            or c["symbol"] != "status_valid"
            or c["symbol_return"] != "bool"
            or c["argument"] != "int"
            or c["example_true"] != 200
            or c["example_false"] != 99
            or not isinstance(c["builtin_must_be_registered"], bool)
            or c["builtin_must_be_registered"] is not True
            or c["ambient_file_or_package_fallback"] is not False
            or c["module_export_visibility"] != "PUBLIC_ONLY"
            or c["module_namespace_and_selective_module_differ"] is not True
            or c["capability_granted_by_import"] is not False):
        return False
    rules = data["execution_rules"]
    required_rules = {
        "test_only_if_compiler_supports_target",
        "must_compile_real_atto_source",
        "must_use_registered_builtin_bytes",
        "guest_steps_required",
        "host_shim_only_not_sufficient",
        "source_only_not_sufficient",
        "all_negative_cases_required",
        "exact_head_and_case_hash_required",
        "unavailable_or_incomplete_is_not_executed",
        "explicit_unsupported_must_be_reported_without_faked_pass",
    }
    if set(rules) != required_rules or any(rules[k] is not True for k in required_rules):
        return False
    backends = data["backends"]
    if not isinstance(backends, list) or len(backends) != len(BACKENDS):
        return False
    observed = set()
    for b in backends:
        if not isinstance(b, dict) or set(b) != {
            "backend", "repository", "profile", "execution",
            "executed_guest_cases", "evidence"
        }:
            return False
        name = b["backend"]
        if not isinstance(name, str) or name not in BACKENDS or name in observed:
            return False
        observed.add(name)
        expected_scope = ("TARGET_SCOPED_PURE_POLICY"
                          if name in {"hdl", "realtime"}
                          else "HOSTED_GUEST_CANDIDATE")
        if (b["repository"] != "atto-lang/atto-source." + name
                or b["profile"] != expected_scope
                or b["execution"] != "NOT_EXECUTED"
                or type(b["executed_guest_cases"]) is not int
                or b["executed_guest_cases"] != 0
                or b["evidence"] != "NONE"):
            return False
    if observed != BACKENDS:
        return False
    f = data["fixtures"]
    if not isinstance(f, dict) or set(f) != {
        "positive", "negative", "source_units"
    }:
        return False
    if (len(f["positive"]) != 2 or len(f["negative"]) != 4
            or len(f["source_units"]) != 2):
        return False
    if {x.get("kind") for x in f["positive"]} != POSITIVES:
        return False
    if {x.get("category") for x in f["negative"]} != NEGATIVES:
        return False
    paths = []
    for p in f["positive"]:
        if (set(p) != {"path", "kind", "expected_guest_lines"}
                or p["expected_guest_lines"] !=
                (["true", "true"] if p["kind"] == "BUILTIN_NAMESPACE"
                 else ["true"])):
            return False
        paths.append(p["path"])
    for n in f["negative"]:
        if (set(n) != {"path", "category", "must_fail_before_guest_output"}
                or n["must_fail_before_guest_output"] is not True):
            return False
        paths.append(n["path"])
    paths.extend(f["source_units"])
    if len(set(paths)) != 8:
        return False
    for p in paths:
        if (not isinstance(p, str) or not p.startswith(SOURCE_ROOT)
                or ".." in Path(p).parts or p.endswith("/")
                or not (root / p).is_file()):
            return False
    sources = {Path(p).name: (root / p).read_text(encoding="utf-8")
               for p in paths}
    if ('import * as http from "std.http";'
            not in sources["pass_builtin_http.atto"]
            or 'http.status_valid(200)' not in sources["pass_builtin_http.atto"]
            or 'http.status_valid(99)' not in sources["pass_builtin_http.atto"]
            or 'define pub module http3 as' not in sources["library_public.atto"]
            or 'define module internal as' not in sources["library_public.atto"]
            or 'import module internal from "./library_public.atto";'
            not in sources["fail_private_module.atto"]
            or 'fnc secret()' not in sources["library_private.atto"]
            or 'p.secret()' not in sources["fail_private_member.atto"]
            or 'std.unregistered_parity_guard'
            not in sources["fail_unregistered_builtin.atto"]
            or sources["fail_alias_collision.atto"].count(
                'import * as http from "std.http";') != 2):
        return False
    return True


class NamespaceParitySourceAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_exact_backends_and_source_fixtures_are_staged_not_executed(self):
        self.assertTrue(valid_manifest(self.data))

    def test_forged_execution_and_missing_backend_fail_closed(self):
        for backend in BACKENDS:
            forged = copy.deepcopy(self.data)
            next(x for x in forged["backends"]
                 if x["backend"] == backend)["execution"] = "PASS"
            self.assertFalse(valid_manifest(forged), backend)
        missing = copy.deepcopy(self.data)
        missing["backends"].pop()
        self.assertFalse(valid_manifest(missing))

    def test_unsafe_import_evidence_mutations_fail_closed(self):
        mutations = [
            ("import_contract", "ambient_file_or_package_fallback", True),
            ("import_contract", "capability_granted_by_import", True),
            ("execution_rules", "must_compile_real_atto_source", False),
            ("execution_rules", "host_shim_only_not_sufficient", False),
            ("execution_rules", "guest_steps_required", False),
        ]
        for group, key, value in mutations:
            altered = copy.deepcopy(self.data)
            altered[group][key] = value
            self.assertFalse(valid_manifest(altered), (group, key))

    def test_private_export_denial_and_no_side_effects_are_required(self):
        for category in NEGATIVES:
            altered = copy.deepcopy(self.data)
            entry = next(x for x in altered["fixtures"]["negative"]
                         if x["category"] == category)
            entry["must_fail_before_guest_output"] = False
            self.assertFalse(valid_manifest(altered), category)


if __name__ == "__main__":
    unittest.main()
