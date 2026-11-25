#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

FIXTURE_ID = "sync_resolve_registration"
FIXTURE_BLOB = "83f7db76fd6437d7d4994210e78034b93a5bff26"
EXPECTED_STDOUT = [
    "before_callback",
    "callback_enter",
    "callback_exit",
    "after_callback",
    "after_await",
    "42",
]
BACKENDS = {"java", "llvm", "net", "wasm", "forge"}


def fail(message: str) -> None:
    raise SystemExit("callback backend receipt FAILED: " + message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def verify(receipt: dict) -> None:
    require(receipt.get("schema_version") == "1.0.0", "schema version")
    require(receipt.get("fixture_id") == FIXTURE_ID, "fixture id")
    require(receipt.get("fixture_git_blob") == FIXTURE_BLOB, "fixture blob")
    require(receipt.get("backend") in BACKENDS, "backend")
    require(nonempty_string(receipt.get("source_head")), "source head")
    status = receipt.get("status")
    require(status in {"PASS", "EXPECTED_REJECT", "NOT_EXECUTED"}, "status")

    if status == "PASS":
        require(receipt.get("compiled_guest") is True, "PASS must compile guest")
        require(nonempty_string(receipt.get("compiler_identity")), "compiler identity")
        require(receipt.get("expected_exit") == 0, "expected exit")
        require(receipt.get("observed_exit") == 0, "observed exit")
        require(receipt.get("expected_stdout") == EXPECTED_STDOUT, "expected stdout")
        require(receipt.get("observed_stdout") == EXPECTED_STDOUT, "observed stdout")
        require(receipt.get("guest_inline") is False, "no-Zalgo")
        require(receipt.get("fresh_resume_dispatch") is True, "fresh resume dispatch")
        require(
            receipt.get("logical_execution_preserved") is True,
            "logical execution preservation",
        )
        require(
            receipt.get("producer_active_execution") is False,
            "producer authority",
        )
        require(receipt.get("callback_boundary") == "HOST_CALLBACK", "boundary")
        require(receipt.get("diagnostic") in (None, ""), "PASS cannot carry rejection diagnostic")
        return

    require(receipt.get("compiled_guest") is False, f"{status} cannot claim compiled guest")
    require(receipt.get("observed_exit") is None, f"{status} cannot claim guest exit")
    require(receipt.get("observed_stdout") in (None, []), f"{status} cannot claim guest stdout")

    if status == "EXPECTED_REJECT":
        require(nonempty_string(receipt.get("compiler_identity")), "compiler identity")
        require(nonempty_string(receipt.get("diagnostic")), "rejection diagnostic")
        require(receipt.get("emitted_artifact") is False, "rejection emitted artifact")
        return

    require(nonempty_string(receipt.get("reason")), "NOT_EXECUTED reason")
    require(receipt.get("diagnostic") in (None, ""), "NOT_EXECUTED cannot claim compiler diagnostic")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("receipt", type=Path)
    args = parser.parse_args()
    data = json.loads(args.receipt.read_text())
    require(isinstance(data, dict), "receipt must be an object")
    verify(data)
    print(
        "CALLBACK_BACKEND_RECEIPT_V1_PASS "
        f"backend={data['backend']} status={data['status']} fixture={FIXTURE_BLOB}"
    )


if __name__ == "__main__":
    main()
