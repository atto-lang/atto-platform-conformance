import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

const source = "ores-truffle-oreslang/oreslang-source.llvm";
const A="a".repeat(40),T="d".repeat(40),M="b".repeat(40),C="c".repeat(40),destinationId=1357615104;
const encoded=text=>({type:"file",encoding:"base64",sha:createHash("sha1").update("blob "+Buffer.byteLength(text)+"\0").update(text).digest("hex"),
  content:Buffer.from(text).toString("base64")});
const securityOwners="@ORESoftware";
const reviewer={login:"independent-reviewer",id:300000001};
const reviewerPolicy=JSON.stringify({
  schema:2,enabled:true,minimumPermission:"write",
  disallowedReviewerIds:[11139560,2148448],reviewer
})+"\n";
const codeowners=[
  "/.github/workflows/ "+securityOwners,
  "/.github/CODEOWNERS "+securityOwners,
  "/.github/private-ci-approved-repositories.txt "+securityOwners,
  "/.github/private-ci-approved-source-snapshots.txt "+securityOwners,
  "/.github/private-ci-independent-reviewer.json "+securityOwners,
  "/.github/private-ci-required-checks.json "+securityOwners,
  "/.github/workflows/private-ci-policy.yml "+securityOwners
].join("\n")+"\n";
const requiredChecks=JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:15368}]})+"\n";
const sourcePolicyWorkflow="name: Private CI export policy\non:\n  push:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  private-ci-policy:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n        with:\n          persist-credentials: false\n      - name: Validate fail-closed export policy\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 - <<'PY'\n          import json, re\n          from pathlib import Path\n\n          owner=\"@ORESoftware\"\n\n          def read_regular(path, max_bytes=64 * 1024):\n              target=Path(path)\n              if not target.is_file() or target.is_symlink():\n                  raise SystemExit(\"private CI policy input must be a regular non-symlink file: \" + path)\n              raw=target.read_bytes()\n              if (not raw or len(raw)>max_bytes or raw.startswith(b\"\\xef\\xbb\\xbf\")\n                      or b\"\\x00\" in raw):\n                  raise SystemExit(\"private CI policy input bytes invalid: \" + path)\n              try:\n                  return raw.decode(\"utf-8\")\n              except UnicodeError as exc:\n                  raise SystemExit(\"private CI policy input must be UTF-8: \" + path) from exc\n\n          def no_duplicate_keys(pairs):\n              out={}\n              for key,value in pairs:\n                  if key in out:\n                      raise SystemExit(\"duplicate JSON key in private CI policy\")\n                  out[key]=value\n              return out\n\n          def read_json(path):\n              try:\n                  return json.loads(read_regular(path), object_pairs_hook=no_duplicate_keys)\n              except (ValueError, RecursionError) as exc:\n                  raise SystemExit(\"invalid private CI JSON: \" + path) from exc\n\n          paths=[\n              \"/.github/CODEOWNERS\",\n              \"/.github/private-ci-approved-repositories.txt\",\n              \"/.github/private-ci-approved-source-snapshots.txt\",\n              \"/.github/private-ci-independent-reviewer.json\",\n              \"/.github/private-ci-required-checks.json\",\n              \"/.github/workflows/private-ci-policy.yml\",\n          ]\n          for protected_path in paths:\n              read_regular(\".\" + protected_path)\n          codeowner_lines=read_regular(\".github/CODEOWNERS\").splitlines()\n          rules=[x.strip() for x in codeowner_lines\n                 if x.strip() and not x.lstrip().startswith(\"#\")]\n          if rules[-len(paths):] != [f\"{p} {owner}\" for p in paths]:\n              raise SystemExit(\"private CI CODEOWNERS final block mismatch\")\n          if len(rules)<=len(paths) or rules[-len(paths)-1] != \"/.github/workflows/ @ORESoftware\":\n              raise SystemExit(\"missing workflow directory CODEOWNERS wildcard\")\n\n          def entries(path):\n              active=[]\n              for line in read_regular(path).splitlines():\n                  if not line or line.startswith(\"#\"):\n                      continue\n                  if line != line.strip():\n                      raise SystemExit(\"approval entry has surrounding whitespace: \" + path)\n                  active.append(line)\n              return active\n\n          repos=entries(\".github/private-ci-approved-repositories.txt\")\n          rr=re.compile(r\"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]* [1-9][0-9]{0,19}$\")\n          if any(not rr.fullmatch(x) for x in repos):\n              raise SystemExit(\"invalid destination policy\")\n          names=[x.split()[0].casefold() for x in repos]\n          repo_ids=[x.split()[1] for x in repos]\n          if len(names)!=len(set(names)) or len(repo_ids)!=len(set(repo_ids)):\n              raise SystemExit(\"duplicate destination policy\")\n\n          snaps=entries(\".github/private-ci-approved-source-snapshots.txt\")\n          sr=re.compile(r\"^[0-9a-f]{40} [0-9a-f]{40} [1-9][0-9]{0,19}$\")\n          if any(not sr.fullmatch(x) for x in snaps):\n              raise SystemExit(\"invalid snapshot policy\")\n          if len(snaps)!=len(set(snaps)):\n              raise SystemExit(\"duplicate snapshot policy\")\n\n          reviewer=read_json(\".github/private-ci-independent-reviewer.json\")\n          expected_keys={\"schema\",\"enabled\",\"minimumPermission\",\"disallowedReviewerIds\",\"reviewer\"}\n          if (set(reviewer)!=expected_keys or type(reviewer.get(\"schema\")) is not int\n                  or reviewer[\"schema\"]!=2 or type(reviewer.get(\"enabled\")) is not bool\n                  or reviewer.get(\"minimumPermission\") not in {\"write\",\"maintain\",\"admin\"}):\n              raise SystemExit(\"invalid independent reviewer policy\")\n          blocked=reviewer.get(\"disallowedReviewerIds\")\n          if (not isinstance(blocked,list) or len(blocked)!=2\n                  or any(type(x) is not int or x<=0 for x in blocked)\n                  or set(blocked)!={11139560,2148448}):\n              raise SystemExit(\"invalid independent reviewer denylist\")\n          if reviewer[\"enabled\"] is False:\n              if reviewer[\"reviewer\"] is not None or repos or snaps:\n                  raise SystemExit(\"approvals require enabled independent reviewer\")\n          else:\n              who=reviewer[\"reviewer\"]\n              if (not isinstance(who,dict) or set(who)!={\"login\",\"id\"}\n                      or not isinstance(who.get(\"login\"),str)\n                      or re.fullmatch(r\"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\",who[\"login\"]) is None\n                      or type(who.get(\"id\")) is not int or who[\"id\"]<=0\n                      or who[\"id\"] in blocked):\n                  raise SystemExit(\"invalid independent reviewer identity\")\n              if len(repos)>1 or len(snaps)>1:\n                  raise SystemExit(\"only one private CI canary may be active\")\n              if bool(repos) != bool(snaps):\n                  raise SystemExit(\"destination and snapshot approvals must activate together\")\n              if repos and repos[0].split()[1] != snaps[0].split()[2]:\n                  raise SystemExit(\"destination and snapshot repository IDs differ\")\n\n          data=read_json(\".github/private-ci-required-checks.json\")\n          if (set(data)!={\"schema\",\"checks\"} or type(data.get(\"schema\")) is not int\n                  or data[\"schema\"]!=1 or not isinstance(data[\"checks\"],list) or len(data[\"checks\"])!=1):\n              raise SystemExit(\"invalid required-check schema\")\n          one=data[\"checks\"][0]\n          if (not isinstance(one,dict) or set(one)!={\"context\",\"appId\"}\n                  or one.get(\"context\")!=\"private-ci-policy\" or one.get(\"appId\")!=15368):\n              raise SystemExit(\"private-ci-policy must be bound to GitHub Actions app 15368\")\n          print(\"private CI export policy: PASS\")\n          PY\n";
const rules=()=>({enforce_admins:{enabled:true},
  allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},
  required_status_checks:{strict:true,contexts:[],checks:[{context:"private-ci-policy",app_id:15368}]},
  required_pull_request_reviews:{require_code_owner_reviews:true,
    dismiss_stale_reviews:true,required_approving_review_count:1,
    bypass_pull_request_allowances:{users:[],teams:[],apps:[]}}});
const destination = "sagitta-stack/sagitta-infra";
const incidentPath22="ores-truffle-oreslang/oreslang-platform-conformance/issues/22";
const incidentPath77="ores-truffle-oreslang/oreslang-platform-conformance/issues/77";
const incidentPath127="ores-truffle-oreslang/oreslang-platform-conformance/issues/127";
const incidentPath212="ores-truffle-oreslang/oreslang-platform-conformance/issues/212";
const incident22={
  number:22,state:"closed",state_reason:"completed",
  title:"P0 SECURITY: private Oreslang source mirrored into public GitHub Actions carrier",
  html_url:"https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22",
  repository_url:"https://api.github.com/repos/ores-truffle-oreslang/oreslang-platform-conformance",
  closed_at:"2026-10-17T18:30:00Z"
};
const incident77={
  number:77,state:"closed",state_reason:"completed",
  title:"P0 SECURITY: audit repeated private Oreslang source carriers in Scintilla",
  html_url:"https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77",
  repository_url:"https://api.github.com/repos/ores-truffle-oreslang/oreslang-platform-conformance",
  closed_at:"2026-10-18T14:00:00Z"
};
const incident127={
  number:127,state:"closed",state_reason:"completed",
  title:"P0 SECURITY: investigate source-bearing Oreslang CI placement in dummy-stack private carrier during unprotected policy window",
  html_url:"https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/127",
  repository_url:"https://api.github.com/repos/ores-truffle-oreslang/oreslang-platform-conformance",
  closed_at:"2026-10-29T04:24:00Z"
};
const incident212={
  number:212,state:"closed",state_reason:"completed",
  title:"P0 review: LLVM private source exact tree executed in unapproved honeypot carrier",
  html_url:"https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/212",
  repository_url:"https://api.github.com/repos/ores-truffle-oreslang/oreslang-platform-conformance",
  closed_at:"2026-10-29T04:25:00Z"
};
const carrierCodeowners=[
  "/.github/private-ci-independent-reviewer.json @ORESoftware",
  "/.github/private-ci-approved-source-snapshots.txt @ORESoftware",
  "/.github/private-ci-carrier-policy.json @ORESoftware",
  "/.github/CODEOWNERS @ORESoftware",
  "/.github/workflows/ @ORESoftware"
].join("\n")+"\n";
const carrierPolicy=JSON.stringify({schema:1,carrier:{context:"carrier-policy",appId:15368}})+"\n";
const carrierPolicyWorkflow="name: Private CI carrier admission\n\non:\n  push:\n    branches:\n      - main\n      - 'ci/oreslang-*'\n  pull_request:\n    branches:\n      - main\n\npermissions:\n  contents: read\n\njobs:\n  carrier-policy:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n\n      - name: Verify immutable carrier identity and privacy\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 - <<'PY'\n          import json\n          import os\n\n          with open(os.environ[\"GITHUB_EVENT_PATH\"], \"r\", encoding=\"utf-8\") as stream:\n              event = json.load(stream)\n          repo = event.get(\"repository\") or {}\n          assert repo.get(\"id\") == 1357615104, \"unexpected carrier repository ID\"\n          assert repo.get(\"full_name\", \"\").casefold() == \"sagitta-stack/sagitta-infra\",               \"unexpected carrier repository identity\"\n          assert repo.get(\"private\") is True, \"private CI carrier is not private\"\n          assert repo.get(\"default_branch\") == \"main\", \"carrier default branch is not main\"\n          PY\n\n      - name: Verify terminal security CODEOWNERS\n        shell: bash\n        run: |\n          set -euo pipefail\n          test -f .github/CODEOWNERS\n          mapfile -t rules < <(grep -Ev '^(#|$)' .github/CODEOWNERS)\n          test \"${#rules[@]}\" -ge 11\n          n=\"${#rules[@]}\"\n          test \"${rules[n-11]}\" = \"/scripts/verify-private-ci-provenance.py @ORESoftware\"\n          test \"${rules[n-10]}\" = \"/tests/test_private_ci_provenance.py @ORESoftware\"\n          test \"${rules[n-9]}\" = \"/scripts/verify-carrier-payload-commit.py @ORESoftware\"\n          test \"${rules[n-8]}\" = \"/tests/test_carrier_payload_commit.py @ORESoftware\"\n          test \"${rules[n-7]}\" = \"/scripts/verify-carrier-review-approval.py @ORESoftware\"\n          test \"${rules[n-6]}\" = \"/tests/test_carrier_review_approval.py @ORESoftware\"\n          test \"${rules[n-5]}\" = \"/.github/private-ci-independent-reviewer.json @ORESoftware\"\n          test \"${rules[n-4]}\" = \"/.github/private-ci-approved-source-snapshots.txt @ORESoftware\"\n          test \"${rules[n-3]}\" = \"/.github/private-ci-carrier-policy.json @ORESoftware\"\n          test \"${rules[n-2]}\" = \"/.github/CODEOWNERS @ORESoftware\"\n          test \"${rules[n-1]}\" = \"/.github/workflows/ @ORESoftware\"\n\n      - name: Validate independent reviewer policy shape\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 -I - <<'PY'\n          import json\n          import re\n          from pathlib import Path\n\n          path = Path(\".github/private-ci-independent-reviewer.json\")\n          if not path.is_file() or path.is_symlink():\n              raise SystemExit(\"independent reviewer policy must be a regular file\")\n          raw = path.read_bytes()\n          if (not raw or len(raw) > 16 * 1024 or raw.startswith(b\"\\xef\\xbb\\xbf\")\n                  or b\"\\x00\" in raw):\n              raise SystemExit(\"independent reviewer policy bytes invalid\")\n          try:\n              text = raw.decode(\"utf-8\")\n          except UnicodeError as exc:\n              raise SystemExit(\"independent reviewer policy encoding invalid\") from exc\n\n          def no_duplicates(pairs):\n              out = {}\n              for key, value in pairs:\n                  if key in out:\n                      raise SystemExit(\"duplicate independent reviewer JSON key\")\n                  out[key] = value\n              return out\n\n          try:\n              data = json.loads(text, object_pairs_hook=no_duplicates)\n          except (ValueError, RecursionError) as exc:\n              raise SystemExit(\"independent reviewer policy JSON invalid\") from exc\n\n          required = {\"schema\", \"enabled\", \"minimumPermission\",\n                      \"disallowedReviewerIds\", \"reviewer\"}\n          if (set(data) != required or type(data.get(\"schema\")) is not int\n                  or data.get(\"schema\") != 2):\n              raise SystemExit(\"independent reviewer policy schema mismatch\")\n          if data.get(\"minimumPermission\") not in {\"write\", \"maintain\", \"admin\"}:\n              raise SystemExit(\"independent reviewer minimum permission invalid\")\n          blocked = data.get(\"disallowedReviewerIds\")\n          if (not isinstance(blocked, list) or not blocked\n                  or any(type(item) is not int or item <= 0 for item in blocked)\n                  or len(set(blocked)) != len(blocked)\n                  or set(blocked) != {11139560, 2148448}):\n              raise SystemExit(\"independent reviewer operator denylist mismatch\")\n          if type(data.get(\"enabled\")) is not bool:\n              raise SystemExit(\"independent reviewer enabled flag must be boolean\")\n          if data[\"enabled\"] is False:\n              if data[\"reviewer\"] is not None:\n                  raise SystemExit(\"disabled reviewer policy must not name a reviewer\")\n          else:\n              reviewer = data[\"reviewer\"]\n              if not isinstance(reviewer, dict) or set(reviewer) != {\"login\", \"id\"}:\n                  raise SystemExit(\"enabled reviewer identity malformed\")\n              if not isinstance(reviewer[\"login\"], str) or not re.fullmatch(\n                  r\"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\", reviewer[\"login\"]\n              ):\n                  raise SystemExit(\"enabled reviewer login malformed\")\n              if type(reviewer[\"id\"]) is not int or reviewer[\"id\"] <= 0:\n                  raise SystemExit(\"enabled reviewer id malformed\")\n              if reviewer[\"id\"] in blocked:\n                  raise SystemExit(\"operator-controlled reviewer cannot be independent\")\n          print(\"independent reviewer policy shape: PASS\")\n          PY\n\n      - name: Validate explicit carrier policy identity\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 -I - <<'PY'\n          import json\n          from pathlib import Path\n\n          path = Path(\".github/private-ci-carrier-policy.json\")\n          if not path.is_file() or path.is_symlink():\n              raise SystemExit(\"carrier policy must be a regular file\")\n          raw = path.read_bytes()\n          if (not raw or len(raw) > 8 * 1024 or raw.startswith(b\"\\xef\\xbb\\xbf\")\n                  or b\"\\x00\" in raw):\n              raise SystemExit(\"carrier policy bytes invalid\")\n          try:\n              text = raw.decode(\"utf-8\")\n          except UnicodeError as exc:\n              raise SystemExit(\"carrier policy encoding invalid\") from exc\n\n          def no_duplicates(pairs):\n              out = {}\n              for key, value in pairs:\n                  if key in out:\n                      raise SystemExit(\"duplicate carrier policy JSON key\")\n                  out[key] = value\n              return out\n\n          try:\n              data = json.loads(text, object_pairs_hook=no_duplicates)\n          except (ValueError, RecursionError) as exc:\n              raise SystemExit(\"carrier policy JSON invalid\") from exc\n          expected = {\n              \"schema\": 1,\n              \"carrier\": {\"context\": \"carrier-policy\", \"appId\": 15368},\n          }\n          if type(data.get(\"schema\")) is not int or data != expected:\n              raise SystemExit(\"carrier policy identity mismatch\")\n          print(\"carrier policy identity: PASS\")\n          PY\n\n      - name: Validate carrier snapshot ledger activation order\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 -I - <<'PY'\n          import json\n          import re\n          from pathlib import Path\n\n          reviewer = json.loads(\n              Path(\".github/private-ci-independent-reviewer.json\").read_text(encoding=\"utf-8\"))\n          policy = Path(\".github/private-ci-approved-source-snapshots.txt\")\n          if not policy.is_file() or policy.is_symlink():\n              raise SystemExit(\"carrier snapshot ledger must be a regular file\")\n          raw = policy.read_bytes()\n          if (not raw or len(raw) > 16 * 1024 or raw.startswith(b\"\\xef\\xbb\\xbf\")\n                  or b\"\\x00\" in raw):\n              raise SystemExit(\"carrier snapshot ledger bytes invalid\")\n          try:\n              lines = raw.decode(\"utf-8\").splitlines()\n          except UnicodeError as exc:\n              raise SystemExit(\"carrier snapshot ledger encoding invalid\") from exc\n\n          row = re.compile(r\"^([0-9a-f]{40}) ([0-9a-f]{40}) ([1-9][0-9]*)$\")\n          active = []\n          for line in lines:\n              if not line or line.startswith(\"#\"):\n                  continue\n              match = row.fullmatch(line)\n              if match is None:\n                  raise SystemExit(\"carrier snapshot ledger entry malformed\")\n              entry = (match.group(1), match.group(2), int(match.group(3)))\n              if entry[2] != 1357615104:\n                  raise SystemExit(\"carrier snapshot ledger repository ID mismatch\")\n              if entry in active:\n                  raise SystemExit(\"duplicate carrier snapshot ledger entry\")\n              active.append(entry)\n\n          if reviewer.get(\"enabled\") is False and active:\n              raise SystemExit(\n                  \"carrier snapshot ledger must remain empty until independent reviewer is enabled\")\n          if reviewer.get(\"enabled\") is True and len(active) > 1:\n              raise SystemExit(\"carrier snapshot ledger permits only one active canary\")\n          print(f\"CARRIER_SNAPSHOT_LEDGER_PASS active={len(active)}\")\n          PY\n\n      - name: Verify pinned private-source subtree identity\n        shell: bash\n        run: |\n          set -euo pipefail\n          branch=\"${GITHUB_HEAD_REF:-${GITHUB_REF_NAME}}\"\n          case \"$branch\" in\n            ci/oreslang-*)\n              expected=\"${branch#ci/oreslang-}\"\n              [[ \"$expected\" =~ ^[0-9a-f]{40}$ ]]\n              test -d private-oreslang-source\n              actual=\"$(git rev-parse 'HEAD:private-oreslang-source')\"\n              test \"$actual\" = \"$expected\"\n              ;;\n            *)\n              echo \"No private-source subtree expected for branch: $branch\"\n              ;;\n          esac\n";
const sourceAuthorizationCommit="1".repeat(40),carrierAuthorizationCommit="2".repeat(40);
const sourcePrHead="3".repeat(40),carrierPrHead="4".repeat(40);
const carrierRules=()=>({enforce_admins:{enabled:true},
  allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},
  required_status_checks:{strict:true,contexts:[],checks:[{context:"carrier-policy",app_id:15368}]},
  required_pull_request_reviews:{require_code_owner_reviews:true,
    dismiss_stale_reviews:true,required_approving_review_count:1,
    bypass_pull_request_allowances:{users:[],teams:[],apps:[]}}});
const good = name => ({
  full_name: name, private: true, visibility: "private",
  archived:false,disabled:false,id:name===source?1410897874:destinationId,
  permissions:{push:true}
});
function fixture(records = {}, calls = []) {
  return async (url, options) => {
    calls.push({url, options});
    assert.match(url, /^https:\/\/api\.github\.com\/repos\//);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer restricted-test-token");
    const name = url.slice("https://api.github.com/repos/".length);
    const defaults={
      [incidentPath22]:incident22,
      [incidentPath77]:incident77,
      [incidentPath127]:incident127,
      [incidentPath212]:incident212,
      [destination+"/branches/main"]:{name:"main",protected:true,commit:{sha:C}},
      [destination+"/branches/main/protection"]:carrierRules(),
      [destination+"/contents/.github/CODEOWNERS?ref="+C]:encoded(carrierCodeowners),
      [destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C]:encoded(carrierPolicy),
      [destination+"/contents/.github/private-ci-independent-reviewer.json?ref="+C]:encoded(reviewerPolicy),
      [destination+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+C]:
        encoded(A+" "+T+" "+destinationId+"\n"),
      [destination+"/contents/.github/workflows/private-ci-carrier-admission.yml?ref="+C]:
        encoded(carrierPolicyWorkflow),
      [destination+"/commits?sha="+C+"&path=.github%2Fprivate-ci-independent-reviewer.json&per_page=1"]:
        [{sha:carrierAuthorizationCommit}],
      [destination+"/commits?sha="+C+"&path=.github%2Fprivate-ci-approved-source-snapshots.txt&per_page=1"]:
        [{sha:carrierAuthorizationCommit}],
      [destination+"/commits/"+carrierAuthorizationCommit+"/pulls?per_page=20"]:[{
        number:701,state:"closed",merged_at:"2026-10-18T14:00:00Z",
        base:{ref:"main",repo:{full_name:destination}},head:{sha:carrierPrHead,repo:{full_name:destination}},
        user:{id:400000002}
      }],
      [destination+"/pulls/701/reviews?per_page=100"]:[{
        id:9002,state:"APPROVED",commit_id:carrierPrHead,
        submitted_at:"2026-10-18T13:59:00Z",user:reviewer
      }],
      [destination+"/collaborators/"+reviewer.login+"/permission"]:
        {permission:"write",user:reviewer},
      [source+"/branches/main"]:{name:"main",protected:true,commit:{sha:M}},
      [source+"/branches/main/protection"]:rules(),
      [source+"/contents/.github/CODEOWNERS?ref="+M]:encoded(codeowners),
      [source+"/contents/.github/private-ci-required-checks.json?ref="+M]:
        encoded(requiredChecks),
      [source+"/contents/.github/private-ci-independent-reviewer.json?ref="+M]:
        encoded(reviewerPolicy),
      [source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M]:
        encoded(destination+" "+destinationId+"\n"),
      [source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M]:
        encoded(A+" "+T+" "+destinationId+"\n"),
      [source+"/contents/.github/workflows/private-ci-policy.yml?ref="+M]:
        encoded(sourcePolicyWorkflow),
      [source+"/commits?sha="+M+"&path=.github%2Fprivate-ci-approved-repositories.txt&per_page=1"]:
        [{sha:sourceAuthorizationCommit}],
      [source+"/commits?sha="+M+"&path=.github%2Fprivate-ci-approved-source-snapshots.txt&per_page=1"]:
        [{sha:sourceAuthorizationCommit}],
      [source+"/commits?sha="+M+"&path=.github%2Fprivate-ci-independent-reviewer.json&per_page=1"]:
        [{sha:sourceAuthorizationCommit}],
      [source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20"]:[{
        number:501,state:"closed",merged_at:"2026-10-18T14:00:00Z",
        base:{ref:"main",repo:{full_name:source}},head:{sha:sourcePrHead,repo:{full_name:source}},
        user:{id:400000001}
      }],
      [source+"/pulls/501/reviews?per_page=100"]:[{
        id:9001,state:"APPROVED",commit_id:sourcePrHead,
        submitted_at:"2026-10-18T13:59:00Z",user:reviewer
      }],
      [source+"/collaborators/"+reviewer.login+"/permission"]:
        {permission:"write",user:reviewer},
      [source+"/git/commits/"+A]:{sha:A,tree:{sha:T}}
    };
    const result=records[name]??defaults[name]??good(name);
    return {status: result?.status ?? 200, json: async () => result?.data ?? result};
  };
}
const base = {
  source,destination,sourceCommit:A,sourceTree:T,approvedDestinations:[destination],
  token: "restricted-test-token"
};
const check = (overrides = {}, records = {}, calls = []) =>
  requirePrivateMirror({...base, fetchImpl: fixture(records, calls), ...overrides});

test("accepts only explicitly approved and GitHub-verified writable private destination", async () => {
  const calls = [];
  assert.deepEqual(await check({}, {}, calls), {
    status:"PRIVATE_MIRROR_APPROVED",source,destination,
    sourceCommit:A,sourceTree:T,destinationId
  });
  assert.ok(calls.length >= 30);
  assert.equal(calls[0].url.endsWith("/" + source), true);
  assert.equal(calls[1].url.endsWith("/" + destination), true);
});

test("rejects public, internal, contradictory, archived and unwritable destinations", async () => {
  for (const metadata of [
    {...good(destination), private: false, visibility: "public"},
    {...good(destination), private: true, visibility: "internal"},
    {...good(destination), private: true, visibility: "public"},
    {...good(destination), archived: true},
    {...good(destination), permissions: {push: false}},
    {...good(destination), permissions: undefined}
  ]) {
    await assert.rejects(check({}, {[destination]: metadata}), /writable verified PRIVATE/);
  }
});

test("rejects wrong or public source metadata even when destination is private", async () => {
  for (const metadata of [
    {...good(source), private: false, visibility: "public"},
    {...good(source), visibility: "internal"},
    {...good(source), archived: true}
  ]) {
    const calls = [];
    await assert.rejects(check({}, {[source]: metadata}, calls), /private source metadata/);
    assert.equal(calls.length, 5, "cannot inspect target after all four incidents + source rejection");
  }
});

test("unknown, unauthorized and missing metadata fail closed", async () => {
  for (const metadata of [
    {status: 403}, {status: 404}, {status: 401},
    {status: 200, data: {private: true, visibility: "private"}},
    {status: 200, data: {full_name: destination, private: "true", visibility: "private"}},
    {status: 200, data: {full_name: "someone-else/private", private: true, visibility: "private"}}
  ]) {
    await assert.rejects(check({}, {[destination]: metadata}), /unverifiable|invalid or mismatched/);
  }
});

test("missing explicit destination approval is rejected before any network request", async () => {
  for (const approvedDestinations of [undefined, [], ["other/repo"], [destination, "../evil"], Array(40).fill(destination)]) {
    const calls = [];
    await assert.rejects(check({approvedDestinations}, {}, calls), /allowlist/);
    assert.equal(calls.length, 0);
  }
});

test("missing credentials fail closed before any network request", async () => {
  for (const token of [undefined, "", " "]) {
    const calls = [];
    await assert.rejects(check({token}, {}, calls), /authenticated GitHub/);
    assert.equal(calls.length, 0);
  }
});

test("rejects malformed repository names and URL injection before making requests", async () => {
  for (const sourceValue of [
    "../other/repo", "org/repo?private=true", "org/repo#frag",
    "org/repo/extra", "org\\repo", "", "org/..", "org/repo\nHeader: injection"
  ]) {
    const calls = [];
    await assert.rejects(check({source: sourceValue}, {}, calls), /invalid GitHub/);
    assert.equal(calls.length, 0);
  }
});

test("transport, timeout, JSON and redirect failures never become approval", async () => {
  for (const fetchImpl of [
    async () => { throw Error("network error"); },
    async () => { throw Error("redirect not allowed"); },
    async () => ({status: 200, json: async () => { throw Error("invalid JSON"); }}),
    async () => null
  ]) {
    await assert.rejects(check({fetchImpl}));
  }
});

test("no permissive fallback exists if caller fails to supply a fetch implementation", async () => {
  await assert.rejects(check({fetchImpl: null}), /visibility lookup unavailable/);
});

test("transport and JSON parse errors redact credentials even if client errors include them", async () => {
  const secret = "restricted-test-token";
  for (const fetchImpl of [
    async () => { throw Error("bad Authorization: Bearer " + secret); },
    async () => ({status: 200, json: async () => {
      throw Error("request Authorization Bearer " + secret);
    }})
  ]) {
    await assert.rejects(check({fetchImpl}), error => {
      assert.equal(error.message.includes(secret), false, "token leaked in error");
      assert.match(error.message, /lookup failed|metadata could not be decoded|policy lookup failed|not decodable/);
      return true;
    });
  }
});

test("unprotected source or missing enforceable codeowner review rejects",async()=>{
 const branch={name:"main",protected:false,commit:{sha:M}};
 const review={...rules(),required_pull_request_reviews:{
   ...rules().required_pull_request_reviews,require_code_owner_reviews:false}};
 for(const records of [
  {[source+"/branches/main"]:branch},
  {[source+"/branches/main/protection"]:review},
  {[source+"/branches/main/protection"]:{status:403}}
 ]) {
  const calls=[];
  await assert.rejects(check({},records,calls),/protected source main|codeowner|unavailable/);
  assert.equal(calls.filter(x=>x.options.method!=="GET").length,0);
 }
});
test("reviewed policy must pin destination numeric ID and immutable source snapshot",async()=>{
 const a=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const b=source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M;
 for(const records of [
  {[a]:encoded("# empty\n")},
  {[a]:encoded(destination+" 9999\n")},
  {[b]:encoded("# empty\n")},
  {[b]:encoded(A+" "+"e".repeat(40)+" "+destinationId+"\n")},
  {[b]:encoded(A+" "+T+" "+destinationId+"\n"+A+" "+T+" "+destinationId+"\n")}
 ]) await assert.rejects(check({},records),/approval/);
});
test("untrusted source ID, missing source pins, and mismatched Git tree deny",async()=>{
 for(const change of [{sourceTree:undefined},{sourceCommit:undefined},{sourceCommit:"x".repeat(40)}]){
  const calls=[];
  await assert.rejects(check(change,{},calls),/exact pinned/);
  assert.equal(calls.length,0);
 }
 await assert.rejects(check({},{[source]:{...good(source),id:7}}),/immutable source/);
 await assert.rejects(check({},{[source+"/git/commits/"+A]:{
  sha:A,tree:{sha:"e".repeat(40)}}}),/commit.tree mismatch/);
});
test("protected-main revision change while reading policy denies",async()=>{
 let visits=0;
 const fallback=fixture();
 const mock=async(url,options)=>{
  if(url.endsWith("/"+source+"/branches/main")){
   ++visits;
   return {status:200,json:async()=>({name:"main",protected:true,
     commit:{sha:visits===1?M:"e".repeat(40)}})};
  }
  return fallback(url,options);
 };
 await assert.rejects(check({fetchImpl:mock}),/changed during source admission/);
});

test("source policy Git blob digest must match the reviewed bytes",async()=>{
 const policy=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const forged={...encoded(destination+" "+destinationId+"\n"),sha:"f".repeat(40)};
 await assert.rejects(check({}, {[policy]:forged}),/policy blob digest mismatch/);
});
test("security CODEOWNERS must end with exact org-team ownership for every export policy file",async()=>{
 const path=source+"/contents/.github/CODEOWNERS?ref="+M;
 for(const text of [
  [
   "/.github/CODEOWNERS "+securityOwners,
   "/.github/private-ci-approved-repositories.txt "+securityOwners,
   "/.github/private-ci-approved-source-snapshots.txt "+securityOwners,
   "/.github/private-ci-required-checks.json "+securityOwners
  ].join("\n")+"\n",
  codeowners+"* @someone-else\n",
  codeowners.replaceAll(securityOwners,"@individual"),
  codeowners.replace(
    "/.github/private-ci-required-checks.json "+securityOwners,
    "/.github/private-ci-required-checks.json @ores-truffle-oreslang/other-team")
 ]){
  await assert.rejects(check({}, {[path]:encoded(text)}),/security CODEOWNERS/);
 }
});

test("additional required checks are allowed only when every check is app-bound and approved checks remain present",async()=>{
 const key=source+"/branches/main/protection";
 const baseline=rules();
 const extra={...baseline,required_status_checks:{strict:true,contexts:[],checks:[
  {context:"private-ci-policy",app_id:15368},{context:"security-lint",app_id:15368}
 ]}};
 assert.deepEqual((await check({}, {[key]:extra})).destinationId,destinationId);
 const unbound={...baseline,required_status_checks:{strict:true,contexts:[],checks:[
  {context:"private-ci-policy",app_id:15368},{context:"security-lint",app_id:null}
 ]}};
 await assert.rejects(check({}, {[key]:unbound}),/context\/app identity invalid/);
});

test("the existing independently reviewed ORESoftware owner remains an accepted exact security owner",async()=>{
 const path=source+"/contents/.github/CODEOWNERS?ref="+M;
 const owner="@ORESoftware";
 const text=[
  "/.github/CODEOWNERS "+owner,
  "/.github/private-ci-approved-repositories.txt "+owner,
  "/.github/private-ci-approved-source-snapshots.txt "+owner,
  "/.github/private-ci-required-checks.json "+owner,
  "/.github/workflows/private-ci-policy.yml "+owner
 ].join("\n")+"\n";
 assert.deepEqual((await check({}, {[path]:encoded(text)})).destinationId,destinationId);
});

test("required-check policy must exactly bind context to GitHub App ID",async()=>{
 const path=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
 for(const text of [
  JSON.stringify({schema:1,checks:[]}),
  JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:0}]}),
  JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:15368},{context:"private-ci-policy",appId:15368}]}),
  JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:9999}]})
 ]){
  await assert.rejects(check({}, {[path]:encoded(text+"\n")}),
    /required-check policy|context\/app identity/);
 }
});
test("strict app-bound required CI and reviewer bypass protection are mandatory",async()=>{
 const key=source+"/branches/main/protection";
 const baseline=rules();
 for(const [bad,pattern] of [
  [{...baseline,required_status_checks:undefined},/required status checks/],
  [{...baseline,required_status_checks:{strict:false,contexts:[],checks:[{context:"private-ci-policy",app_id:15368}]}},/required status checks/],
  [{...baseline,required_status_checks:{strict:true,contexts:["legacy"],checks:[{context:"private-ci-policy",app_id:15368}]}},/required status checks/],
  [{...baseline,required_status_checks:{strict:true,contexts:[],checks:[]}},/required status checks/],
  [{...baseline,required_status_checks:{strict:true,contexts:[],checks:[{context:"private-ci-policy",app_id:9999}]}},/context\/app identity/],
  [{...baseline,required_pull_request_reviews:{...baseline.required_pull_request_reviews,
    bypass_pull_request_allowances:{users:[{login:"owner"}],teams:[],apps:[]}}},/codeowner review proof/],
  [{...baseline,required_pull_request_reviews:{...baseline.required_pull_request_reviews,
    bypass_pull_request_allowances:undefined}},/codeowner review proof/]
 ]){
   await assert.rejects(check({}, {[key]:bad}),pattern);
 }
});
test("duplicate destination names or numeric ids and ambiguous snapshots deny",async()=>{
 const dest=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const snaps=source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M;
 for(const policy of [
  destination+" "+destinationId+"\n"+destination+" 5678\n",
  destination+" "+destinationId+"\n"+"alternate/repo "+destinationId+"\n"
 ]){
  await assert.rejects(check({}, {[dest]:encoded(policy)}),/duplicate reviewed/);
 }
 await assert.rejects(check({}, {[snaps]:encoded(
   A+" "+T+" "+destinationId+"\n"+
   "e".repeat(40)+" "+"f".repeat(40)+" "+destinationId+"\n"
 )}),/duplicate reviewed/);
});
test("noncanonical base64 and invalid policy UTF8 must deny",async()=>{
 const policy=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const normal=encoded(destination+" "+destinationId+"\n");
 for(const data of [
   {...normal,content:normal.content.slice(0,-1)},
   {...normal,content:"_invalid"},
   {...normal,encoding:"utf-8"}
 ]){
  await assert.rejects(check({}, {[policy]:data}),/policy content/);
 }
});


test("all four P0 incidents must be exactly completed before source metadata is inspected",async()=>{
  for(const [path,incident,prior] of [
    [incidentPath22,incident22,0],
    [incidentPath77,incident77,1],
    [incidentPath127,incident127,2],
    [incidentPath212,incident212,3]
  ]){
    for(const bad of [
      {...incident,state:"open",state_reason:null,closed_at:null},
      {...incident,state_reason:"not_planned"},
      {...incident,title:"renamed incident"},
      {...incident,repository_url:"https://api.github.com/repos/other/repo"},
      {...incident,closed_at:"not-a-timestamp"}
    ]){
      const calls=[];
      await assert.rejects(check({}, {[path]:bad}, calls),/incident is not completed/);
      assert.equal(calls.length,prior+1);
      assert.equal(calls.some(x=>x.url.endsWith("/"+source)),false);
    }
  }
});

test("destination carrier main, review policy, CODEOWNERS and issuer-bound check are mandatory",async()=>{
  const branch=destination+"/branches/main";
  const protection=destination+"/branches/main/protection";
  const owners=destination+"/contents/.github/CODEOWNERS?ref="+C;
  const policy=destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C;
  for(const [records,pattern] of [
    [{[branch]:{name:"main",protected:false,commit:{sha:C}}},/protected carrier main/],
    [{[protection]:{...carrierRules(),enforce_admins:{enabled:false}}},/protection mismatch/],
    [{[protection]:{...carrierRules(),required_status_checks:{strict:true,contexts:[],checks:[{context:"carrier-policy",app_id:9999}]}}},/carrier-policy check\/app binding/],
    [{[protection]:{...carrierRules(),required_status_checks:{strict:true,contexts:["legacy"],checks:[{context:"carrier-policy",app_id:15368}]}}},/strict app-bound carrier/],
    [{[owners]:encoded(carrierCodeowners+"* @someone-else\n")},/carrier security CODEOWNERS/],
    [{[policy]:encoded(JSON.stringify({schema:1,carrier:{context:"carrier-policy",appId:9999}})+"\n")},/carrier policy identity/]
  ]){
    await assert.rejects(check({},records),pattern);
  }
});

test("carrier protected-main drift during admission denies",async()=>{
  let reads=0;
  const fallback=fixture();
  const fetchImpl=async(url,options)=>{
    if(url.endsWith("/"+destination+"/branches/main")){
      reads++;
      return {status:200,json:async()=>({name:"main",protected:true,
        commit:{sha:reads===1?C:"e".repeat(40)}})};
    }
    return fallback(url,options);
  };
  await assert.rejects(check({fetchImpl}),/carrier policy changed during admission/);
});


test("policy JSON rejects duplicate and escaped-equivalent keys end to end",async()=>{
  const checksPath=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
  const carrierPath=destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C;
  for(const text of [
    '{"schema":1,"schema":2,"checks":[{"context":"private-ci-policy","appId":15368}]}',
    '{"schema":1,"\\u0073chema":2,"checks":[{"context":"private-ci-policy","appId":15368}]}',
    '{"schema":1,"checks":[{"context":"private-ci-policy","context":"other","appId":15368}]}'
  ]) await assert.rejects(check({}, {[checksPath]:encoded(text)}),/duplicate object key|ambiguous or invalid/);
  for(const text of [
    '{"schema":1,"schema":2,"carrier":{"context":"carrier-policy","appId":15368}}',
    '{"schema":1,"carrier":{"context":"carrier-policy","context":"other","appId":15368}}'
  ]) await assert.rejects(check({}, {[carrierPath]:encoded(text)}),/duplicate object key|ambiguous or invalid/);
});

test("policy bytes and exact line grammar reject BOM NUL and surrounding whitespace",async()=>{
  const destPath=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
  const checksPath=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
  const ownersPath=destination+"/contents/.github/CODEOWNERS?ref="+C;
  await assert.rejects(check({}, {[destPath]:encoded(" "+destination+" "+destinationId+"\n")}),/ambiguous surrounding whitespace/);
  await assert.rejects(check({}, {[ownersPath]:encoded(carrierCodeowners.replace("/.github/CODEOWNERS @ORESoftware","/.github/CODEOWNERS @ORESoftware "))}),/ambiguous surrounding whitespace/);
  for(const text of ["\\ufeff"+requiredChecks, requiredChecks+"\\u0000"]){
    await assert.rejects(check({}, {[checksPath]:encoded(text)}),/forbidden BOM\/NUL/);
  }
});

test("boolean schema values cannot satisfy carrier or source policy schemas",async()=>{
  const checksPath=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
  const carrierPath=destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C;
  await assert.rejects(check({}, {[checksPath]:encoded(JSON.stringify({schema:true,checks:[{context:"private-ci-policy",appId:15368}]}))}),/schema/);
  await assert.rejects(check({}, {[carrierPath]:encoded(JSON.stringify({schema:true,carrier:{context:"carrier-policy",appId:15368}}))}),/carrier policy identity/);
});


test("source and carrier canary activation require exact-head independent approvals",async()=>{
  const srcReviews=source+"/pulls/501/reviews?per_page=100";
  const carReviews=destination+"/pulls/701/reviews?per_page=100";
  for(const [path,head] of [[srcReviews,sourcePrHead],[carReviews,carrierPrHead]]){
    for(const reviews of [
      [],
      [{id:1,state:"COMMENTED",commit_id:head,submitted_at:"2026-10-18T13:59:00Z",user:reviewer}],
      [{id:1,state:"APPROVED",commit_id:"5".repeat(40),submitted_at:"2026-10-18T13:59:00Z",user:reviewer}],
      [{id:1,state:"APPROVED",commit_id:head,submitted_at:"2026-10-18T13:58:00Z",user:reviewer},
       {id:2,state:"CHANGES_REQUESTED",commit_id:head,submitted_at:"2026-10-18T13:59:00Z",user:reviewer}]
    ]) await assert.rejects(check({}, {[path]:reviews}),/independent reviewer has not approved/);
  }
});

test("authorization files must be activated together in one reviewed commit",async()=>{
  const path=source+"/commits?sha="+M+"&path=.github%2Fprivate-ci-independent-reviewer.json&per_page=1";
  await assert.rejects(check({}, {[path]:[{sha:"6".repeat(40)}]}),/not activated in one reviewed commit/);
  const carrierPath=destination+"/commits?sha="+C+"&path=.github%2Fprivate-ci-approved-source-snapshots.txt&per_page=1";
  await assert.rejects(check({}, {[carrierPath]:[{sha:"7".repeat(40)}]}),/not activated in one reviewed commit/);
});

test("independent reviewer must be live, distinct from PR author, and identical on both sides",async()=>{
  const srcPermission=source+"/collaborators/"+reviewer.login+"/permission";
  await assert.rejects(check({}, {[srcPermission]:{permission:"read",user:reviewer}}),/live repository permission/);
  const srcPull=source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20";
  await assert.rejects(check({}, {[srcPull]:[{
    number:501,state:"closed",merged_at:"2026-10-18T14:00:00Z",
    base:{ref:"main",repo:{full_name:source}},
    head:{sha:sourcePrHead,repo:{full_name:source}},user:{id:reviewer.id}
  }]}),/cannot be the authorization PR author/);
  const carrierReviewerPath=destination+"/contents/.github/private-ci-independent-reviewer.json?ref="+C;
  const otherReviewer={login:"someone-else",id:300000002};
  const other=JSON.stringify({schema:2,enabled:true,minimumPermission:"write",
    disallowedReviewerIds:[11139560,2148448],reviewer:otherReviewer})+"\n";
  const carReviews=destination+"/pulls/701/reviews?per_page=100";
  const carPermission=destination+"/collaborators/"+otherReviewer.login+"/permission";
  await assert.rejects(check({}, {
    [carrierReviewerPath]:encoded(other),
    [carReviews]:[{
      id:9004,state:"APPROVED",commit_id:carrierPrHead,
      submitted_at:"2026-10-18T13:59:00Z",user:otherReviewer
    }],
    [carPermission]:{permission:"write",user:otherReviewer}
  }),/source and carrier independent reviewer policies do not match/);
});

test("source and carrier status workflows are pinned to independently reviewed Git blobs",async()=>{
  const src=source+"/contents/.github/workflows/private-ci-policy.yml?ref="+M;
  const car=destination+"/contents/.github/workflows/private-ci-carrier-admission.yml?ref="+C;
  await assert.rejects(check({}, {[src]:encoded(sourcePolicyWorkflow+"\n# mutation\n")}),/source policy workflow differs/);
  await assert.rejects(check({}, {[car]:encoded(carrierPolicyWorkflow+"\n# mutation\n")}),/carrier policy workflow differs/);
});


test("protected ledgers permit exactly one active canary",async()=>{
  const destPath=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
  const snapPath=source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M;
  const carrierSnap=destination+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+C;
  await assert.rejects(check({}, {[destPath]:encoded(
    destination+" "+destinationId+"\nother/private 5678\n")}),/exactly one active canary/);
  await assert.rejects(check({}, {[snapPath]:encoded(
    A+" "+T+" "+destinationId+"\n"+"e".repeat(40)+" "+"f".repeat(40)+" 5678\n")}),/exactly one active canary/);
  await assert.rejects(check({}, {[carrierSnap]:encoded(
    A+" "+T+" "+destinationId+"\n"+"e".repeat(40)+" "+"f".repeat(40)+" 5678\n")}),/exactly one active canary/);
});

test("full PR association page is treated as ambiguous",async()=>{
  const path=source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20";
  const rows=Array.from({length:20},(_,i)=>({
    number:500+i,state:"closed",merged_at:"2026-10-18T14:00:00Z",
    base:{ref:"main",repo:{full_name:source}},
    head:{sha:sourcePrHead,repo:{full_name:source}},user:{id:400000001+i}
  }));
  await assert.rejects(check({}, {[path]:rows}),/lookup is ambiguous/);
});

test("authorization PR base repository identity is pinned",async()=>{
  const srcPull=source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20";
  await assert.rejects(check({}, {[srcPull]:[{
    number:501,state:"closed",merged_at:"2026-10-18T14:00:00Z",
    base:{ref:"main",repo:{full_name:"other/repo"}},
    head:{sha:sourcePrHead,repo:{full_name:source}},user:{id:400000001}
  }]}),/not bound to one merged main pull request/);
});
