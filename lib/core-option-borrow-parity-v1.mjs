// Source-only borrow parity goals. No guest, compiler, AOT, sanitizer or
// UNSUPPORTED status is authenticated by this user-editable registry.
import {lstatSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadCoreOptionDashboard} from './core-option-parity-dashboard-v1.mjs';

const SPEC = Object.freeze([
  ['borrowed_option_some_query','accept','compiled_guest'],
  ['borrowed_option_none_query','accept','compiled_guest'],
  ['borrowed_result_ok_query','accept','compiled_guest'],
  ['borrowed_result_err_query','accept','compiled_guest'],
  ['owner_survives_loan','accept','compiled_guest'],
  ['borrowed_affine_flatten','reject','compiler_negative'],
  ['borrowed_affine_option_unwrap','reject','compiler_negative'],
  ['borrowed_affine_result_unwrap','reject','compiler_negative'],
  ['borrowed_affine_safe_repackage','reject','compiler_negative'],
  ['borrowed_affine_fallback','reject','compiler_negative'],
  ['copyable_nested_borrow','accept','compiled_guest'],
  ['loan_then_move','reject','compiler_negative'],
  ['borrowed_escape','reject','compiler_negative'],
  ['inactive_variant_drop_once','accept','compiled_guest'],
  ['callback_exactly_once','accept','compiled_guest'],
  ['suspend_with_live_loan','reject','compiler_negative']
]);
export const REQUIRED_BORROW_CASE_IDS=Object.freeze(SPEC.map(x=>x[0]));
const deny=(why)=>{throw Error('CORE_OPTION_BORROW_PARITY_DENIED: '+why);};
const isObj=x=>x && typeof x==='object' && !Array.isArray(x);
function exact(o, keys, name) {
  if(!isObj(o) || JSON.stringify(Object.keys(o).sort()) !==
      JSON.stringify([...keys].sort()))deny('invalid keys: '+name);
}
function safeDescription(s,name) {
  if(typeof s !== 'string' || s.length < 12 || s.length > 800 ||
      /[\u0000-\u001f<>]/u.test(s))deny('invalid text: '+name);
}
export function validateCoreOptionBorrowParity(data,dashboard=loadCoreOptionDashboard()) {
  exact(data,['schema','snapshot_date','registry_dependency','normative_reference',
    'scope','evidence_policy','release_qualified','notes','cases','backends'],'registry');
  if(data.schema!=='atto.core-option-borrow-parity.v1' ||
    data.snapshot_date!=='2026-11-22' ||
    data.registry_dependency!=='contracts/eleven-backend-parity-v1/core-option-dashboard.json' ||
    data.normative_reference!=='https://github.com/atto-lang/atto-spec/blob/main/language/ownership-vocabulary-v1.md' ||
    data.scope!=='core/option+core/result' ||
    data.evidence_policy!=='SOURCE_ONLY_NON_PROMOTING' ||
    data.release_qualified!==false)deny('self-promoting or noncanonical policy');
  safeDescription(data.notes,'notes');
  if(!Array.isArray(data.cases) || data.cases.length!==SPEC.length)
    deny('missing/extra borrow cases');
  for(let i=0;i<SPEC.length;i++){
    const c=data.cases[i], [id,expected,kind]=SPEC[i];
    exact(c,['id','expected','kind','requirement','diagnostic_class'],'case');
    if(c.id!==id||c.expected!==expected||c.kind!==kind||
       c.diagnostic_class!==(expected==='reject'?'borrow-or-ownership':null))
      deny('case order, category or error class changed: '+id);
    safeDescription(c.requirement,id);
  }
  if(!Array.isArray(data.backends) || data.backends.length!==11)deny('missing backend');
  const baseline=new Map(dashboard.backends.map(b=>[b.id,b]));
  const seen=new Set();
  for(const b of data.backends){
    exact(b,['id','repository','observed_main_sha','candidate_head_sha',
      'capability_state','cases'],'backend');
    const ref=baseline.get(b.id);
    if(!ref||seen.has(b.id))deny('duplicate/unknown backend identity');
    seen.add(b.id);
    if(b.repository!==ref.repository||b.observed_main_sha!==ref.observed_main_sha||
      b.candidate_head_sha!==(ref.candidate?.head_sha??null) ||
      b.capability_state!=='unverified')deny('backend SHA or capability spoof: '+b.id);
    exact(b.cases,REQUIRED_BORROW_CASE_IDS,'borrow coverage '+b.id);
    for(const id of REQUIRED_BORROW_CASE_IDS){
      const cell=b.cases[id];
      exact(cell,['state','receipt'],'borrow case cell');
      if(cell.state!=='not_executed' || cell.receipt!==null)
        deny('fabricated compiler/guest/unsupported pass: '+b.id+':'+id);
    }
  }
  if(seen.size!==11)deny('incomplete backend coverage');
  return {backends:11,cases:16,cells:176,guest_passes:0};
}
export function loadCoreOptionBorrowParity(path=fileURLToPath(
  new URL('../contracts/eleven-backend-parity-v1/core-option-borrow-v1.json',import.meta.url))) {
  const st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink())deny('symlink or nonfile registry');
  const raw=readFileSync(path,'utf8');
  const data=JSON.parse(raw);
  if(raw!==JSON.stringify(data,null,2)+'\n')deny('noncanonical JSON or duplicated keys');
  validateCoreOptionBorrowParity(data);
  return data;
}
