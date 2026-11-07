#!/usr/bin/env python3
"""Compare M4 LLVM/GraalVM runtime output; structure only, not CI authentication."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/m4-shared-actor-counter-v1.json"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA64 = re.compile(r"[0-9a-f]{64}\Z")

class EvidenceError(ValueError):
    pass

def need(cond, why):
    if not cond:
        raise EvidenceError(why)

def match_output(log, key):
    # Repeated value from subsequent grep check is allowed; conflicting ones are not.
    values = re.findall(r"(?:^|[ \t])" + re.escape(key) +
                        r"=([^\s'\"]+)\s*$", log, flags=re.MULTILINE)
    need(bool(values), "MISSING_RUNTIME_OBSERVATION:" + key)
    need(len(set(values)) == 1, "CONFLICTING_RUNTIME_OBSERVATION:" + key)
    return values[0]

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def validate_log_pairs(llvm_log, graal_log, metadata, spec):
    need(spec.get("schema") == "atto.m4.cross-backend-actor-fixture.v1", "contract schema")
    src = ROOT / spec["fixture"]
    need(src.is_file() and not src.is_symlink(), "source fixture missing")
    raw = src.read_bytes()
    need(git_blob(raw) == spec["source_git_blob_sha"], "fixture source was modified")
    expected_src_sha256 = hashlib.sha256(raw).hexdigest()
    for backend in ("llvm", "graalvm-native"):
        receipt = metadata.get(backend)
        need(isinstance(receipt, dict), "missing backend receipt: " + backend)
        need(receipt.get("conclusion") == "success", "workflow not successful: " + backend)
        need(type(receipt.get("executed_steps")) is int and receipt["executed_steps"] >= 3,
             "zero-step/nonexecuted workflow: " + backend)
        need(receipt.get("runtime_executed") is True, "compiled guest not run: " + backend)
        head = receipt.get("head_sha", "")
        need(isinstance(head, str) and SHA40.fullmatch(head), "unverifiable source HEAD")
        run_url = receipt.get("run_url", "")
        need(isinstance(run_url, str) and
             re.fullmatch(r"https://github\.com/atto-lang/atto-source\.(?:llvm|java)/actions/runs/[1-9]\d*", run_url),
             "missing precise GitHub workflow URL")
        suffix = "llvm" if backend == "llvm" else "java"
        need("/atto-source." + suffix + "/actions/runs/" in run_url,
             "backend receipt points to incorrect repository")
        artifact = receipt.get("native_artifact_sha256", "")
        need(isinstance(artifact, str) and SHA64.fullmatch(artifact), "missing native artifact digest")
    for log, backend in ((llvm_log, "llvm"), (graal_log, "graalvm-native")):
        need(isinstance(log, str) and len(log) <= 3 * 1024 * 1024, "invalid / oversized log")
        need(match_output(log, "ATTO_M4_IDENTICAL_SOURCE_GIT_BLOB") ==
             spec["source_git_blob_sha"], "wrong identical .atto source: " + backend)
    need(match_output(llvm_log, "ATTO_M4_LLVM_GUEST_SOURCE_SHA256") ==
         expected_src_sha256, "LLVM manifest compiles wrong source bytes")
    need(match_output(graal_log, "ATTO_GUEST_SOURCE_SHA256") ==
         expected_src_sha256, "Graal manifest compiles wrong source bytes")
    e = spec["expected"]
    need(match_output(llvm_log, "ATTO_M4_LLVM_COMPILER_GENERATED_IDENTICAL_SOURCE_GUEST") ==
         "PASSED", "LLVM native guest not passed")
    need(match_output(graal_log, "ATTO_STATIC_ACTOR_GRAAL_EPSILON_NATIVE_GUEST") ==
         "PASSED", "Graal native guest not passed")
    for name, value, log in [
        ("ATTO_M4_LLVM_SOURCE_GUEST_RETURN", e["return_i64"], llvm_log),
        ("ATTO_GUEST_NATIVE_AOT_RETURN", e["return_i64"], graal_log),
        ("ATTO_M4_LLVM_ACTOR_CALLS_OBSERVED", e["sends"], llvm_log),
        ("ATTO_GUEST_ACTOR_SENDS", e["sends"], graal_log),
        ("ATTO_M4_LLVM_OBSERVATION_ACTOR_STOPS", e["stops"], llvm_log),
        ("ATTO_GUEST_ACTOR_CLOSES", e["stops"], graal_log),
        ("ATTO_M4_LLVM_HOST_OBSERVED_ACTOR_DIGEST", e["rolling_digest"], llvm_log),
        ("ATTO_GUEST_ACTOR_STATE_DIGEST", e["rolling_digest"], graal_log),
    ]:
        need(match_output(log, name) == str(value), "runtime observation differs: " + name)
    need(match_output(llvm_log, "ATTO_M4_LLVM_MAIN_GUEST_DRAINED") == "1",
         "LLVM native main did not finish/drain")
    need(match_output(graal_log, "ATTO_GUEST_GC_DELTA") == "0",
         "observed Graal collector delta not zero")
    return {
        "schema": "atto.m4.dual-native-output-structural-result.v1",
        "status": "STRUCTURALLY_CONSISTENT_UNAUTHENTICATED",
        "source_git_blob_sha": spec["source_git_blob_sha"],
        "source_sha256": expected_src_sha256,
        "return": e["return_i64"],
        "messages_observed": e["sends"],
        "actor_closes_observed": e["stops"],
        "rolling_digest": e["rolling_digest"],
        "llvm_signal": "actor replies on separate host calls + compiled main return",
        "graalvm_signal": "synchronous actor messages inside native executable",
        "unproven": [
            "independent scheduling and equivalent actor concurrency semantics",
            "hostile tenant sandbox; owning arenas alone is not a security boundary",
            "complete AttoLang compiler/language semantic parity",
            "authentic workflows/artifacts; receipt metadata is externally untrusted",
            "sustained no-GC memory and bounded heap behavior",
        ],
    }

def read_small(path):
    p = Path(path)
    need(p.is_file() and not p.is_symlink() and p.stat().st_size <= 3 * 1024 * 1024,
         "missing/oversized/symlinked input log")
    return p.read_text(encoding="utf-8")

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--llvm-log", required=True)
    ap.add_argument("--graal-log", required=True)
    ap.add_argument("--receipt-json", required=True)
    args = ap.parse_args()
    try:
        result = validate_log_pairs(
            read_small(args.llvm_log), read_small(args.graal_log),
            json.loads(read_small(args.receipt_json)), json.loads(MANIFEST.read_text()))
        print(json.dumps(result, indent=2, sort_keys=True))
    except (EvidenceError, OSError, ValueError, UnicodeError, KeyError, TypeError) as error:
        print("M4_DUAL_NATIVE_OUTPUT_REJECTED: " + str(error), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
