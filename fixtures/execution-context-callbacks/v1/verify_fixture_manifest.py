#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
SOURCE = ROOT / "callback_sync_resolve.ores"


def git_blob_id(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(
        f"blob {len(data)}\0".encode() + data,
        usedforsecurity=False,
    ).hexdigest()


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit("callback source fixture FAILED: " + message)


def main() -> None:
    manifest = json.loads(MANIFEST.read_text())
    require(manifest.get("version") == 1, "version")
    require(
        manifest.get("contract") == "CALLBACK_DISPATCH_AND_PREEMPTION_V1",
        "contract",
    )
    fixtures = manifest.get("fixtures")
    require(isinstance(fixtures, list) and len(fixtures) == 1, "fixture set")
    fixture = fixtures[0]
    require(fixture.get("id") == "sync_resolve_registration", "fixture id")
    require(fixture.get("source") == SOURCE.name, "source path")
    require(
        fixture.get("expected_stdout") == [
            "before_callback",
            "callback_enter",
            "callback_exit",
            "after_callback",
            "after_await",
            "42",
        ],
        "stdout contract",
    )
    receipt = fixture.get("required_receipt", {})
    for key in (
        "compiled_guest",
        "fresh_resume_dispatch",
        "logical_execution_preserved",
    ):
        require(receipt.get(key) is True, key)
    require(receipt.get("guest_inline") is False, "no-Zalgo")
    require(receipt.get("producer_active_execution") is False, "authority")
    require(receipt.get("callback_boundary") == "HOST_CALLBACK", "boundary")

    print(
        "CALLBACK_SOURCE_FIXTURE_V1_PASS "
        f"source_blob={git_blob_id(SOURCE)} manifest_blob={git_blob_id(MANIFEST)}"
    )


if __name__ == "__main__":
    main()
