#!/usr/bin/env python3
"""Source-free JSON Schema shape check. NEVER a CI/runtime attestation."""
import json
import os
import stat
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas/zorde-contract-handoff-v1.schema.json"
MAX_BYTES = 65536


def fail(reason):
    raise ValueError(reason)


def read_bounded_regular(path):
    # A FIFO could block before fstat; O_NONBLOCK avoids that and O_NOFOLLOW
    # prevents a final-component symlink from resolving to private data.
    if not hasattr(os, "O_NOFOLLOW"):
        fail("O_NOFOLLOW unavailable")
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or not 0 < before.st_size <= MAX_BYTES):
            fail("input must be bounded regular unlinked-by-alias file")
        data = bytearray()
        while len(data) <= MAX_BYTES:
            block = os.read(fd, min(8192, MAX_BYTES + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        after = os.fstat(fd)
        if len(data) != before.st_size or before.st_size != after.st_size:
            fail("input changed size while reading")
        return bytes(data)
    finally:
        os.close(fd)


def decode_strict(raw):
    def unique_keys(items):
        obj = {}
        for key, value in items:
            if key in obj:
                fail("duplicate JSON key")
            obj[key] = value
        return obj

    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_keys,
                      parse_constant=lambda _: fail("nonfinite number"))


def check(path):
    schema = decode_strict(read_bounded_regular(SCHEMA_PATH))
    Draft202012Validator.check_schema(schema)
    evidence = decode_strict(read_bounded_regular(path))
    errors = list(Draft202012Validator(schema).iter_errors(evidence))
    if errors:
        fail("JSON Schema admission refused")
    # This print is fixed, not copied from any untrusted claim or status.
    return "ZORDE_HANDOFF_SHAPE_ONLY_UNAUTHENTICATED"


def main(argv):
    if len(argv) != 2 or argv[1].startswith("-"):
        print("usage: check-zorde-handoff.py RECEIPT_JSON", file=sys.stderr)
        return 2
    try:
        print(check(argv[1]))
        return 0
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        # Avoid printing untrusted JSON fields, URLs, or paths in CI logs.
        print("ZORDE_HANDOFF_REFUSED: " + type(error).__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
