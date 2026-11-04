/** Test-only authorized-fixture transport. Fictional approvals: NEVER use for real source exports. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";

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

export { source, destination, A, T, M, C, destinationId, encoded, securityOwners, reviewer, reviewerPolicy, codeowners, requiredChecks, sourcePolicyWorkflow, rules, incidentPath22, incidentPath77, incidentPath127, incidentPath212, incident22, incident77, incident127, incident212, carrierCodeowners, carrierPolicy, carrierPolicyWorkflow, sourceAuthorizationCommit, carrierAuthorizationCommit, sourcePrHead, carrierPrHead, carrierRules, good, fixture };
