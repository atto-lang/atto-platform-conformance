#!/usr/bin/env python3
"""Fail-closed, source-only GC profile policy validation; never runtime proof."""
import copy
import json
from pathlib import Path
import sys
import unittest

PATH = Path(__file__).resolve().parents[1] / "contracts/actor_gc_profiles_v1.json"
BACKENDS = ("java", "llvm", "wasm", "cranelift", "net", "forge")
HOSTS = {
    "java": ("jvm-graal", True, "host-arena-substrate"),
    "llvm": ("native-cpp", False, "native-arena-substrate"),
    "wasm": ("node-webassembly", True, "host-linear-memory-substrate"),
    "cranelift": ("rust-native-jit", False, "unsupported-scalar-only"),
    "net": ("clr-nativeaot", True, "unmanaged-arena-substrate"),
    "forge": ("cpp-native", False, "native-arena-substrate"),
}
PROOFS = (
    "compiled-source-allocation-site-closure",
    "native-layout-and-drop-glue-for-every-noncopy-value",
    "drop-on-return-throw-raise-panic-cancellation-and-hot-reload",
    "checked-partial-init-and-move-drop-flags",
    "no-implicit-strong-cross-actor-cycles",
    "closed-ffi-import-and-callback-allocation-set",
    "actor-turn-borrow-async-and-ffi-quiescence",
    "generation-fenced-actor-and-incarnation-handles",
    "persistent-survives-turn-scratch-does-not",
    "scrub-and-physical-reclaim-after-last-external-lease",
    "bounded-quotas-no-unaccounted-overflow-or-double-refund",
    "backend-generated-ir-binary-and-runtime-allocation-evidence",
    "exact-source-head-target-artifact-hash-and-stepful-runner-provenance",
)
CASES = (
    "persistent-two-actor-turn-isolation",
    "scratch-after-yield-rejected",
    "take-move-then-read-rejected",
    "borrow-across-suspend-admission",
    "cross-actor-pointer-smuggling-rejected",
    "foreign-handle-and-restart-generation-rejected",
    "actor-stop-while-async-ffi-io-pin-outstanding",
    "late-callback-cannot-reopen-retired-actor",
    "double-release-and-partial-constructor-failure",
    "nested-drop-return-break-continue-early-exit",
    "throw-raise-panic-supervision-drop-paths",
    "hot-reload-and-supervisor-restart-quiescence",
    "arena-cyclic-graph-nonowning-handles",
    "shared-immutable-graph-no-unbounded-rc-cycle",
    "allocator-quota-failure-no-counter-mutation",
    "wasm-gc-reference-types-and-host-imports-rejected-in-strict-profile",
    "llvm-statepoint-and-unexpected-gc-runtime-call-rejected",
    "host-collector-versus-guest-collector-claims-distinguished",
)
RELEASE_RULE = ("A declaration-only fixture cannot prove compiler lowering, "
    "runtime behavior, zero guest tracing GC, zero process GC, or hard-real-time latency.")

class ContractError(ValueError):
    pass

def fail(msg):
    raise ContractError("actor GC profiles: " + msg)

def parse(raw):
    if not isinstance(raw, bytes) or raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw:
        fail("noncanonical encoding")
    try:
        def pairs(items):
            obj = {}
            for key, value in items:
                if key in obj:
                    fail("duplicate JSON key: " + key)
                obj[key] = value
            return obj
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as err:
        fail("invalid JSON: " + str(err))

def validate(doc):
    if not isinstance(doc, dict) or set(doc) != {
        "schemaVersion", "scope", "evidenceLevel",
        "verifiedGeneralGuestZeroGcBackends", "verifiedHardRealtimeBackends",
        "profiles", "backends", "requiredProofs", "requiredConformanceCases", "releaseRule"
    }:
        fail("unexpected top-level schema")
    if type(doc["schemaVersion"]) is not int or doc["schemaVersion"] != 1 or (
        doc["scope"], doc["evidenceLevel"]) != (
            "actor-owned-memory-gc-admission-v1", "source-only-policy"):
        fail("scope/evidence misrepresentation")
    for field in ("verifiedGeneralGuestZeroGcBackends", "verifiedHardRealtimeBackends"):
        if doc[field] != []:
            fail("unearned zero GC or real-time certification: " + field)
    if doc["profiles"] != {
        "strictGuestNoTracingTargets": ["llvm", "wasm"],
        "nearZeroManagedHostTargets": ["java", "net"],
        "additionalNativeTargets": ["cranelift", "forge"],
        "hardRealtimeTarget": "llvm"
    }:
        fail("backend policy profile drift")
    backends = doc["backends"]
    if not isinstance(backends, dict) or set(backends) != set(BACKENDS):
        fail("expected six independently named toolchains")
    for key in BACKENDS:
        v = backends[key]
        if not isinstance(v, dict) or set(v) != {
            "host", "hostTracingGcPossible", "actorHeapStage",
            "sourceActorHeapLoweringCertified", "guestZeroTracingCertified",
            "fullProcessZeroGcCertified"
        }:
            fail(key + ": unexpected backend fields")
        if (v["host"], v["hostTracingGcPossible"], v["actorHeapStage"]) != HOSTS[key] or (
            type(v["hostTracingGcPossible"]) is not bool):
            fail(key + ": host GC or heap substrate was misstated")
        for flag in ("sourceActorHeapLoweringCertified", "guestZeroTracingCertified",
                     "fullProcessZeroGcCertified"):
            if v[flag] is not False:
                fail(key + ": runtime promotion requires external evidence: " + flag)
    if doc["requiredProofs"] != list(PROOFS):
        fail("zero-GC proof obligation changed/dropped")
    if doc["requiredConformanceCases"] != list(CASES):
        fail("actor GC conformance inventory changed/dropped")
    if doc["releaseRule"] != RELEASE_RULE:
        fail("source-only guardrail changed")
    return {"backend_count": len(BACKENDS), "required_proof_count": len(PROOFS),
            "conformance_case_count": len(CASES), "executed_guest_tests": 0,
            "zero_gc_certified": False}

def validate_file(path=PATH):
    return validate(parse(Path(path).read_bytes()))

class PolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = parse(PATH.read_bytes())

    def reject(self, change):
        copied = copy.deepcopy(self.base)
        change(copied)
        with self.assertRaises(ContractError):
            validate(copied)

    def test_canonical(self):
        self.assertEqual(validate(self.base)["zero_gc_certified"], False)

    def test_duplicate_json_field(self):
        with self.assertRaises(ContractError):
            parse(b'{"scope":"a","scope":"b"}')

    def test_bom_denied(self):
        with self.assertRaises(ContractError):
            parse(b"\xef\xbb\xbf" + PATH.read_bytes())

    def test_noncanonical_crlf_denied(self):
        with self.assertRaises(ContractError):
            parse(PATH.read_bytes().replace(b"\n", b"\r\n"))

    def test_backend_missing(self):
        self.reject(lambda d: d["backends"].pop("cranelift"))

    def test_spoofed_toolchain(self):
        self.reject(lambda d: d["backends"].update({"other": {}}))

    def test_llvm_general_gc_promotion_denied(self):
        self.reject(lambda d: d["backends"]["llvm"].update({"guestZeroTracingCertified": True}))

    def test_wasm_full_gc_promotion_denied(self):
        self.reject(lambda d: d["backends"]["wasm"].update({"fullProcessZeroGcCertified": True}))

    def test_java_gc_erasure_denied(self):
        self.reject(lambda d: d["backends"]["java"].update({"hostTracingGcPossible": False}))

    def test_net_gc_erasure_denied(self):
        self.reject(lambda d: d["backends"]["net"].update({"hostTracingGcPossible": False}))

    def test_cranelift_actor_heap_fabrication_denied(self):
        self.reject(lambda d: d["backends"]["cranelift"].update({"actorHeapStage": "native-arena-substrate"}))

    def test_backend_actor_lowering_claim_denied(self):
        for key in BACKENDS:
            with self.subTest(backend=key):
                self.reject(lambda d, key=key: d["backends"][key].update(
                    {"sourceActorHeapLoweringCertified": True}))

    def test_proof_dropped_denied(self):
        for i in range(len(PROOFS)):
            with self.subTest(index=i):
                self.reject(lambda d, i=i: d["requiredProofs"].pop(i))

    def test_conformance_case_dropped_denied(self):
        for i in range(len(CASES)):
            with self.subTest(index=i):
                self.reject(lambda d, i=i: d["requiredConformanceCases"].pop(i))

    def test_fabricated_executed_results_denied(self):
        self.reject(lambda d: d.update({"verifiedGeneralGuestZeroGcBackends": ["llvm"]}))

    def test_fabricated_rt_results_denied(self):
        self.reject(lambda d: d.update({"verifiedHardRealtimeBackends": ["llvm"]}))

    def test_strict_target_changes_denied(self):
        self.reject(lambda d: d["profiles"]["strictGuestNoTracingTargets"].append("java"))

if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        result = unittest.TextTestRunner(verbosity=1).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(PolicyTests))
        if not result.wasSuccessful() or result.skipped:
            raise SystemExit(1)
    else:
        if sys.argv[1:]:
            raise SystemExit("usage: verify_actor_gc_profiles_v1.py [--test]")
        print(json.dumps(validate_file(), sort_keys=True))
