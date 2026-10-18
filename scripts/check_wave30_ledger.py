"""Validate static 30-issue draft ledger cardinality and truth labels.

This checks the local record's syntax/invariants only; it does not query GitHub,
execute backend tests, or establish CI evidence.
"""
import json
from pathlib import Path

STAGES = {"code_partial", "plan_only"}
BRANCH = "draft/issue-wave30-20261018"


def validate(data):
    if type(data) is not dict or data.get("schemaVersion") != 1:
        raise ValueError("unknown ledger schema")
    if data.get("releaseCertified") is not False or data.get("merged") is not False:
        raise ValueError("draft-only ledger must not certify release/merge")
    if data.get("branch") != BRANCH:
        raise ValueError("unexpected draft branch")
    repos = data.get("repositories")
    if type(repos) is not list or len(repos) < 20:
        raise ValueError("fewer than twenty repositories")
    names, tickets = set(), set()
    for record in repos:
        if type(record) is not dict or type(record.get("name")) is not str:
            raise ValueError("invalid repository entry")
        repo = record["name"]
        if repo in names:
            raise ValueError("duplicate repository")
        names.add(repo)
        if record.get("branchUrl") != (
            "https://github.com/ores-truffle-oreslang/" + repo + "/tree/" + BRANCH
        ):
            raise ValueError("branch link mismatch")
        for issue in record.get("issues", []):
            number = issue.get("number")
            if type(number) is not int or number < 1 or issue.get("status") not in STAGES:
                raise ValueError("invalid issue status/number")
            if issue.get("url") != (
                "https://github.com/ores-truffle-oreslang/" + repo
                + "/issues/" + str(number)
            ):
                raise ValueError("issue link mismatch")
            key = (repo, number)
            if key in tickets:
                raise ValueError("duplicate issue")
            tickets.add(key)
    if len(tickets) != 30:
        raise ValueError("expected exactly 30 unique issues")
    return {"repositories":len(names),"issues":len(tickets),"certified":False}


def main():
    file = Path(__file__).resolve().parents[1] / "docs" / "wave30-issue-ledger.json"
    print(json.dumps(validate(json.loads(file.read_text(encoding="utf-8"))),sort_keys=True))


if __name__ == "__main__":
    main()
