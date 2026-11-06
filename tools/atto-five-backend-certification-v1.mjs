// Offline AttoLang certification reporter. This is NEVER release authorization.
import {auditLedger} from './landed-main-evidence.mjs';
const IDS=['java','llvm','wasm','forge','net'];
const TARGETS={
 java:['graalvm-native-image-full-aot','graalvm-zero-gc-target; jvm-min-gc-target'],
 llvm:['llvm-native-full-aot','zero-gc-target'],
 wasm:['wasm-target-profile','no-gc-guarantee-verified'],
 forge:['forge-aot-target','no-gc-guarantee-verified'],
 net:['dotnet-nativeaot-target','no-gc-guarantee-verified']
};
const SHA=/^[a-f0-9]{40}$/;const HASH=/^[a-f0-9]{64}$/;const CONTRACT=/^[a-z][a-z0-9-]{1,79}$/;
const ST=new Set(['NOT_EXECUTED','UNSUPPORTED','FAILED','REPORTED_PASS']);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const sha=x=>typeof x==='string'&&SHA.test(x);
const hash=x=>typeof x==='string'&&HASH.test(x);
function meaningful(steps){
 return Array.isArray(steps)&&steps.length>0&&steps.length<=128&&
  steps.some(s=>obj(s)&&s.status==='completed'&&s.conclusion==='success'&&
  typeof s.name==='string'&&/^[\x20-\x7e]{1,160}$/.test(s.name)&&
  !/^(set up job|complete job|post |run actions\/(checkout|setup-|cache|upload-artifact))/i.test(s.name));
}
function receiptValid(r,b,binary,kind,contract){
 if(!obj(r)||r.repo!==b.repo||r.source_commit_sha!==b.source.commit_sha||
    r.source_tree_sha!==b.source.tree_sha||r.compiler_binary_sha256!==binary||
    r.kind!==kind||(contract&&r.contract_id!==contract.id)||
    !pos(r.run_id)||!pos(r.run_attempt)||!pos(r.job_id)||!pos(r.runner_id)||
    r.status!=='completed'||r.conclusion!=='success'||!meaningful(r.steps)||
    !hash(r.artifact_sha256))return false;
 if(kind==='guest')return obj(contract)&&contract.oracle?.type==='single_guest'&&
   r.fixture_blob_sha===contract.oracle.fixture_blob_sha&&
   obj(r.output)&&Number.isSafeInteger(r.output.exit_code)&&
   r.output.exit_code>=0&&r.output.exit_code<=255&&typeof r.output.stdout_hex==='string'&&
   r.output.stdout_hex.length<=131072&&/^(?:[a-f0-9]{2})*$/.test(r.output.stdout_hex)&&
   r.output.crashed===false&&r.output.exit_code===contract.oracle.expected_exit_code&&
   r.output.stdout_hex===contract.oracle.expected_stdout_hex;
 if(kind==='negative')return obj(contract)&&sha(contract.fixture_blob_sha)&&
   r.fixture_blob_sha===contract.fixture_blob_sha&&obj(r.output)&&
   Number.isSafeInteger(r.output.exit_code)&&r.output.exit_code>0&&r.output.exit_code<=255&&
   r.output.diagnostic_category===contract.expected_diagnostic&&
   r.output.phase===contract.expected_phase&&r.output.crashed===false;
 if(kind==='formal')return hash(r.model_sha256)&&pos(r.properties_checked)&&r.counterexamples===0;
 if(kind==='aot')return hash(r.executable_sha256)&&r.fully_aot===true&&r.jit_disabled===true;
 if(kind==='memory')return obj(r.metrics)&&pos(r.metrics.samples)&&
   Number.isSafeInteger(r.metrics.gc_collections)&&r.metrics.gc_collections>=0;
 return false;
}
function status(e,kind,b,binary,contract){
 if(!obj(e)||!ST.has(e.state))throw new TypeError('invalid '+kind+' state');
 if(e.state!=='REPORTED_PASS'){
   if(e.receipt!==null)throw new TypeError('receipt on nonpassing or unexecuted '+kind);
   return e.state;
 }
 if(!hash(binary)||!receiptValid(e.receipt,b,binary,kind,contract))
   throw new TypeError('unbound '+kind+' receipt');
 // Untrusted self-reported passing data is NEVER authenticated execution.
 return 'REPORTED_PASS_UNVERIFIED';
}
export function validateCandidate(s){
 if(!obj(s)||s.schema_version!==1||s.scope!=='untrusted_offline_snapshot'||
  typeof s.as_of!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s.as_of)||
  !Number.isFinite(Date.parse(s.as_of))||Date.parse(s.as_of)>Date.now()+300000||
  !obj(s.postmerge_ledger)||s.postmerge_ledger.scope!=='untrusted_snapshot'||
  typeof s.postmerge_ledger.path!=='string'||
  !/^evidence\/[a-z0-9.-]+\.json$/.test(s.postmerge_ledger.path)||
  !sha(s.postmerge_ledger.github_blob_sha)||
  !obj(s.negative_oracle)||!CONTRACT.test(s.negative_oracle.id)||
  !pos(s.negative_oracle.proposal_pr)||!sha(s.negative_oracle.proposal_head)||
  !sha(s.negative_oracle.fixture_blob_sha)||
  !/^[A-Z][A-Z0-9_]{5,127}$/.test(s.negative_oracle.expected_diagnostic)||
  !['frontend','typechecker'].includes(s.negative_oracle.expected_phase)||
  !Array.isArray(s.backends)||s.backends.length!==5||
  !Array.isArray(s.contracts)||s.contracts.length===0||s.contracts.length>64)
  throw new TypeError('invalid release candidate envelope');
 const cids=s.contracts.map(c=>c?.id);
 if(new Set(cids).size!==cids.length||s.contracts.some(c=>
  !obj(c)||!CONTRACT.test(c.id)||!obj(c.proposal)||!pos(c.proposal.pr)||
  !sha(c.proposal.sha)||!obj(c.oracle)||
  !((c.oracle.type==='single_guest'&&sha(c.oracle.fixture_blob_sha)&&
      Number.isSafeInteger(c.oracle.expected_exit_code)&&c.oracle.expected_exit_code>=0&&
      c.oracle.expected_exit_code<=255&&typeof c.oracle.expected_stdout_hex==='string'&&
      /^(?:[a-f0-9]{2})*$/.test(c.oracle.expected_stdout_hex))||
    (c.oracle.type==='suite_pending'&&sha(c.oracle.manifest_blob_sha)&&
      typeof c.oracle.reason==='string'&&c.oracle.reason.length>=8))||
  typeof c.description!=='string'||
  c.description.length<8||c.description.length>400))
  throw new TypeError('invalid contract manifest');
 if(new Set(s.backends.map(b=>b?.id)).size!==5||IDS.some(id=>!s.backends.some(b=>b?.id===id)))
  throw new TypeError('missing or duplicate backend');
 for(const b of s.backends){
  if(!obj(b)||b.repo!=='ores-truffle-oreslang/oreslang-source.'+b.id||
    !obj(b.source)||!sha(b.source.commit_sha)||!sha(b.source.tree_sha)||
    typeof b.source.main_protected!=='boolean'||!obj(b.targets)||
    b.targets.aot_target!==TARGETS[b.id][0]||b.targets.memory_target!==TARGETS[b.id][1]||
    !obj(b.compiler)||!(b.compiler.binary_sha256===null||hash(b.compiler.binary_sha256))||
    !Array.isArray(b.guest)||b.guest.length!==cids.length||
    new Set(b.guest.map(g=>g?.contract_id)).size!==cids.length||
    cids.some(id=>!b.guest.some(g=>g?.contract_id===id))||
    !obj(b.negative)||!obj(b.formal)||!obj(b.aot)||!obj(b.memory))
    throw new TypeError('invalid backend schema');
  if(b.compiler.binary_sha256===null&&b.compiler.build_receipt!==null)
    throw new TypeError('build receipt without binary');
  if(b.compiler.binary_sha256!==null&&!receiptValid(
    b.compiler.build_receipt,b,b.compiler.binary_sha256,'aot',null))
    throw new TypeError('unbound build receipt');
  for(const g of b.guest)status(g,'guest',b,b.compiler.binary_sha256,s.contracts.find(c=>c.id===g.contract_id));
  status(b.negative,'negative',b,b.compiler.binary_sha256,s.negative_oracle);
  for(const kind of ['formal','aot','memory'])status(b[kind],kind,b,b.compiler.binary_sha256,null);
 }
 return true;
}
export function evaluateCandidate(s,landed){
 validateCandidate(s);
 const ledger=auditLedger(landed);
 const holds=[];
 if(ledger.status!=='SNAPSHOT_READY_RECHECK_LIVE')holds.push('POSTMERGE_LEDGER_BLOCKED');
 if(s.contracts.some(c=>c.oracle.type==='suite_pending'))holds.push('CONTRACT_SUITE_ORACLES_NOT_NORMALIZED');
 if(Date.now()-Date.parse(s.as_of)>7*86400000)holds.push('STALE_SOURCE_HEAD_SNAPSHOT');
 const rows=s.backends.map(b=>{
  const blockers=[];
  if(!b.source.main_protected)blockers.push('MAIN_UNPROTECTED');
  if(!b.compiler.binary_sha256)blockers.push('COMPILER_BINARY_NOT_VERIFIED');
  const guest=Object.fromEntries(b.guest.map(g=>[g.contract_id,
   status(g,'guest',b,b.compiler.binary_sha256,s.contracts.find(c=>c.id===g.contract_id))]));
  if(Object.values(guest).some(x=>x==='NOT_EXECUTED'))blockers.push('GUEST_NOT_EXECUTED');
  if(Object.values(guest).some(x=>x==='FAILED'||x==='UNSUPPORTED'))blockers.push('GUEST_FAILED_OR_UNSUPPORTED');
  const negative=status(b.negative,'negative',b,b.compiler.binary_sha256,s.negative_oracle);
  if(negative!=='REPORTED_PASS_UNVERIFIED')blockers.push('NEGATIVE_DIAGNOSTIC_NOT_VERIFIED');
  const formal=status(b.formal,'formal',b,b.compiler.binary_sha256,null);
  const aot=status(b.aot,'aot',b,b.compiler.binary_sha256,null);
  const memory=status(b.memory,'memory',b,b.compiler.binary_sha256,null);
  for(const [kind,s] of [['FORMAL',formal],['AOT',aot],['MEMORY',memory]])
   if(s!=='REPORTED_PASS_UNVERIFIED')blockers.push(kind+'_NOT_VERIFIED');
  return{id:b.id,repo:b.repo,source_sha:b.source.commit_sha,tree_sha:b.source.tree_sha,
   main_protected:b.source.main_protected,compiler_binary_sha256:b.compiler.binary_sha256,
   aot_target:b.targets.aot_target,memory_target:b.targets.memory_target,
   guest,negative,formal,aot,memory,blockers};
 });
 if(rows.some(r=>r.blockers.length))holds.push('BACKEND_RELEASE_REQUIREMENTS_INCOMPLETE');
 return{schema_version:1,scope:'advisory_only_not_release_authority',
  status:holds.length?'BLOCKED':'SNAPSHOT_REPORTED_REQUIRES_LIVE_RECHECK',
  release_authorized:false,backend_count:rows.length,contract_count:s.contracts.length,
  contracts:s.contracts.map(c=>({id:c.id,proposal_pr:c.proposal.pr,proposal_head:c.proposal.sha,
   maturity:'PROPOSED_NOT_MERGED',oracle_type:c.oracle.type})),
  postmerge:{status:ledger.status,blocked:ledger.blocked,count:ledger.count},
  holds,backends:rows,
  note:'Offline snapshots NEVER authorize releases. Independently verify exact GitHub commits/trees, compiler binary, fixture bytes, executed guest output, trusted reviewer, protected main, AOT/GC and formal model.'};
}
export function toMarkdown(r){
 if(!obj(r)||r.scope!=='advisory_only_not_release_authority')
  throw new TypeError('not a certification report');
 const out=['# AttoLang five-backend release candidate — NOT CERTIFIED','',
 '**Decision: '+r.status+'**. Advisory only; release_authorized=false.','',
 'Backends: '+r.backend_count+'; proposed contracts: '+r.contract_count+
 '; postmerge blocked: '+r.postmerge.blocked+'/'+r.postmerge.count+'.','',
 '| Backend | Source commit | Protected main | Compiler binary | Negative | Formal | Full AOT | Memory |',
 '|---|---|---|---|---|---|---|---|'];
 for(const b of r.backends)out.push('| '+b.id+' | '+b.source_sha.slice(0,12)+' | '+
  (b.main_protected?'reported yes':'NO')+' | '+
  (b.compiler_binary_sha256?'reported, unverified':'NOT VERIFIED')+' | '+
  b.negative+' | '+b.formal+' | '+b.aot+' | '+b.memory+' |');
 out.push('','## Guest matrix','',
  '| Proposed contract | '+r.backends.map(b=>b.id).join(' | ')+' |',
  '|---|'+r.backends.map(()=>'---|').join(''));
 for(const c of r.contracts)out.push('| '+c.id+' (draft #'+c.proposal_pr+') | '+
   r.backends.map(b=>b.guest[c.id]).join(' | ')+' |');
 out.push('','## Release holds','');
 for(const h of r.holds)out.push('- '+h);
 for(const b of r.backends)if(b.blockers.length)
  out.push('- '+b.id+': '+b.blockers.join(', '));
 out.push('','**Boundary:** '+r.note,'');
 return out.join('\n');
}
