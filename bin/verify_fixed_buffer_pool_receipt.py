#!/usr/bin/env python3
"""Structural verifier only. An untrusted JSON receipt is NOT provenance."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/fixed-buffer-pool-guest-receipt-v1.json"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA64 = re.compile(r"[0-9a-f]{64}\Z")
RUN = re.compile(r"https://github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+/actions/runs/[1-9][0-9]*\Z")

class ReceiptError(ValueError):
    pass

def require(condition, reason):
    if not condition:
        raise ReceiptError(reason)

def sha_matches(value, pattern):
    return isinstance(value, str) and pattern.fullmatch(value) is not None

def validate_receipt(receipt, contract):
    require(isinstance(receipt, dict), "receipt must be object")
    require(isinstance(contract, dict) and contract.get("schema") ==
            "atto.fixed-buffer-pool.guest-receipt.v1", "bad contract")
    backend = receipt.get("backend")
    require(backend in contract["allowed_backends"], "unknown backend")
    status = receipt.get("status")
    require(status in ("passed", "failed", "not_executed", "unsupported"), "bad status")
    if status != "passed":
        require(isinstance(receipt.get("reason"), str) and
                len(receipt["reason"].strip()) >= 8, "missing failure reason")
        require(receipt.get("guest_executed") is not True, "unearned guest claim")
        require(receipt.get("zero_allocation_proved") is not True and
                receipt.get("zero_copy_proved") is not True, "unearned proof")
        return status

    require(receipt.get("evidence_kind") == "compiled-atto-guest", "host-only is insufficient")
    require(receipt.get("guest_executed") is True, "guest not executed")
    require(type(receipt.get("executed_job_steps")) is int and
            receipt["executed_job_steps"] >= 3, "zero-step or unexecuted job")
    require(sha_matches(receipt.get("source_head_sha"), SHA40), "invalid source SHA")
    require(sha_matches(receipt.get("compiler_head_sha"), SHA40), "invalid compiler SHA")
    require(sha_matches(receipt.get("fixture_git_blob_sha"), SHA40), "invalid fixture blob SHA")
    require(sha_matches(receipt.get("artifact_sha256"), SHA64), "invalid artifact SHA256")
    require(sha_matches(receipt.get("fixture_sha256"), SHA64), "invalid fixture SHA256")
    require(isinstance(receipt.get("workflow_url"), str) and
            RUN.fullmatch(receipt["workflow_url"]) is not None, "missing workflow URL")
    require(isinstance(receipt.get("command"), str) and
            len(receipt["command"].strip()) >= 8, "missing guest command")
    require(receipt.get("allocator_probe_available") is True and
            receipt.get("copy_probe_available") is True, "missing instrumentation")
    require(type(receipt.get("measured_transfers")) is int and
            receipt["measured_transfers"] >= contract["minimum_transfers"], "insufficient transfers")
    require(type(receipt.get("dynamic_allocations_during_window")) is int and
            receipt["dynamic_allocations_during_window"] == 0, "hot-path allocation")
    require(type(receipt.get("payload_copy_bytes_during_transfers")) is int and
            receipt["payload_copy_bytes_during_transfers"] == 0, "payload copied")
    require(receipt.get("same_backing_region_after_move") is True, "buffer identity changed")
    require(receipt.get("guest_exit_code") == 0 and
            type(receipt.get("guest_exit_code")) is int, "guest failed")
    negative_cases = receipt.get("negative_cases")
    require(isinstance(negative_cases, dict), "missing negative tests")
    for key in contract["required_negative_cases"]:
        require(negative_cases.get(key) is True, "negative case absent or failed: " + key)
    require(receipt.get("zero_allocation_proved") is True and
            receipt.get("zero_copy_proved") is True, "missing measured claims")
    return "passed"

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("receipt", type=Path)
    args = p.parse_args()
    c = json.loads(CONTRACT.read_text(encoding="utf-8"))
    r = json.loads(args.receipt.read_text(encoding="utf-8"))
    validate_receipt(r, c)
    print("STRUCTURAL_RECEIPT_VALID; NOT AUTHENTICATED EXECUTION")

if __name__ == "__main__":
    main()
