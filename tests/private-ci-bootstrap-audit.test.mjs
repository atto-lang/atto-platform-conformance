import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {auditRepository,auditCodeowners,auditRequiredChecks,auditProtection,auditReviewerPolicy} from "../bin/audit-private-ci-bootstrap.mjs";

const repo="ores-truffle-oreslang/oreslang-source.llvm";
const JAVA_REPO="ores-truffle-oreslang/oreslang-source.java";
const javaCodeowners=[
  "/.github/workflows/ @ORESoftware",
  ...["/.github/CODEOWNERS","/.github/private-ci-approved-repositories.txt","/.github/private-ci-approved-source-snapshots.txt","/.github/private-ci-independent-reviewer.json","/.github/private-ci-required-checks.json","/.github/workflows/private-ci-mirror-preflight.yml","/.github/workflows/private-ci-policy.yml","/.github/workflows/private-exact-candidate-validation.yml","/.github/workflows/private-exact-main-validation.yml","/.github/workflows/private-exact-publisher-validation.yml","/docs/security/CI_PRIVATE_SOURCE_MIRRORING.md","/docs/security/PRIVATE_CI_POLICY_INTEGRATION_REVIEW_2026-10-16.md","/docs/security/PRIVATE_EXACT_MAIN_VALIDATION.md","/docs/security/PRIVATE_CI_REVIEW_PINNED_EXTERNAL_ADMISSION.md","/scripts/check-private-ci-destination.sh","/scripts/publish-private-ci-source.py","/scripts/run-in-private-ci-destination.sh","/scripts/test-private-ci-destination.sh","/scripts/test-publish-private-ci-source.py","/scripts/ci_private_mirror_preflight.py","/scripts/verify-review-pinned-private-ci.py","/scripts/dispatch-review-pinned-private-ci.py","/tests/test_ci_private_mirror_preflight.py","/tests/test_review_pinned_private_ci.py","/tests/test_review_pinned_dispatcher.py","/src/test/java/dev/oreslang/PrivateExactMainValidationWorkflowSecurityTest.java","/src/test/java/dev/oreslang/PrivateExactPublisherAdmissionMutationTest.java","/src/test/java/dev/oreslang/PrivateExactPublisherValidationWorkflowSecurityTest.java"].map(path=>path+" @ORESoftware")
].join("\n")+"\n";
const javaChecks=JSON.stringify({
  schema:1,
  source:{context:"private-ci-policy",appId:15368},
  carrier:{context:"carrier-policy",appId:15368}
})+"\n";
const SHA="a".repeat(40);
const owner="@ORESoftware";
const codeowners=[
  "/.github/workflows/ "+owner,
  "/.github/CODEOWNERS "+owner,
  "/.github/private-ci-approved-repositories.txt "+owner,
  "/.github/private-ci-approved-source-snapshots.txt "+owner,
  "/.github/private-ci-independent-reviewer.json "+owner,
  "/.github/private-ci-required-checks.json "+owner,
  "/.github/workflows/private-ci-policy.yml "+owner
].join("\n")+"\n";
const checks=JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:15368}]})+"\n";
const reviewer=JSON.stringify({
  schema:2,enabled:false,minimumPermission:"write",
  disallowedReviewerIds:[11139560,2148448],reviewer:null
},null,2)+"\n";
const empty="# no approvals during bootstrap\n";
// Policy-workflow fixtures are reviewed GitHub Actions YAML, not compiler source.
// The audit must fail closed on even a one-byte change to a trusted check.
const workflow="name: Private CI export policy\non:\n  push:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  private-ci-policy:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n        with:\n          persist-credentials: false\n      - name: Validate fail-closed export policy\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 - <<'PY'\n          import json, re\n          from pathlib import Path\n\n          owner=\"@ORESoftware\"\n\n          def read_regular(path, max_bytes=64 * 1024):\n              target=Path(path)\n              if not target.is_file() or target.is_symlink():\n                  raise SystemExit(\"private CI policy input must be a regular non-symlink file: \" + path)\n              raw=target.read_bytes()\n              if (not raw or len(raw)>max_bytes or raw.startswith(b\"\\xef\\xbb\\xbf\")\n                      or b\"\\x00\" in raw):\n                  raise SystemExit(\"private CI policy input bytes invalid: \" + path)\n              try:\n                  return raw.decode(\"utf-8\")\n              except UnicodeError as exc:\n                  raise SystemExit(\"private CI policy input must be UTF-8: \" + path) from exc\n\n          def no_duplicate_keys(pairs):\n              out={}\n              for key,value in pairs:\n                  if key in out:\n                      raise SystemExit(\"duplicate JSON key in private CI policy\")\n                  out[key]=value\n              return out\n\n          def read_json(path):\n              try:\n                  return json.loads(read_regular(path), object_pairs_hook=no_duplicate_keys)\n              except (ValueError, RecursionError) as exc:\n                  raise SystemExit(\"invalid private CI JSON: \" + path) from exc\n\n          paths=[\n              \"/.github/CODEOWNERS\",\n              \"/.github/private-ci-approved-repositories.txt\",\n              \"/.github/private-ci-approved-source-snapshots.txt\",\n              \"/.github/private-ci-independent-reviewer.json\",\n              \"/.github/private-ci-required-checks.json\",\n              \"/.github/workflows/private-ci-policy.yml\",\n          ]\n          for protected_path in paths:\n              read_regular(\".\" + protected_path)\n          codeowner_lines=read_regular(\".github/CODEOWNERS\").splitlines()\n          rules=[x.strip() for x in codeowner_lines\n                 if x.strip() and not x.lstrip().startswith(\"#\")]\n          if rules[-len(paths):] != [f\"{p} {owner}\" for p in paths]:\n              raise SystemExit(\"private CI CODEOWNERS final block mismatch\")\n          if len(rules)<=len(paths) or rules[-len(paths)-1] != \"/.github/workflows/ @ORESoftware\":\n              raise SystemExit(\"missing workflow directory CODEOWNERS wildcard\")\n\n          def entries(path):\n              active=[]\n              for line in read_regular(path).splitlines():\n                  if not line or line.startswith(\"#\"):\n                      continue\n                  if line != line.strip():\n                      raise SystemExit(\"approval entry has surrounding whitespace: \" + path)\n                  active.append(line)\n              return active\n\n          repos=entries(\".github/private-ci-approved-repositories.txt\")\n          rr=re.compile(r\"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]* [1-9][0-9]{0,19}$\")\n          if any(not rr.fullmatch(x) for x in repos):\n              raise SystemExit(\"invalid destination policy\")\n          names=[x.split()[0].casefold() for x in repos]\n          repo_ids=[x.split()[1] for x in repos]\n          if len(names)!=len(set(names)) or len(repo_ids)!=len(set(repo_ids)):\n              raise SystemExit(\"duplicate destination policy\")\n\n          snaps=entries(\".github/private-ci-approved-source-snapshots.txt\")\n          sr=re.compile(r\"^[0-9a-f]{40} [0-9a-f]{40} [1-9][0-9]{0,19}$\")\n          if any(not sr.fullmatch(x) for x in snaps):\n              raise SystemExit(\"invalid snapshot policy\")\n          if len(snaps)!=len(set(snaps)):\n              raise SystemExit(\"duplicate snapshot policy\")\n\n          reviewer=read_json(\".github/private-ci-independent-reviewer.json\")\n          expected_keys={\"schema\",\"enabled\",\"minimumPermission\",\"disallowedReviewerIds\",\"reviewer\"}\n          if (set(reviewer)!=expected_keys or type(reviewer.get(\"schema\")) is not int\n                  or reviewer[\"schema\"]!=2 or type(reviewer.get(\"enabled\")) is not bool\n                  or reviewer.get(\"minimumPermission\") not in {\"write\",\"maintain\",\"admin\"}):\n              raise SystemExit(\"invalid independent reviewer policy\")\n          blocked=reviewer.get(\"disallowedReviewerIds\")\n          if (not isinstance(blocked,list) or len(blocked)!=2\n                  or any(type(x) is not int or x<=0 for x in blocked)\n                  or set(blocked)!={11139560,2148448}):\n              raise SystemExit(\"invalid independent reviewer denylist\")\n          if reviewer[\"enabled\"] is False:\n              if reviewer[\"reviewer\"] is not None or repos or snaps:\n                  raise SystemExit(\"approvals require enabled independent reviewer\")\n          else:\n              who=reviewer[\"reviewer\"]\n              if (not isinstance(who,dict) or set(who)!={\"login\",\"id\"}\n                      or not isinstance(who.get(\"login\"),str)\n                      or re.fullmatch(r\"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\",who[\"login\"]) is None\n                      or type(who.get(\"id\")) is not int or who[\"id\"]<=0\n                      or who[\"id\"] in blocked):\n                  raise SystemExit(\"invalid independent reviewer identity\")\n              if len(repos)>1 or len(snaps)>1:\n                  raise SystemExit(\"only one private CI canary may be active\")\n              if bool(repos) != bool(snaps):\n                  raise SystemExit(\"destination and snapshot approvals must activate together\")\n              if repos and repos[0].split()[1] != snaps[0].split()[2]:\n                  raise SystemExit(\"destination and snapshot repository IDs differ\")\n\n          data=read_json(\".github/private-ci-required-checks.json\")\n          if (set(data)!={\"schema\",\"checks\"} or type(data.get(\"schema\")) is not int\n                  or data[\"schema\"]!=1 or not isinstance(data[\"checks\"],list) or len(data[\"checks\"])!=1):\n              raise SystemExit(\"invalid required-check schema\")\n          one=data[\"checks\"][0]\n          if (not isinstance(one,dict) or set(one)!={\"context\",\"appId\"}\n                  or one.get(\"context\")!=\"private-ci-policy\" or one.get(\"appId\")!=15368):\n              raise SystemExit(\"private-ci-policy must be bound to GitHub Actions app 15368\")\n          print(\"private CI export policy: PASS\")\n          PY\n";
const javaWorkflow="name: Private CI export policy\n\n# Always produce this check for branch protection; no paths filters.\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  private-ci-policy:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5\n        with:\n          persist-credentials: false\n      - name: Validate issuer contract, ownership and policy grammar\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 -I - <<'PY'\n          import ast\n          import json\n          import re\n          from pathlib import Path\n\n          base = Path(\".github\")\n\n          def read_regular(path, max_bytes=256 * 1024):\n              target = Path(path)\n              if not target.is_file() or target.is_symlink():\n                  raise SystemExit(\"private CI security input must be a regular non-symlink file: \" + str(path))\n              raw = target.read_bytes()\n              if (not raw or len(raw) > max_bytes or raw.startswith(b\"\\xef\\xbb\\xbf\")\n                      or b\"\\x00\" in raw):\n                  raise SystemExit(\"private CI security input bytes invalid: \" + str(path))\n              try:\n                  return raw.decode(\"utf-8\")\n              except UnicodeError as exc:\n                  raise SystemExit(\"private CI security input must be UTF-8: \" + str(path)) from exc\n\n          def no_duplicate_keys(pairs):\n              out = {}\n              for key, value in pairs:\n                  if key in out:\n                      raise SystemExit(\"duplicate JSON key in private CI security input\")\n                  out[key] = value\n              return out\n\n          def read_json(path):\n              try:\n                  return json.loads(read_regular(path), object_pairs_hook=no_duplicate_keys)\n              except (ValueError, RecursionError) as exc:\n                  raise SystemExit(\"invalid private CI JSON: \" + str(path)) from exc\n\n          declared = read_json(base / \"private-ci-required-checks.json\")\n          expected = {\n              \"schema\": 1,\n              \"source\": {\"context\": \"private-ci-policy\", \"appId\": 15368},\n              \"carrier\": {\"context\": \"carrier-policy\", \"appId\": 15368},\n          }\n          if (type(declared) is not dict or type(declared.get(\"schema\")) is not int\n                  or declared != expected):\n              raise SystemExit(\"private CI required checks must be bound to pinned Actions issuer\")\n\n          publisher = ast.parse(read_regular(\"scripts/publish-private-ci-source.py\"))\n          vars = {}\n          for node in publisher.body:\n              if isinstance(node, ast.Assign):\n                  for target in node.targets:\n                      if isinstance(target, ast.Name) and target.id in (\n                              \"REQUIRED_CODEOWNER_PATHS\", \"REQUIRED_CODEOWNER\",\n                              \"SOURCE_POLICY_CHECK\", \"CARRIER_POLICY_CHECK\",\n                              \"GITHUB_ACTIONS_APP_ID\"):\n                          vars[target.id] = ast.literal_eval(node.value)\n          if (len(vars) != 5 or vars[\"REQUIRED_CODEOWNER\"] != \"@ORESoftware\"\n                  or vars[\"SOURCE_POLICY_CHECK\"] != declared[\"source\"][\"context\"]\n                  or vars[\"CARRIER_POLICY_CHECK\"] != declared[\"carrier\"][\"context\"]\n                  or vars[\"GITHUB_ACTIONS_APP_ID\"] != 15368):\n              raise SystemExit(\"publisher security issuer constants mismatch\")\n          required = vars[\"REQUIRED_CODEOWNER_PATHS\"]\n          if not isinstance(required, tuple) or len(required) < 28 or len(set(required)) != len(required):\n              raise SystemExit(\"private CI CODEOWNER path inventory invalid\")\n          codeowners = read_regular(base / \"CODEOWNERS\").splitlines()\n          rules = [s.strip() for s in codeowners if s.strip() and not s.lstrip().startswith(\"#\")]\n          if rules[-len(required):] != [f\"{p} @ORESoftware\" for p in required]:\n              raise SystemExit(\"terminal CODEOWNERS contract mismatch\")\n          if (len(rules) <= len(required)\n                  or rules[-len(required)-1] != \"/.github/workflows/ @ORESoftware\"):\n              raise SystemExit(\"unreviewed workflows could spoof protected check name\")\n          for path in required:\n              target = Path(\".\") / path.lstrip(\"/\")\n              if not target.is_file() or target.is_symlink():\n                  raise SystemExit(\"CODEOWNERS mandatory path must be a regular non-symlink file: \" + path)\n              read_regular(target)\n\n          dest_pattern = re.compile(r\"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]* [1-9][0-9]{0,19}\")\n          snap_pattern = re.compile(r\"[0-9a-f]{40} [0-9a-f]{40} [1-9][0-9]{0,19}\")\n          def load_lines(name, pattern):\n              data = read_regular(base / name).splitlines()\n              active = []\n              for line in data:\n                  if not line or line.startswith(\"#\"):\n                      continue\n                  if line != line.strip() or not pattern.fullmatch(line):\n                      raise SystemExit(\"unreviewable private CI approval format: \" + name)\n                  active.append(line)\n              return active\n          dests = load_lines(\"private-ci-approved-repositories.txt\", dest_pattern)\n          names = [line.split()[0].casefold() for line in dests]\n          ids = [line.split()[1] for line in dests]\n          if len(names) != len(set(names)) or len(ids) != len(set(ids)):\n              raise SystemExit(\"duplicate destination identity\")\n          snaps = load_lines(\"private-ci-approved-source-snapshots.txt\", snap_pattern)\n          if len(snaps) != len(set(snaps)):\n              raise SystemExit(\"duplicate snapshot tuple\")\n          commit_tree = {}\n          for row in snaps:\n              commit, tree, _dest = row.split()\n              if commit in commit_tree and commit_tree[commit] != tree:\n                  raise SystemExit(\"one source commit maps to inconsistent root trees\")\n              commit_tree[commit] = tree\n\n          reviewer = read_json(base / \"private-ci-independent-reviewer.json\")\n          expected_reviewer_keys = {\"schema\", \"enabled\", \"minimumPermission\",\n                                    \"disallowedReviewerIds\", \"reviewer\"}\n          if (set(reviewer) != expected_reviewer_keys\n                  or type(reviewer.get(\"schema\")) is not int\n                  or reviewer[\"schema\"] != 2\n                  or type(reviewer.get(\"enabled\")) is not bool\n                  or reviewer.get(\"minimumPermission\") not in {\"write\", \"maintain\", \"admin\"}):\n              raise SystemExit(\"invalid independent reviewer policy\")\n          blocked = reviewer.get(\"disallowedReviewerIds\")\n          if (not isinstance(blocked, list) or len(blocked) != 2\n                  or any(type(item) is not int or item <= 0 for item in blocked)\n                  or set(blocked) != {11139560, 2148448}):\n              raise SystemExit(\"invalid independent reviewer denylist\")\n          if reviewer[\"enabled\"] is False:\n              if reviewer[\"reviewer\"] is not None or dests or snaps:\n                  raise SystemExit(\"approvals require enabled independent reviewer\")\n          else:\n              who = reviewer[\"reviewer\"]\n              if (not isinstance(who, dict) or set(who) != {\"login\", \"id\"}\n                      or not isinstance(who.get(\"login\"), str)\n                      or re.fullmatch(r\"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\", who[\"login\"]) is None\n                      or type(who.get(\"id\")) is not int or who[\"id\"] <= 0\n                      or who[\"id\"] in blocked):\n                  raise SystemExit(\"invalid independent reviewer identity\")\n              if len(dests) > 1 or len(snaps) > 1:\n                  raise SystemExit(\"only one private CI canary may be active\")\n              if bool(dests) != bool(snaps):\n                  raise SystemExit(\"destination and snapshot approvals must activate together\")\n              if dests and dests[0].split()[1] != snaps[0].split()[2]:\n                  raise SystemExit(\"destination and snapshot repository IDs differ\")\n          print(\"private CI issuer + source policy: PASS\")\n          PY\n";
const protection=()=>({
  enforce_admins:{enabled:true},
  allow_force_pushes:{enabled:false},
  allow_deletions:{enabled:false},
  required_status_checks:{strict:true,contexts:[],checks:[
    {context:"private-ci-policy",app_id:15368},
    {context:"other-security-check",app_id:15368}
  ]},
  required_pull_request_reviews:{
    require_code_owner_reviews:true,
    dismiss_stale_reviews:true,
    required_approving_review_count:1,
    bypass_pull_request_allowances:{users:[],teams:[],apps:[]}
  }
});
function encoded(text){
  const raw=Buffer.from(text);
  return {type:"file",encoding:"base64",content:raw.toString("base64"),
    sha:createHash("sha1").update("blob "+raw.length+"\0").update(raw).digest("hex")};
}
function fixture(overrides={},calls=[],repository=repo){
  let branchReads=0, protectionReads=0, identityReads=0;
  return async (url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,"GET");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,"Bearer test-token");
    const base="https://api.github.com/repos/"+repository;
    if(url===base){
      identityReads++;
      const value=overrides.identity;
      const expected={
        id:repository===JAVA_REPO?1400792274:1410897874,
        full_name:repository,private:true,visibility:"private",
        archived:false,disabled:false
      };
      const custom=typeof value==="function"?value(identityReads,expected):value;
      return {status:200,json:async()=>custom??expected};
    }
    if(url===base+"/branches/main"){
      branchReads++;
      const custom=overrides.branch;
      if(typeof custom==="function") return {status:200,json:async()=>custom(branchReads)};
      return {status:200,json:async()=>custom??{name:"main",protected:true,commit:{sha:SHA}}};
    }
    if(url===base+"/branches/main/protection" && typeof overrides.protection==="function"){
      protectionReads++;
      return {status:200,json:async()=>overrides.protection(protectionReads)};
    }
    const table={
      [base+"/branches/main/protection"]:overrides.protection??protection(),
      [base+"/contents/.github/CODEOWNERS?ref="+SHA]:encoded(overrides.codeowners??codeowners),
      [base+"/contents/.github/private-ci-approved-repositories.txt?ref="+SHA]:encoded(overrides.destinations??empty),
      [base+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+SHA]:encoded(overrides.snapshots??empty),
      [base+"/contents/.github/private-ci-independent-reviewer.json?ref="+SHA]:encoded(overrides.reviewer??reviewer),
      [base+"/contents/.github/private-ci-required-checks.json?ref="+SHA]:encoded(overrides.checks??checks),
      [base+"/contents/.github/workflows/private-ci-policy.yml?ref="+SHA]:encoded(overrides.workflow??(repository===JAVA_REPO?javaWorkflow:workflow))
    };
    const value=table[url];
    if(!value) return {status:404,json:async()=>({message:"not found"})};
    if(value.status) return {status:value.status,json:async()=>value.data};
    return {status:200,json:async()=>value};
  };
}
const run=(overrides={},calls=[])=>auditRepository(repo,{token:"test-token",fetchImpl:fixture(overrides,calls)});

test("accepts strict protected-main bootstrap with empty export approvals",async()=>{
  const result=await run();
  assert.deepEqual(result,{
    repo,status:"BOOTSTRAP_PROTECTED",protectedSha:SHA,
    requiredCheck:"private-ci-policy",requiredCheckAppId:15368
  });
});

test("bootstrap requires disabled non-operator reviewer policy",async()=>{
  assert.doesNotThrow(()=>auditReviewerPolicy(reviewer));
  for(const bad of [
    JSON.stringify({schema:2,enabled:true,minimumPermission:"write",
      disallowedReviewerIds:[11139560,2148448],reviewer:{login:"independent",id:300000001}}),
    JSON.stringify({schema:2,enabled:false,minimumPermission:"write",
      disallowedReviewerIds:[11139560,2148448],reviewer:{login:"ORESoftware",id:11139560}}),
    JSON.stringify({schema:2,enabled:false,minimumPermission:"write",
      disallowedReviewerIds:[11139560],reviewer:null}),
    JSON.stringify({schema:1,enabled:false,minimumPermission:"write",
      disallowedReviewerIds:[11139560,2148448],reviewer:null})
  ]) assert.throws(()=>auditReviewerPolicy(bad),/reviewer/);

  await assert.rejects(run({reviewer:JSON.stringify({
    schema:2,enabled:true,minimumPermission:"write",
    disallowedReviewerIds:[11139560,2148448],
    reviewer:{login:"independent",id:300000001}
  })}),/reviewer must remain disabled during bootstrap/);
});

test("CODEOWNERS must protect the reviewer policy in terminal order",()=>{
  assert.doesNotThrow(()=>auditCodeowners(codeowners,repo));
  assert.throws(()=>auditCodeowners(codeowners.replace(
    "/.github/private-ci-independent-reviewer.json @ORESoftware\n",""),repo),
    /final block/);
});

test("source repository identity is pinned before branch policy reads",async()=>{
  for(const change of [
    {id:99999999},
    {full_name:"ores-truffle-oreslang/replaced-repo"},
    {private:false,visibility:"public"},
    {private:true,visibility:"public"},
    {archived:true},
    {disabled:true},
    {id:"1410897874"}
  ]){
    const calls=[];
    const expected={
      id:1410897874,full_name:repo,private:true,visibility:"private",
      archived:false,disabled:false
    };
    await assert.rejects(run({identity:{...expected,...change}},calls),
      /immutable source identity, privacy or active state mismatch/);
    assert.equal(calls.length,1, "untrusted slug must not reach branch policy reads");
  }
});

test("source privacy or numeric ID drift during audit must fail closed",async()=>{
  for(const change of [
    {private:false,visibility:"public"},
    {id:99999999},
    {archived:true}
  ]){
    const calls=[];
    await assert.rejects(run({identity:(read,expected)=>
      read===1?expected:{...expected,...change}},calls),
      /immutable source identity, privacy or active state mismatch/);
    assert.equal(calls[0].url,"https://api.github.com/repos/"+repo);
    assert.equal(calls.at(-1).url,"https://api.github.com/repos/"+repo);
  }
});

test("bootstrap requires the independently reviewed exact workflow Git blob",async()=>{
  // Same check name and same Actions app are insufficient: a passing job can
  // be fabricated by changing the YAML of the checked workflow.
  for(const altered of [
    "name: Private CI export policy\njobs:\n  private-ci-policy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo pass\n",
    workflow.replace("private CI export policy: PASS","private CI export policy: BYPASS"),
    workflow+"\n# unreviewed modification\n"
  ]){
    const calls=[];
    await assert.rejects(run({workflow:altered},calls),
      /policy workflow differs from independently reviewed immutable Git blob/);
    assert.ok(calls.some(item=>item.url.includes("/contents/.github/workflows/private-ci-policy.yml?ref=")));
  }
});

test("cross-backend workflow substitution cannot impersonate the reviewed issuer",async()=>{
  await assert.rejects(run({workflow:javaWorkflow}),
    /policy workflow differs from independently reviewed immutable Git blob/);
  await assert.rejects(auditRepository(JAVA_REPO,{
    token:"test-token",fetchImpl:fixture({
      codeowners:javaCodeowners,checks:javaChecks,workflow
    },[],JAVA_REPO)
  }),/policy workflow differs from independently reviewed immutable Git blob/);
});

test("Java source bootstrap also pins its distinct reviewed workflow",async()=>{
  const good=()=>auditRepository(JAVA_REPO,{
    token:"test-token",
    fetchImpl:fixture({codeowners:javaCodeowners,checks:javaChecks},[],JAVA_REPO)
  });
  assert.equal((await good()).status,"BOOTSTRAP_PROTECTED");
  await assert.rejects(auditRepository(JAVA_REPO,{
    token:"test-token",
    fetchImpl:fixture({codeowners:javaCodeowners,checks:javaChecks,
      workflow:javaWorkflow.replace("private CI issuer + source policy: PASS",
                                  "private CI issuer + source policy: UNSAFE")},[],JAVA_REPO)
  }),/policy workflow differs from independently reviewed immutable Git blob/);
});

test("unprotected main fails before protection or policy files are read",async()=>{
  const calls=[];
  await assert.rejects(run({branch:{name:"main",protected:false,commit:{sha:SHA}}},calls),/main is not protected/);
  assert.equal(calls.length,2); // identity first, then main branch; no policy read
});

test("review, admin enforcement and bypass requirements fail closed",()=>{
  for(const bad of [
    {...protection(),enforce_admins:{enabled:false}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,require_code_owner_reviews:false}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,dismiss_stale_reviews:false}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,required_approving_review_count:0}},
    {...protection(),required_pull_request_reviews:{...protection().required_pull_request_reviews,bypass_pull_request_allowances:{users:[{login:"owner"}],teams:[],apps:[]}}}
  ]) assert.throws(()=>auditProtection(bad),/protection mismatch/);
});

test("force pushes and branch deletion exceptions must fail closed",()=>{
  for(const setting of ["allow_force_pushes","allow_deletions"]){
    for(const invalid of [undefined,null,{}, {enabled:true},{enabled:"false"}]){
      assert.throws(()=>auditProtection({...protection(),[setting]:invalid}),
        /review\/admin\/no-bypass protection mismatch/);
    }
  }
});

test("required check must be strict and bound to GitHub Actions app 15368",()=>{
  const base=protection();
  assert.doesNotThrow(()=>auditRequiredChecks(checks,base));
  assert.throws(()=>auditRequiredChecks(checks,{...base,required_status_checks:{strict:true,contexts:[],checks:[{context:"private-ci-policy",app_id:999}]}}),/check\/app binding/);
  assert.throws(()=>auditRequiredChecks(checks,{...base,required_status_checks:{strict:false,contexts:[],checks:[{context:"private-ci-policy",app_id:15368}]}}),/strict app-bound/);
  assert.throws(()=>auditRequiredChecks(JSON.stringify({schema:1,checks:[{context:"other",appId:15368}]}),base),/identity mismatch/);
});

test("final CODEOWNERS block cannot be shadowed by a later wildcard",()=>{
  assert.doesNotThrow(()=>auditCodeowners(codeowners));
  assert.throws(()=>auditCodeowners(codeowners+"* @someone-else\n"),/final block mismatch/);
  assert.throws(()=>auditCodeowners(codeowners.replace(owner,"@someone-else")),
    /final block mismatch|workflow directory CODEOWNERS wildcard missing/);
});

test("all source repos deny unreviewed same-name workflow spoofing",()=>{
  assert.doesNotThrow(()=>auditCodeowners(codeowners,repo));
  assert.doesNotThrow(()=>auditCodeowners(javaCodeowners,JAVA_REPO));
  const wildcard="/.github/workflows/ @ORESoftware\n";
  for(const wrong of ["", "/.github/workflows/ @Unreviewed\n"]){
    const mutated=codeowners.replace(wildcard,wrong);
    assert.throws(()=>auditCodeowners(mutated,repo),
      /security CODEOWNERS final block missing|workflow directory CODEOWNERS wildcard missing or shadowed/);
  }
  assert.throws(()=>auditCodeowners(codeowners+"* @Unreviewed\n",repo),
    /security CODEOWNERS final block mismatch/);
});

test("bootstrap refuses destination or source snapshot authorization",async()=>{
  await assert.rejects(run({destinations:"private-org/carrier 1234\n"}),/destination approval must remain empty/);
  await assert.rejects(run({snapshots:"b".repeat(40)+" "+"c".repeat(40)+" 1234\n"}),/snapshot approval must remain empty/);
});

test("protected-main drift during audit is rejected",async()=>{
  await assert.rejects(run({branch:n=>({name:"main",protected:true,commit:{sha:n===1?SHA:"b".repeat(40)}})}),/changed during audit/);
});

test("missing protection metadata and transport failures deny without leaking token",async()=>{
  await assert.rejects(run({protection:{status:403,data:{message:"forbidden"}}}),/metadata unavailable/);
  await assert.rejects(auditRepository(repo,{token:"test-token",fetchImpl:async()=>{throw Error("Bearer test-token");}}),err=>{
    assert.equal(err.message.includes("test-token"),false);
    assert.match(err.message,/policy lookup failed/);
    return true;
  });
});

test("missing credentials fail before any network request",async()=>{
  let calls=0;
  await assert.rejects(auditRepository(repo,{token:"",fetchImpl:async()=>{calls++;}}),/token required/);
  assert.equal(calls,0);
});

test("Java preserves extended terminal ownership plus wildcard and source/carrier issuer pins",async()=>{
  assert.doesNotThrow(()=>auditCodeowners(javaCodeowners,JAVA_REPO));
  assert.doesNotThrow(()=>auditRequiredChecks(javaChecks,protection(),JAVA_REPO));
  assert.throws(()=>auditCodeowners(javaCodeowners.replace(
    "/.github/workflows/ @ORESoftware",""),JAVA_REPO),/final block missing/);
  assert.throws(()=>auditCodeowners(javaCodeowners.replace(
    "/.github/workflows/ @ORESoftware",
    "/.github/workflows/ @Unreviewed"),JAVA_REPO),/wildcard missing/);
  assert.throws(()=>auditCodeowners(javaCodeowners.replace(
    "/scripts/publish-private-ci-source.py @ORESoftware",
    "/scripts/publish-private-ci-source.py @Unreviewed"),JAVA_REPO),/final block mismatch/);
  assert.throws(()=>auditRequiredChecks(JSON.stringify({
    schema:1,source:{context:"private-ci-policy",appId:15368},
    carrier:{context:"carrier-policy",appId:15369}
  }),protection(),JAVA_REPO),/issuer policy identity mismatch/);
  assert.throws(()=>auditRequiredChecks(checks,protection(),JAVA_REPO),/issuer policy identity mismatch/);
  await assert.rejects(auditRepository(JAVA_REPO,{
    token:"test-token",
    fetchImpl:fixture({codeowners:codeowners,checks:javaChecks},[],JAVA_REPO)
  }),/final block missing/);
  const result=await auditRepository(JAVA_REPO,{
    token:"test-token",
    fetchImpl:fixture({codeowners:javaCodeowners,checks:javaChecks},[],JAVA_REPO)
  });
  assert.equal(result.repo,JAVA_REPO);
  assert.equal(result.status,"BOOTSTRAP_PROTECTED");
});

test("Java CODEOWNERS requires dispatcher code and regression test in exact terminal order",()=>{
  assert.doesNotThrow(()=>auditCodeowners(javaCodeowners,JAVA_REPO));
  for(const path of [
    "/scripts/dispatch-review-pinned-private-ci.py",
    "/tests/test_review_pinned_dispatcher.py"
  ]){
    const entry=path+" @ORESoftware\n";
    assert.ok(javaCodeowners.includes(entry));
    assert.throws(()=>auditCodeowners(javaCodeowners.replace(entry,""),JAVA_REPO),
      /security CODEOWNERS final block mismatch|security CODEOWNERS final block missing/);
    assert.throws(()=>auditCodeowners(javaCodeowners.replace(
      entry,path+" @Unreviewed\n"),JAVA_REPO),
      /security CODEOWNERS final block mismatch/);
  }
  const lines=javaCodeowners.split("\n");
  const a=lines.indexOf("/scripts/dispatch-review-pinned-private-ci.py @ORESoftware");
  const b=lines.indexOf("/tests/test_review_pinned_dispatcher.py @ORESoftware");
  assert.ok(a>0 && b>a);
  [lines[a],lines[b]]=[lines[b],lines[a]];
  assert.throws(()=>auditCodeowners(lines.join("\n"),JAVA_REPO),/final block mismatch/);
});

test("missing or malformed bypass allowance arrays deny bootstrap",()=>{
  const r=protection().required_pull_request_reviews;
  for(const bypass of [
    {},{users:[]},{users:[],teams:[]},
    {users:[],teams:[],apps:null},{users:"",teams:[],apps:[]},
    {users:[],teams:{length:0},apps:[]},
    {users:[],teams:[],apps:""}
  ]) assert.throws(()=>auditProtection({...protection(),
    required_pull_request_reviews:{...r,bypass_pull_request_allowances:bypass}
  }),/protection mismatch/);
});

test("missing, null, or untrusted legacy required contexts deny bootstrap",()=>{
  const p=protection(),{contexts,...rest}=p.required_status_checks;
  for(const checksMetadata of [rest,{...rest,contexts:null},
    {...rest,contexts:""},{...rest,contexts:[],strict:false}
  ]) assert.throws(()=>auditRequiredChecks(checks,
    {...p,required_status_checks:checksMetadata}),/strict app-bound/);
});

test("unlisted repository cannot impersonate a bootstrap source",async()=>{
  let calls=0;
  await assert.rejects(auditRepository("attacker-org/lookalike",{
    token:"test-token",fetchImpl:async()=>{calls++;throw Error("unexpected request");}
  }),/source repository is not allowlisted/);
  assert.equal(calls,0);
});

test("force-push permission enabled mid-audit denies the same protected SHA",async()=>{
  await assert.rejects(run({protection:n=>n===1?protection():{
    ...protection(),allow_force_pushes:{enabled:true}
  }}),/review\/admin\/no-bypass protection mismatch/);
});

test("review or issuer protection revoked without moving main fails closed",async()=>{
  await assert.rejects(run({protection:n=>n===1?protection():{
    ...protection(),enforce_admins:{enabled:false}
  }}),/review\/admin\/no-bypass/);
  await assert.rejects(run({protection:n=>n===1?protection():{
    ...protection(),required_status_checks:{strict:true,contexts:[],
      checks:[{context:"private-ci-policy",app_id:999}]}
  }}),/check\/app binding/);
});


test("bootstrap parser rejects duplicate JSON keys and escaped-equivalent keys",()=>{
  for(const bad of [
    '{"schema":1,"schema":2,"checks":[{"context":"private-ci-policy","appId":15368}]}',
    '{"schema":1,"\\u0073chema":2,"checks":[{"context":"private-ci-policy","appId":15368}]}',
    '{"schema":1,"checks":[{"context":"private-ci-policy","context":"other","appId":15368}]}'
  ]) assert.throws(()=>auditRequiredChecks(bad,protection(),repo),/duplicate object key|ambiguous or invalid/);

  const duplicateReviewer='{"schema":2,"enabled":false,"enabled":true,"minimumPermission":"write","disallowedReviewerIds":[11139560,2148448],"reviewer":null}';
  assert.throws(()=>auditReviewerPolicy(duplicateReviewer),/duplicate object key|ambiguous or invalid/);
});

test("bootstrap parser rejects boolean schema and ambiguous policy lines",()=>{
  assert.throws(()=>auditRequiredChecks(JSON.stringify({schema:true,checks:[{context:"private-ci-policy",appId:15368}]}),protection(),repo),/schema mismatch/);
  assert.throws(()=>auditReviewerPolicy(JSON.stringify({schema:true,enabled:false,minimumPermission:"write",disallowedReviewerIds:[11139560,2148448],reviewer:null})),/schema mismatch/);
  assert.throws(()=>auditCodeowners(" "+codeowners,repo),/ambiguous surrounding whitespace/);
  assert.throws(()=>auditCodeowners(codeowners.replace("/.github/CODEOWNERS @ORESoftware","/.github/CODEOWNERS @ORESoftware "),repo),/ambiguous surrounding whitespace/);
});

test("GitHub policy file decoder rejects BOM and NUL bytes before policy admission",async()=>{
  for(const bad of [String.fromCharCode(0xfeff)+checks, checks+String.fromCharCode(0)]){
    await assert.rejects(run({checks:bad}),/forbidden BOM\/NUL bytes/);
  }
});
