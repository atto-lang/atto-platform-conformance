#!/usr/bin/env python3
"""Structural validation only: does NOT authenticate CI or prove guest sandboxing."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts" / "actor-tenant-conformance-v1.json"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ReceiptError(ValueError):
    pass


def require(ok, msg):
    if not ok:
        raise ReceiptError(msg)


def validate_manifest(manifest):
    require(manifest.get("schema") == "atto.actor-tenant-conformance.v1", "schema")
    cases = manifest.get("cases")
    require(isinstance(cases, list) and len(cases) >= 10, "cases")
    ids = [case.get("id") for case in cases]
    require(all(isinstance(value, str) and value for value in ids)
            and len(set(ids)) == len(ids), "duplicate-or-missing-case")
    require(set(manifest.get("backends", {})) >= {"java", "llvm", "wasm", "forge", "net"}, "backends")
    require(all(info.get("status") == "NOT_EXECUTED"
                for info in manifest["backends"].values()), "baseline-cannot-claim-execution")
    return {case["id"]: case for case in cases}


def validate_receipt(receipt, manifest):
    cases = validate_manifest(manifest)
    require(isinstance(receipt, dict), "receipt-is-not-object")
    require(receipt.get("backend") in manifest["backends"], "unknown-backend")
    require(receipt.get("case_id") in cases, "unknown-case")
    status = receipt.get("status")
    require(status in {"passed", "failed", "unsupported", "not_executed"}, "unknown-status")
    if status in {"unsupported", "not_executed"}:
        require(isinstance(receipt.get("reason"), str)
                and bool(receipt["reason"].strip()), "missing-reason")
        require(receipt.get("guest_executed") is not True, "nonexecuted-claim")
        return
    if status == "failed":
        require(isinstance(receipt.get("reason"), str)
                and bool(receipt["reason"].strip()), "missing-failure-reason")
        return
    require(receipt.get("guest_executed") is True, "no-executed-guest")
    require(receipt.get("evidence_kind") == "compiled-guest", "host-model-not-guest")
    require(isinstance(receipt.get("head_sha"), str)
            and SHA40.fullmatch(receipt["head_sha"]), "invalid-head-sha")
    require(isinstance(receipt.get("artifact_sha256"), str)
            and SHA256.fullmatch(receipt["artifact_sha256"]), "invalid-artifact-sha")
    require(isinstance(receipt.get("workflow_url"), str)
            and receipt["workflow_url"].startswith("https://github.com/"), "missing-workflow-url")
    require(isinstance(receipt.get("command"), str)
            and bool(receipt["command"].strip()), "missing-command")
    require(isinstance(receipt.get("observed"), str)
            and receipt["observed"] == cases[receipt["case_id"]]["expect"], "unexpected-outcome")
    require(type(receipt.get("exit_code")) is int, "missing-exit-code")
    if cases[receipt["case_id"]]["kind"] == "compile-negative":
        require(receipt["exit_code"] != 0, "compiler-must-reject")
    else:
        require(receipt["exit_code"] == 0, "guest-must-exit-successfully")
    if cases[receipt["case_id"]]["kind"].startswith("security-"):
        require(receipt.get("boundary") in
                {"validated-wasm-isolate", "graal-isolate", "os-process", "hardware-compartment"},
                "no-identified-enforced-boundary")
        require(receipt.get("enforcement_tested") is True, "sandbox-enforcement-not-tested")


def main(argv):
    if len(argv) not in (1, 2):
        print("usage: verify_actor_tenant_receipt.py [receipt.json]", file=sys.stderr)
        return 2
    manifest = json.loads(MANIFEST.read_text())
    try:
        validate_manifest(manifest)
        if len(argv) == 2:
            validate_receipt(json.loads(Path(argv[1]).read_text()), manifest)
    except (ReceiptError, json.JSONDecodeError, OSError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    print("VALID STRUCTURE ONLY; NOT VERIFIED GUEST PROVENANCE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
