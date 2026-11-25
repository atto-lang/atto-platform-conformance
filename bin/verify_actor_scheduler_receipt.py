"""Structural scheduler receipt gate. Valid shape is NOT authenticated execution."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "contracts/actor-scheduler-domains-v1.json").read_text())
SECURITY_CASES = {"untrusted-deny-without-sandbox", "tenant-per-account-pool",
                  "real-security-boundary", "tenant-generation-retirement"}


class ReceiptError(ValueError):
    pass


def require(ok, code):
    if not ok:
        raise ReceiptError(code)


def validate_manifest(manifest=MANIFEST):
    require(manifest.get("schema") == "atto.actor-scheduler-domains.v1", "SCHEMA")
    ids = [c["id"] for c in manifest["cases"]]
    require(len(ids) == len(set(ids)) == 14, "CASES")
    require(all(backend["status"] == "NOT_EXECUTED"
                for backend in manifest["backends"].values()), "FALSE_PARITY")
    return ids


def validate_receipt(r, manifest=MANIFEST):
    ids = validate_manifest(manifest)
    require(isinstance(r, dict), "RECEIPT")
    require(r.get("backend") in manifest["backends"], "BACKEND")
    require(r.get("case_id") in ids, "CASE")
    status = r.get("status")
    require(status in manifest["receipt"]["states"], "STATUS")
    if status != "passed":
        require(isinstance(r.get("reason"), str) and
                len(r["reason"].strip()) >= 8, "REASON")
        return True
    for name in ("exact_head_sha", "source_tree_sha"):
        value = r.get(name)
        require(isinstance(value, str) and len(value) == 40 and
                all(c in "0123456789abcdef" for c in value), "SHA:" + name)
    require(isinstance(r.get("toolchain"), str) and
            len(r["toolchain"].strip()) >= 3, "TOOLCHAIN")
    require(type(r.get("executed_steps_nonzero")) is int and
            r["executed_steps_nonzero"] > 0, "NO_EXECUTED_STEPS")
    require(r.get("guest_executed") is True, "HOST_ONLY")
    require(isinstance(r.get("observed"), str) and
            len(r["observed"].strip()) >= 3, "OBSERVED")
    require(isinstance(r.get("workflow_url"), str) and
            r["workflow_url"].startswith("https://github.com/"), "WORKFLOW")
    count = r.get("thread_count_evidence")
    require(isinstance(count, dict), "THREAD_COUNTS")
    atto = count.get("atto_startup_including_caller")
    process = count.get("process_startup_total")
    require(type(atto) is int and atto in (2, 3), "ATTO_STARTUP")
    require(type(process) is int and process >= atto, "PROCESS_STARTUP")
    if r["case_id"] in SECURITY_CASES:
        boundary = r.get("boundary_evidence")
        require(isinstance(boundary, dict) and
                boundary.get("kind") in ("sandboxed_process",
                                         "verified_hardware_or_wasm_sandbox") and
                boundary.get("enforcement_tested") is True, "PHYSICAL_ISOLATION")
    # Receipt assertions are structurally checked, never independently attested.
    return True


if __name__ == "__main__":
    validate_manifest()
    if len(sys.argv) > 1:
        validate_receipt(json.loads(Path(sys.argv[1]).read_text()))
    print("STRUCTURAL_ONLY_NOT_GUEST_PARITY")
