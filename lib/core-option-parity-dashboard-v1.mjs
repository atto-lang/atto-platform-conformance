// Core/Option: source inventory and evidence admission only. This module
// NEVER authenticates a compiler, guest, AOT, sanitizer or unsupported receipt.
import {readFileSync, lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {REQUIRED_BACKENDS} from './eleven-backend-parity-v1.mjs';

export const CORE_OPTION_GATES = Object.freeze([
  'parse_typecheck','linked_positive_guest','negative_guest',
  'jit_execution','native_aot','sanitizers_or_memory_safety'
]);
export const CORE_OPTION_PR_NUMBERS = Object.freeze({
  java:1767,llvm:870,rs:533,net:217,wasm:279,forge:226,
  cranelift:90,js:132,hdl:61,atto:null,realtime:null
});
// Values recorded from GitHub on 2026-11-22. Updating a candidate/observed
// SHA requires reviewing both the ledger and this independent pin table.
export const PINNED_OPTION_HEADS = Object.freeze({
  java:['189c73b88502c451e50494f738ae11a1de8c9211','919d1d1fc59712e5e2059c72fe7a55cf5720df60'],
  llvm:['553154ac83c060f9182edf751ee6ba6aa192dd3b','216c4222414d34f43ed2a6dbd4e6c640f25dae20'],
  rs:['877bd9f8d61c598137c8627f73fa5ed2a497d9e8','9e4af78f2115f9ea260394929c125c930fab94fc'],
  net:['75830ed371ec386d2c7ebe162410258d3e9fdbf2','496dddbb595ea5e61489eab8c2b4eac8c86a2d19'],
  wasm:['16ba74ab9f9959cc15d21dcb6e54a18e1c325fef','85de1a3032c78ce1dea080d7c28953c692b610d3'],
  forge:['f5dd299c277376cabe9e536edbbb4e662a267ad4','b3d79e3191fd32f155d57c1a272af6b13b7f9172'],
  cranelift:['e867c0a5cf8b94f98ce9b1212d2c735b76bc4120','f24d89ecf2a0384a51b1c6a5dec955ecdfab1727'],
  js:['b8e48b19c33b61e5faa4628bf03bddf2823f403d','2bd0febcb4b94bc57f426a7d551af0bd72e860cd'],
  hdl:['023455e496bb9cfbdd157ccc94bb69f31eec44ea','a69b9c62424e560ac15b682c96309be78f124fad'],
  atto:['5b9a274490a4567ed9d1088fd1ff304dbe383357',null],
  realtime:['4f6449470ab075cdad17884c7a1aee2a6e2ab54c',null]
});
const SHA = /^[0-9a-f]{40}$/;
const reject = why => {throw Error('CORE_OPTION_DASHBOARD_DENIED: ' + why);};
function exactKeys(o, keys, location) {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      JSON.stringify(Object.keys(o).sort()) !== JSON.stringify([...keys].sort()))
    reject('unexpected keys: ' + location);
}
function goodSha(value, description) {
  if (typeof value !== 'string' || !SHA.test(value)) reject('invalid SHA: ' + description);
}
function safeDescription(text, label) {
  if (typeof text !== 'string' || text.length < 8 || text.length > 450 ||
      /[\r\n|<>\x00-\x1f]/.test(text)) reject('unsafe description: ' + label);
}
function noReceipt(gate, location) {
  exactKeys(gate, ['state','receipt'], location);
  if (gate.state !== 'not_executed' || gate.receipt !== null)
    reject('self-attested guest PASS/UNSUPPORTED or forged receipt: ' + location);
}
const expectedJavaBlobs = Object.freeze({
  'core/option.atto':'4400fae94588587fbb85474256e82cac6c26256c',
  'core/result.atto':'6bae249740af1088e069c3592ff8fb2bc72f1216',
  'tests/core_option_result/scalar_roundtrip.atto':'9d91f9945ad1010b35ecae1f112d405fb8b815d3',
  'tests/core_option_result/lazy_callbacks.atto':'dce245f73a77fc1717c1fe087bbb3fd273c0c08e',
  'tests/core_option_result/borrowed_queries.atto':'35f77b9020812364d1d0885e35f53a071cb50134',
  'src/test/java/dev/oreslang/CoreOptionResultSourceTest.java':'ef08bcc9f3165a04a8e57a59525769ad66e7116f',
  'src/test/java/dev/oreslang/CoreOptionResultBorrowSafetyTest.java':'d44dfe085ed6728e5f5b50be889a1c56bf78bc39'
});
const expectedJavaTests = Object.freeze({
  source_parse_typecheck:['libraryModulesMustParseAndTypecheck','compiler_admission',null,null],
  namespace_import_boundaries:['coreNamespaceIsSourceIdentityNotImplicitImportAuthority','negative_admission',null,null],
  nested_sum_roundtrip:['linkedGuestMustExecuteNestedSumRoundtrip','compiled_positive_guest','tests/core_option_result/scalar_roundtrip.atto','42'],
  lazy_callback_ownership:['sourceLinkedCallbacksMustSkipInactiveVariants','compiled_positive_guest','tests/core_option_result/lazy_callbacks.atto','M42:Etrue:true:true'],
  nominal_tags_negative:['resultAndOptionMustRemainNominalDisjointVariants','compiler_reject',null,null],
  no_double_unwrap:['nestedOptionMustNotImplicitlyUnwrapTwice','compiler_reject',null,null],
  read_only_borrow_queries:['readOnlyQueriesPreserveBorrowerAndCarrier','borrow_positive',null,null],
  borrowed_flatten_denied:['borrowedNestedOptionCannotFlattenIntoAnOwner','borrow_negative',null,null],
  borrowed_option_extract_denied:['borrowedOptionCannotExtractOwnedAffineValue','borrow_negative',null,null],
  borrowed_result_extract_denied:['borrowedResultCannotExtractOwnedAffineValue','borrow_negative',null,null],
  borrowed_repackaging_denied:['borrowedOptionCannotRepackageAffineOwnedValue','borrow_negative',null,null],
  borrowed_fallback_escape_denied:['borrowedOptionCannotEscapeThroughEagerFallback','borrow_negative',null,null],
  borrowed_copyable_nested_read:['copyableNestedOptionCanStillReadWithoutStealingOwnership','borrow_positive',null,null],
  linked_borrowed_core_queries:['linkedBorrowedCoreQueriesMustNotConsumeOwner','compiled_positive_guest','tests/core_option_result/borrowed_queries.atto','42']
});
export function validateCoreOptionDashboard(data) {
  exactKeys(data,['schema','snapshot_date','scope','authority','evidence_policy',
    'release_qualified','notes','backends','java_reference'],'registry');
  if(data.schema !== 'atto.core-option-11-backend-dashboard.v1' ||
    data.snapshot_date !== '2026-11-22' || data.scope !== 'core/option' ||
    data.authority !== 'atto-lang/atto-platform-conformance' ||
    data.evidence_policy !== 'SOURCE_ONLY_NO_GUEST_PROMOTION' ||
    data.release_qualified !== false) reject('invalid registry authority/release boundary');
  safeDescription(data.notes, 'notes');
  if (!Array.isArray(data.backends) || data.backends.length !== 11)
    reject('missing or extra compiler');
  const seen = new Set();
  for (const b of data.backends) {
    exactKeys(b,['id','repository','repository_id','observed_main_sha','profile',
      'candidate','source_state','checks','capability_assessment','release_qualified'],'backend');
    if(!Object.hasOwn(REQUIRED_BACKENDS,b.id) || seen.has(b.id)) reject('missing/duplicate/unknown backend');
    seen.add(b.id);
    if (b.repository !== 'atto-lang/atto-source.' + b.id ||
      b.repository_id !== REQUIRED_BACKENDS[b.id]) reject('repository identity spoof');
    goodSha(b.observed_main_sha, b.id + ' main');
    if(b.observed_main_sha !== PINNED_OPTION_HEADS[b.id][0])
      reject('main snapshot SHA substitution: '+b.id);
    safeDescription(b.profile + ' compiler profile', b.id + ' profile');
    if(b.release_qualified !== false) reject('self-promoted backend release');
    const num=CORE_OPTION_PR_NUMBERS[b.id];
    if (num === null) {
      if(b.candidate !== null || b.source_state !== 'not_identified')
        reject('fabricated implementation candidate');
    } else {
      exactKeys(b.candidate,['pr_url','head_sha'],'candidate ' + b.id);
      if(b.candidate.pr_url !== 'https://github.com/atto-lang/atto-source.' +
            b.id + '/pull/' + num || b.source_state !== 'candidate')
        reject('cross-repository or mismatched candidate PR');
      goodSha(b.candidate.head_sha,b.id + ' PR head');
      if(b.candidate.head_sha !== PINNED_OPTION_HEADS[b.id][1])
        reject('candidate SHA substitution: '+b.id);
    }
    exactKeys(b.checks,CORE_OPTION_GATES,b.id + ' gates');
    for (const gate of CORE_OPTION_GATES) noReceipt(b.checks[gate],b.id + ':' + gate);
    if(!Array.isArray(b.capability_assessment) || b.capability_assessment.length !== 1)
      reject('missing capability gap assessment');
    for(const gap of b.capability_assessment) {
      exactKeys(gap,['capability','state','reason','evidence'],'capability');
      if(gap.capability !== 'core/option general-purpose admission' ||
        gap.state !== 'unverified' || gap.evidence !== null)
        reject('unsupported capability claimed without independent proof');
      safeDescription(gap.reason,b.id + ' capability gap');
    }
  }
  if(seen.size !== Object.keys(REQUIRED_BACKENDS).length) reject('incomplete backend identities');
  const java = data.java_reference;
  exactKeys(java,['repository','pr_url','head_sha','root_tree_sha',
    'module_blobs','test_blobs','authored_junit_tests','required_commands'],'Java test reference');
  if(java.repository !== 'atto-lang/atto-source.java' ||
    java.pr_url !== 'https://github.com/atto-lang/atto-source.java/pull/1767' ||
    java.head_sha !== '919d1d1fc59712e5e2059c72fe7a55cf5720df60' ||
    java.root_tree_sha !== '58d26bb865a1211fae18395ab87587f6a4433b68' ||
    java.head_sha !== data.backends.find(b=>b.id==='java').candidate.head_sha)
    reject('Java exact source head/root tree mismatch');
  if (!Array.isArray(java.module_blobs) || java.module_blobs.length !== 2 ||
      !Array.isArray(java.test_blobs) || java.test_blobs.length !== 5)
    reject('incomplete Java exact blob inventory');
  const allBlobs=[...java.module_blobs,...java.test_blobs];
  const fileSet=new Set();
  for(const blob of allBlobs) {
    exactKeys(blob,['path','sha'],'blob');
    if(fileSet.has(blob.path) || expectedJavaBlobs[blob.path] !== blob.sha)
      reject('Java blob SHA or path substitution: ' + blob.path);
    fileSet.add(blob.path);
  }
  if(fileSet.size !== Object.keys(expectedJavaBlobs).length)
    reject('missing Java reference file');
  if(!Array.isArray(java.authored_junit_tests) ||
      java.authored_junit_tests.length !== Object.keys(expectedJavaTests).length)
    reject('incomplete Java JUnit targets');
  const seenTests=new Set();
  for(const item of java.authored_junit_tests) {
    exactKeys(item,['id','method','kind','guest_path','expected_stdout','state'],'JUnit target');
    const expected=expectedJavaTests[item.id];
    if(!expected || seenTests.has(item.id) ||
      JSON.stringify([item.method,item.kind,item.guest_path,item.expected_stdout]) !==
          JSON.stringify(expected) || item.state !== 'not_executed')
      reject('Java test identity or fictional guest pass: '+item.id);
    seenTests.add(item.id);
  }
  exactKeys(java.required_commands,['jvm_guest','native_aot','sanitizers'],'commands');
  if(java.required_commands.jvm_guest !== 'mvn -B -Dtest=CoreOptionResultSourceTest,CoreOptionResultBorrowSafetyTest test')
    reject('unreviewed Java invocation');
  safeDescription(java.required_commands.native_aot,'AOT gate');
  safeDescription(java.required_commands.sanitizers,'memory safety gate');
  return {backends:11,candidates:9,unidentified:2,guest_passes:0,
    test_targets:java.authored_junit_tests.length,
    unexecuted_gates:11*CORE_OPTION_GATES.length};
}
export function loadCoreOptionDashboard(path=fileURLToPath(
  new URL('../contracts/eleven-backend-parity-v1/core-option-dashboard.json',import.meta.url))) {
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()) reject('symlink/foreign registry');
  const raw=readFileSync(path,'utf8');
  const data=JSON.parse(raw);
  if(raw !== JSON.stringify(data,null,2)+'\n') reject('noncanonical JSON/possible duplicate key');
  validateCoreOptionDashboard(data);
  return data;
}
export function renderCoreOptionDashboard(data) {
  validateCoreOptionDashboard(data);
  const lines=[
    '# Core/Option — 11-backend conformance parity dashboard',
    '',
    '**Snapshot:** '+data.snapshot_date+' · **Scope:** source inventory / authored guest tests only · **Verified guest passes: 0**',
    '',
    'This is not live CI and does not certify compiled Atto guests. An observed main SHA is distinct from the PR candidate head. Source-only and zero-step workflow results cannot promote a gate.',
    '',
    '| Backend | Observed main SHA | Option candidate head | Parse/typecheck | Positive guest | Negative guest | JIT | AOT | Sanitizers / memory safety |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  for(const b of data.backends) {
    const link=b.candidate?'[PR]('+b.candidate.pr_url+') `'+b.candidate.head_sha+'`':'No candidate identified';
    lines.push('| `'+b.id+'` | `'+b.observed_main_sha+'` | '+link+
      ' | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |');
  }
  lines.push('','## Java core/option source and tests','',
    '- Candidate: [atto-source.java #1767]('+data.java_reference.pr_url+') at `'+data.java_reference.head_sha+'`',
    '- Root Git tree: `'+data.java_reference.root_tree_sha+'`',
    '- JUnit command (proposed, **not executed**): `'+data.java_reference.required_commands.jvm_guest+'`',
    '- AOT: '+data.java_reference.required_commands.native_aot,
    '- Sanitizers/memory safety: '+data.java_reference.required_commands.sanitizers,
    '',
    '| Authored Java test | Kind | Expected stdout | Status |',
    '| --- | --- | --- | --- |');
  for(const t of data.java_reference.authored_junit_tests)
    lines.push('| `'+t.method+'` | '+t.kind+' | '+(t.expected_stdout===null?'—':'`'+t.expected_stdout+'`')+' | NOT_EXECUTED |');
  lines.push('','## Exact Java file blobs','');
  for(const b of [...data.java_reference.module_blobs,...data.java_reference.test_blobs])
    lines.push('- `'+b.path+'` · `'+b.sha+'`');
  lines.push('','## Capability limitations (NOT verified as supported or unsupported)','');
  for(const b of data.backends)
    lines.push('- **'+b.id+':** '+b.capability_assessment[0].reason+' (UNVERIFIED)');
  lines.push('','## Evidence admission and no-fake-PASS gate','',
    '- All six execution checks for every backend remain `not_executed` with a null receipt. Unsupported capability claims also remain unverified.',
    '- A real guest result requires independently authenticated repository ID, exact compiler head and root tree, exact fixture blob, job/run/attempt and executed compiler + guest steps with observed outputs and failure diagnostics.',
    '- Native AOT and ASan/UBSan or equivalent memory-safety evidence must be independent, profile-specific checks; they cannot be inferred from source-only or JIT execution.',
    '- The source-only v1 validator rejects all claimed PASS, UNSUPPORTED or attached self-authored receipts. A separately reviewed authenticated evidence importer is required before promoting any result.',
    '',
    '_Generated deterministically by `lib/core-option-parity-dashboard-v1.mjs`; do not edit the table by hand._',
    '');
  return lines.join('\n');
}
