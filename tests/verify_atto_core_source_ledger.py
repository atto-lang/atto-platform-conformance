#!/usr/bin/env python3
"""Offline source-only ledger verifier: incapable of certifying guest parity."""
from pathlib import Path
import json
import sys

REL = "contracts/atto-core-source-ledger-v1/ledger.json"
SHA = {
    "ores.core/numeric": "5ced991f1d49b3c2a60fdd72b9003c0a4d18cd72",
    "ores.std/core": "d2cd9b8e0cd3e3bb3ee6a5f9cebf9ab3312c44f4",
}
BACKENDS = frozenset(("java", "llvm", "net", "wasm", "forge"))
MAX_JSON = 32768

class Rejected(ValueError):
    pass


def unique(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise Rejected("duplicate JSON key")
        obj[key] = value
    return obj


def reject_constant(_value):
    raise Rejected("nonstandard JSON number")


def check(path: Path) -> dict:
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.parent.is_symlink():
        raise Rejected("invalid or symlinked ledger")
    with path.open("rb") as handle:
        raw = handle.read(MAX_JSON + 1)
    if not raw or len(raw) > MAX_JSON or b"\x00" in raw or raw.startswith(b"\xef\xbb\xbf"):
        raise Rejected("ledger size/encoding violation")
    try:
        data = json.loads(raw.decode("utf-8", "strict"),
                          object_pairs_hook=unique, parse_constant=reject_constant)
    except Rejected:
        raise
    except (UnicodeError, ValueError, OverflowError, RecursionError) as exc:
        raise Rejected("invalid JSON ledger") from exc
    if type(data) is not dict or set(data) != {
        "schema", "source_organization", "modules", "backends", "claim_tier"
    }:
        raise Rejected("unexpected ledger shape")
    if data["schema"] != "atto-core-source-ledger-v1" or data["source_organization"] != "ores-truffle-oreslang":
        raise Rejected("untrusted ledger identity")
    if type(data["modules"]) is not dict or data["modules"] != SHA:
        raise Rejected("incorrect canonical module fingerprints")
    states = data["backends"]
    if type(states) is not dict or set(states) != BACKENDS:
        raise Rejected("backend set drift")
    if any(type(value) is not str or value != "NOT_EXECUTED" for value in states.values()):
        raise Rejected("offline ledger cannot promote backend execution")
    if data["claim_tier"] != "SOURCE_ONLY_NO_GUEST_EXECUTION":
        raise Rejected("offline ledger cannot claim compiler-backed parity")
    return data


def main() -> int:
    try:
        data = check(Path(__file__).resolve().parents[1] / REL)
    except Rejected as exc:
        print("ATTO_LEDGER_REJECTED=" + str(exc), file=sys.stderr)
        return 1
    print("ATTO_CORE_LEDGER_SOURCE_ONLY|backends=" + str(len(data["backends"])) +
          "|modules=" + str(len(data["modules"])) + "|guest=NOT_EXECUTED")
    return 0

if __name__ == "__main__":
    sys.exit(main())
