#!/usr/bin/env python3
"""Validate the frozen, non-authoritative 50-item Oreslang recovery snapshot.

This checks metadata shape and fail-closed status labeling, NOT GitHub state or CI.
"""
import json
import re
import sys
from pathlib import Path

PR_URL = re.compile(r"https://github[.]com/ores-truffle-oreslang/([a-zA-Z0-9_.-]+)/pull/([1-9][0-9]*)\Z")
SNAPSHOT = Path(__file__).resolve().parents[1] / "audits/2026-10-18-50-open-work-items.json"


def validate(data):
    if not isinstance(data, dict):
        raise ValueError("snapshot must be an object")
    if (data.get("window_start"), data.get("window_end")) != ("2026-10-08", "2026-10-18"):
        raise ValueError("unexpected recovery window")
    if data.get("source_query") != "org:ores-truffle-oreslang is:open updated:>=2026-10-08":
        raise ValueError("unverified source search")
    items = data.get("items")
    if not isinstance(items, list) or len(items) != 50:
        raise ValueError("expected exactly 50 separate work items")
    seen = set()
    repos = set()
    for n, item in enumerate(items, start=1):
        if not isinstance(item, dict) or type(item.get("id")) is not int or item["id"] != n:
            raise ValueError(f"invalid sequential task identity at {n}")
        url = item.get("url")
        match = PR_URL.fullmatch(url) if isinstance(url, str) else None
        if match is None:
            raise ValueError(f"malformed PR URL at {n}")
        repo = "ores-truffle-oreslang/" + match.group(1)
        if item.get("repo") != repo or type(item.get("pr")) is not int or item["pr"] != int(match.group(2)):
            raise ValueError(f"repository/PR identity mismatch at {n}")
        if url in seen:
            raise ValueError(f"duplicate PR at {n}")
        seen.add(url)
        repos.add(repo)
        if item.get("priority") not in ("P0", "P1"):
            raise ValueError(f"unqualified priority at {n}")
        if item.get("observed") != "open; runtime/CI unverified":
            raise ValueError(f"unsupported completion or verification claim at {n}")
        for field in ("title", "next_action"):
            if not isinstance(item.get(field), str) or len(item[field].strip()) < 12:
                raise ValueError(f"missing substantive {field} at {n}")
    if len(repos) < 10:
        raise ValueError("recovery must cover at least ten repositories")
    return len(items), len(repos)


def main():
    if len(sys.argv) > 2:
        return 2
    file = Path(sys.argv[1]) if len(sys.argv) == 2 else SNAPSHOT
    try:
        result = validate(json.loads(file.read_text(encoding="utf-8")))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"recovery snapshot rejected: {exc}", file=sys.stderr)
        return 1
    print(f"RECOVERY_SNAPSHOT_OK items={result[0]} repos={result[1]} (metadata only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
