import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEntry, auditLedger} from '../tools/landed-main-evidence.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,linkSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40), D='d'.repeat(40);
const E='e'.repeat(40), F='f'.repeat(40), H='f'.repeat(64), ATTEST='a'.repeat(64);
const REPO='ores-truffle-oreslang/oreslang-source.java';
function good() {
  const runtime={id:'scalar-42',kind:'compiler-guest',fixture_sha:E,
    expect:{exit_code:42,stdout_hex:''}};
  const reject={id:'immutable-rebind',kind:'negative',fixture_sha:F,
    expect:{diagnostic_category:'IMMUTABLE_REBIND',phase:'typechecker'}};
  return {
    repo:REPO,pr:7,author:'contributor',merged:true,base_ref:'main',
    pr_head_sha:A,merge_sha:B,landed_tree_sha:C,requires_guest:true,
    main_observation:{head_sha:B,compare_status:'identical',behind_by:0},
    protection:{protected:true,required_approvals:1,codeowners:true,dismiss_stale:true,
      strict_checks:true,enforce_admins:true,bypass_count:0,
      force_pushes_allowed:false,deletions_allowed:false},
    approvals:[{login:'independent-reviewer',kind:'independent_postmerge_attestation',
      state:'APPROVED',repo:REPO,reviewed_commit_sha:B,reviewed_tree_sha:C,
      attestation_sha256:ATTEST}],
    required_checks:[{context:'native-ci',app_id:15368,workflow_sha:D}],
    required_tests:[runtime,reject],
    source_owned_runs:[{
      scope:'landed-main',repo:REPO,commit_sha:B,tree_sha:C,workflow_sha:D,
      context:'native-ci',app_id:15368,run_id:10,run_attempt:1,job_id:11,
      runner_id:22,status:'completed',conclusion:'success',artifact_sha256:H,
      steps:[{name:'Set up job',conclusion:'success'},
        {name:'Compile and execute native guest',conclusion:'success'}],
      tests:[
        {id:runtime.id,kind:runtime.kind,fixture_sha:E,status:'PASS',
          observed:{exit_code:42,stdout_hex:'',crashed:false}},
        {id:reject.id,kind:reject.kind,fixture_sha:F,status:'PASS',
          observed:{exit_code:1,diagnostic_category:'IMMUTABLE_REBIND',
            phase:'typechecker',crashed:false}}
      ]
    }]
  };
}
const ledger = e => ({schema_version:1,scope:'snapshot_only',
  captured_at:'2026-11-06T19:00:29Z',entries:[e]});
function denies(label,mutate,kind) {
  test(label,()=>{
    const e=good();mutate(e);
    const blockers=auditEntry(e);
    assert(blockers.some(x=>x.kind===kind),JSON.stringify(blockers));
  });
}
test('synthetic complete evidence stays advisory and requires fresh live recheck',()=>{
  const result=auditLedger(ledger(good()));
  assert.equal(result.status,'SNAPSHOT_READY_RECHECK_LIVE');
  assert.equal(result.entries[0].status,'SNAPSHOT_READY_RECHECK_LIVE');
  assert.match(result.note,/re-fetch live/i);
});
denies('reject unmerged PR',e=>e.merged=false,'identity');
denies('reject missing merged status',e=>delete e.merged,'identity');
denies('reject missing guest scope flag',e=>delete e.requires_guest,'identity');
denies('reject stale PR SHA',e=>e.pr_head_sha='bad','identity');
denies('reject missing landed tree SHA',e=>delete e.landed_tree_sha,'identity');
denies('reject wrong base branch',e=>e.base_ref='feature','identity');
denies('reject foreign repository',e=>e.repo='attacker/source.java','identity');
denies('reject missing ancestry',e=>e.main_observation.compare_status='diverged','ancestry');
denies('reject mismatched identical main',e=>e.main_observation.head_sha=A,'ancestry');
denies('reject behind-by nonzero',e=>e.main_observation.behind_by=1,'ancestry');
denies('reject absent protections',e=>e.protection={protected:false},'protection');
denies('reject missing minimum review count',e=>delete e.protection.required_approvals,'protection');
denies('reject admin bypass',e=>e.protection.bypass_count=1,'protection');
denies('reject allowed force pushes',e=>e.protection.force_pushes_allowed=true,'protection');
denies('reject allowed deletion',e=>e.protection.deletions_allowed=true,'protection');
denies('reject disabled codeowners',e=>e.protection.codeowners=false,'protection');
denies('reject stale postmerge review SHA',e=>e.approvals[0].reviewed_commit_sha=A,'review');
denies('reject wrong review tree',e=>e.approvals[0].reviewed_tree_sha=D,'review');
denies('reject foreign review repo',e=>e.approvals[0].repo='attacker/repo','review');
denies('reject unbound review attestation',e=>delete e.approvals[0].attestation_sha256,'review');
denies('reject ordinary PR approval misrepresented as landed attestation',e=>delete e.approvals[0].kind,'review');
denies('reject author self review',e=>e.approvals[0].login='contributor','review');
denies('reject operator-controlled review',e=>e.approvals[0].login='ORESoftware','review');
denies('reject zero-runner job',e=>e.source_owned_runs[0].runner_id=0,'ci');
denies('reject zero-step job',e=>e.source_owned_runs[0].steps=[],'ci');
denies('reject setup-only job',e=>e.source_owned_runs[0].steps=[
  {name:'Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',conclusion:'success'}],'ci');
denies('reject source-head-verification-only job',e=>e.source_owned_runs[0].steps=[
  {name:'Verify exact PR head and clean source tree',conclusion:'success'}],'ci');
denies('reject housekeeping-only with repeated spaces',e=>e.source_owned_runs[0].steps=[
  {name:'Set  up job',conclusion:'success'}],'ci');
denies('reject failed meaningful step',e=>e.source_owned_runs[0].steps=[
  {name:'Execute native fixture',conclusion:'failure'}],'ci');
denies('reject foreign source repo receipt',e=>e.source_owned_runs[0].repo='attacker/repo','ci');
denies('reject stale PR-head run',e=>e.source_owned_runs[0].commit_sha=A,'ci');
denies('reject foreign but valid-looking tree',e=>e.source_owned_runs[0].tree_sha=D,'ci');
denies('reject changed workflow blob',e=>e.source_owned_runs[0].workflow_sha=A,'ci');
denies('reject missing workflow identity',e=>delete e.required_checks[0].workflow_sha,'ci');
denies('reject wrong check app',e=>e.source_owned_runs[0].app_id=44,'ci');
denies('reject missing required check',e=>e.required_checks.push({
  context:'security',app_id:15368,workflow_sha:E}),'ci');
denies('reject duplicated required check',e=>e.required_checks.push({
  ...e.required_checks[0]}),'ci');
denies('reject malformed artifact digest',e=>e.source_owned_runs[0].artifact_sha256='not-a-hash','ci');
denies('reject incomplete run status',e=>e.source_owned_runs[0].status='in_progress','ci');
denies('reject duplicate job receipts',e=>e.source_owned_runs.push(structuredClone(e.source_owned_runs[0])),'ci');
denies('reject absent declared test',e=>e.source_owned_runs[0].tests.pop(),'test');
denies('reject unknown test spoofed as required',e=>e.source_owned_runs[0].tests[1].id='unknown-test','ci');
denies('reject duplicate result identifiers',e=>e.source_owned_runs[0].tests[1].id='scalar-42','ci');
denies('reject duplicate required test IDs',e=>e.required_tests[1].id='scalar-42','test');
denies('reject missing negative case',e=>e.required_tests.pop(),'test');
denies('reject missing positive guest case',e=>e.required_tests[0].kind='host','test');
denies('reject guest receipt relabelled as host',e=>e.source_owned_runs[0].tests[0].kind='host','ci');
denies('reject unexpected fixture SHA',e=>e.source_owned_runs[0].tests[0].fixture_sha=D,'ci');
denies('reject wrong guest return value',e=>e.source_owned_runs[0].tests[0].observed.exit_code=41,'ci');
denies('reject wrong stdout bytes',e=>e.source_owned_runs[0].tests[0].observed.stdout_hex='2a','ci');
denies('reject crashed guest',e=>e.source_owned_runs[0].tests[0].observed.crashed=true,'ci');
denies('reject generic parse error for targeted negative',e=>
  e.source_owned_runs[0].tests[1].observed.diagnostic_category='PARSE_ERROR','ci');
denies('reject wrong diagnostic phase',e=>e.source_owned_runs[0].tests[1].observed.phase='runtime','ci');
denies('reject negative that exits successfully',e=>e.source_owned_runs[0].tests[1].observed.exit_code=0,'ci');
denies('reject negative with crash',e=>e.source_owned_runs[0].tests[1].observed.crashed=true,'ci');
denies('reject unsupported result',e=>e.source_owned_runs[0].tests[1].status='UNSUPPORTED','ci');
denies('reject unexecuted result',e=>e.source_owned_runs[0].tests[0].status='NOT_EXECUTED','ci');
test('host-only scope is explicit and still requires a positive and negative',()=>{
  const e=good();e.requires_guest=false;
  e.required_tests[0].kind='host';e.source_owned_runs[0].tests[0].kind='host';
  assert.equal(auditEntry(e).length,0);
});
test('duplicate PR entries fail closed',()=>{
  const e=good(), l=ledger(e);l.entries.push(structuredClone(e));
  assert.equal(auditLedger(l).blocked,1);
});
test('bad or oversized ledger fails closed',()=>{
  assert.throws(()=>auditLedger({}));
  assert.throws(()=>auditLedger({...ledger(good()),entries:Array(101).fill(good())}));
  assert.throws(()=>auditLedger({...ledger(good()),captured_at:'yesterday'}));
});
test('real merged code with missing external evidence stays BLOCKED',()=>{
  const e=good();e.protection={protected:false};e.approvals=[];e.source_owned_runs=[];
  const result=auditLedger(ledger(e));
  assert.equal(result.status,'BLOCKED');
  assert(result.entries[0].blockers.some(b=>b.kind==='ci'));
  assert(result.entries[0].blockers.some(b=>b.kind==='review'));
});

denies('reject malformed author without crashing',e=>e.author=42,'identity');
denies('reject non-ASCII status check impersonation',e=>{
  e.required_checks[0].context='CI\u00a0/ tests';
  e.source_owned_runs[0].context='CI\u00a0/ tests';
},'ci');
test('authentic spaced GitHub required-check contexts are permitted',()=>{
  const e=good();e.required_checks[0].context='CI / Native Guest';
  e.source_owned_runs[0].context='CI / Native Guest';
  assert.deepEqual(auditEntry(e),[]);
});
const cli = fileURLToPath(new URL('../bin/landed-main-evidence.mjs',import.meta.url));
function withInput(raw, fn) {
  const dir=mkdtempSync(join(tmpdir(),'landed-audit-'));
  try {
    const path=join(dir,'ledger.json');
    writeFileSync(path,raw);
    return fn(path,dir);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
function runCli(path) {
  const r=spawnSync(process.execPath,[cli,path],{encoding:'utf8',timeout:5000});
  assert.equal(r.error,undefined);
  return r;
}
test('CLI returns snapshot-ready only as advisory',()=>{
  withInput(JSON.stringify(ledger(good()),null,2)+'\n',path=>{
    const r=runCli(path);assert.equal(r.status,0,r.stderr);
    assert.equal(JSON.parse(r.stdout).scope,'advisory_not_release_authority');
    assert.match(r.stdout,/SNAPSHOT_READY_RECHECK_LIVE/);
  });
});
test('CLI blocked sample exits one, not zero',()=>{
  const e=good();e.approvals=[];e.protection.protected=false;
  withInput(JSON.stringify(ledger(e),null,2)+'\n',path=>{
    const r=runCli(path);assert.equal(r.status,1,r.stderr);
    assert.equal(JSON.parse(r.stdout).status,'BLOCKED');
  });
});
test('CLI rejects duplicate JSON authority keys',()=>{
  const raw=JSON.stringify(ledger(good()),null,2).replace(
    '"scope": "snapshot_only",','"scope": "other",\n  "scope": "snapshot_only",')+'\n';
  withInput(raw,path=>{const r=runCli(path);
    assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/noncanonical/);
  });
});
test('CLI rejects symlinked ledger without following it',()=>{
  withInput(JSON.stringify(ledger(good()),null,2)+'\n',(path,dir)=>{
    const link=join(dir,'alias.json');symlinkSync(path,link);
    assert.equal(runCli(link).status,2);
  });
});
test('CLI rejects hardlinked ledger',()=>{
  withInput(JSON.stringify(ledger(good()),null,2)+'\n',(path,dir)=>{
    const link=join(dir,'extra.json');linkSync(path,link);
    assert.equal(runCli(path).status,2);
  });
});
test('CLI rejects oversized input before JSON parse',()=>{
  withInput(' '.repeat(262145),path=>assert.equal(runCli(path).status,2));
});
test('CLI rejects noncanonical JSON whitespace and escaping',()=>{
  withInput(JSON.stringify(ledger(good())),path=>assert.equal(runCli(path).status,2));
});
