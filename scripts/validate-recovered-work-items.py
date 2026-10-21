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
MARKDOWN = SNAPSHOT.with_suffix(".md")
ROW = re.compile(
    r"^\| ([1-9][0-9]*) \| (P[01]) \| \[([^\]]+)\]\("
    r"(https://github[.]com/ores-truffle-oreslang/[a-zA-Z0-9_.-]+/pull/[1-9][0-9]*)"
    r"\) — (.*?) \| (.*?) \|$"
)



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



def validate_markdown(snapshot, markdown):
    """Fail closed when the human-facing inventory diverges from its JSON ledger."""
    items = snapshot["items"]
    repos = len({entry["repo"] for entry in items})
    p0 = sum(entry["priority"] == "P0" for entry in items)
    p1 = len(items) - p0
    required_summary = (
        f"**Snapshot:** {len(items)} distinct open PRs, {repos} repositories, "
        f"{p0} P0 and {p1} P1."
    )
    if required_summary not in markdown:
        raise ValueError("human-facing priority summary differs from JSON")
    rows = [line for line in markdown.splitlines()
            if re.match(r"^\| [0-9]+ \| P[01] \|", line)]
    if len(rows) != len(items):
        raise ValueError("Markdown row count differs from JSON")
    for expected, row in zip(items, rows):
        match = ROW.fullmatch(row)
        if match is None:
            raise ValueError("malformed Markdown task row")
        task_id, priority, label, url, title, action = match.groups()
        expected_label = f"{expected['repo'].split('/', 1)[1]} #{expected['pr']}"
        if (int(task_id) != expected["id"]
                or priority != expected["priority"]
                or label != expected_label
                or url != expected["url"]
                or title != expected["title"]
                or action != expected["next_action"]):
            raise ValueError(f"Markdown/JSON divergence at task {expected['id']}")
    return len(rows)

def main():
    if len(sys.argv) > 2:
        return 2
    file = Path(sys.argv[1]) if len(sys.argv) == 2 else SNAPSHOT
    try:
        snapshot = json.loads(file.read_text(encoding="utf-8"))
        result = validate(snapshot)
        if file.resolve() == SNAPSHOT.resolve():
            validate_markdown(snapshot, MARKDOWN.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"recovery snapshot rejected: {exc}", file=sys.stderr)
        return 1
    print(f"RECOVERY_SNAPSHOT_OK items={result[0]} repos={result[1]} (metadata only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
