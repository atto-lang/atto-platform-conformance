import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const m=JSON.parse(await readFile(new URL('../contracts/unary-read-shorthand-v1.json',import.meta.url),'utf8'));
test('unary read contract is explicit and not falsely certified',()=>{
  assert.equal(m.schema,'atto.io.unary-read-shorthand.v1');
  assert.equal(m.status,'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(m.positive_guest_execution,'PENDING_PER_BACKEND');
  assert.ok(m.rust_preflight_evidence.scope.includes('rejected E_UNSUPPORTED'));
  assert.ok(m.evidence_rule.includes('actual compiled guest'));
  const backends=["atto","cranelift","forge","hdl","java","js","llvm","net","realtime","rs","rs-browser","wasm"];
  for(const c of m.cases) {
    assert.deepEqual(Object.keys(c.backend_status).sort(),backends);
    for(const status of Object.values(c.backend_status)) assert.equal(status,'NOT_EXECUTED');
  }
  assert.equal(m.postfix_guest_execution,'PENDING_EXACT_HEAD_TESTS_PER_BACKEND');
});
test('all portable source candidate and negative files are present',async()=>{
  const ids=new Set(),paths=new Set();
  for(const c of m.cases) {
    assert.ok(!ids.has(c.id),'duplicate id: '+c.id);ids.add(c.id);
    assert.ok(!paths.has(c.path),'duplicate file: '+c.path);paths.add(c.path);
    assert.ok(['pass','fail'].includes(c.kind));
    assert.equal(c.stage,c.kind==='pass'?'TYPECHECK_TARGET':'COMPILE_REJECT_TARGET');
    if(c.kind==='fail') assert.match(c.expected_error,/^E_[A-Z_]+$/);
    const full=resolve(root,c.path);assert.ok(full.startsWith(root+sep),'path escape');
    const source=await readFile(full,'utf8');
    assert.ok(source.includes('fnc'),'must declare callable');
    assert.ok(source.includes('<<')||source.includes('>>')||source.includes('new Channel<int>')||c.id==='spaced_operator',
      'must exercise direction operator or its deliberate whitespace-nearmiss');
    assert.ok(source.length>40);
  }
  assert.equal(ids.size,35);
});
test('required effect, unary, type-first and compound variants are represented',async()=>{
  const byId=Object.fromEntries(m.cases.map(c=>[c.id,c]));
  const load=async id=>readFile(resolve(root,byId[id].path),'utf8');
  assert.match(await load('prefix_susp'),/pub susp fnc/);
  assert.match(await load('prefix_paren_suspends'),/pub suspends fnc/);
  assert.match(await load('decl_type_first'),/val Result<Option<int>, IoError> outcome << c/);
  assert.match(await load('decl_name_first'),/val outcome: Result<Option<int>, IoError> << c/);
  assert.match(await load('compound_direct_result'),/total \+= << c;[\s\S]*total \+= \(<< c\);/);
  assert.equal(byId.missing_susp.expected_error,'E_SUSPENDS_REQUIRED');
  assert.equal(byId.checked_compound_mismatch.expected_error,'E_TYPE');
  assert.equal(byId.trap_must_not_remove_susp.expected_error,'E_SUSPENDS_REQUIRED');
});

test('postfix expression shorthand matrix distinguishes alias, type and effects', async()=>{
  const byId=Object.fromEntries(m.cases.map(c=>[c.id,c]));
  const read=async id=>readFile(resolve(root,byId[id].path),'utf8');
  assert.match(await read('postfix_parenthesized'),/return \(c >>\);/);
  assert.match(await read('postfix_bare'),/return c >>;/);
  assert.match(await read('postfix_checked_binding'),/Result<Option<int>, IoError> answer = \(c >>\)/);
  for(const id of ['postfix_int_mismatch','postfix_missing_susp','postfix_nonreadable',
                    'postfix_discarded','postfix_spaced']) {
    assert.equal(byId[id].kind,'fail');
    assert.ok(byId[id].expected_error.startsWith('E_'));
  }
});

test('checked new Channel<int> constructor parity is explicit and unverified', async()=>{
  const byId=Object.fromEntries(m.cases.map(c=>[c.id,c]));
  const read=async id=>readFile(resolve(root,byId[id].path),'utf8');
  assert.equal(m.constructor_guest_execution,'PENDING_EXACT_HEAD_TESTS_PER_BACKEND');
  assert.match(await read('checked_channel_new_constructor'),/match new Channel<int>\(2\) over/);
  assert.match(await read('checked_channel_new_constructor'),/on Err\(error\)/);
  for(const id of ['new_channel_raw_handle_mismatch','new_channel_capacity_type_mismatch']) {
    assert.equal(byId[id].kind,'fail');
    assert.equal(byId[id].expected_error,'E_TYPE');
  }
});

test('backend admission evidence is scoped and never confused with executable parity',()=>{
  for(const backend of ['rs-browser','java','llvm','forge']) {
    assert.match(m.backend_admission_prs[backend],/^https:\/\/github\.com\/atto-lang\/atto-source\./);
    assert.ok(m.backend_evidence_boundaries[backend].length>30);
    for(const c of m.cases) {
      assert.equal(c.backend_status[backend],'NOT_EXECUTED',
        backend+' admission work is not exact-head guest execution: '+c.id);
    }
  }
});

test('checked async channel write contract carries fail-closed diagnostics and no fake PASS',async()=>{
  assert.equal(m.channel_async_send_status,'SOURCE_STAGED_EXECUTION_NOT_VERIFIED');
  const byId=Object.fromEntries(m.cases.map(c=>[c.id,c]));
  for(const id of ['async_send_postfix_receive','async_send_method_prefix_receive']) {
    assert.equal(byId[id].kind,'pass');
    const source=await readFile(resolve(root,byId[id].path),'utf8');
    assert.ok(source.includes('42'),'test must send a real payload');
    assert.ok(source.includes('on Err(error)'),'caller must handle send errors');
  }
  const errors={
    async_send_missing_susp:'E_SUSPENDS_REQUIRED',
    async_send_wrong_payload:'E_TYPE',
    async_send_nonwritable:'E_IO_WRITABLE',
    async_send_discarded:'E_IO_DISCARD',
    async_send_triple_shift:'E_IO_SYNTAX',
  };
  for(const [id,diag] of Object.entries(errors)) {
    assert.equal(byId[id].kind,'fail');
    assert.equal(byId[id].expected_error,diag);
  }
  assert.ok(m.runtime_scenarios.length>=6);
  for(const c of m.cases) for(const status of Object.values(c.backend_status))
    assert.equal(status,'NOT_EXECUTED','new source cases cannot claim runtime PASS');
});
