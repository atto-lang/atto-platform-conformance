import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteLLVMIRHostMainReferences as rewrite} from '../src/llvm-ir-host-symbols.mjs';

const renamed='@oreslang_numeric_unused_host_main';
const guest='define i64 @__oreslang_guest_main() { ret i64 42 }\n';
const host='define i32 @main() { ret i32 0 }\n';

test('renames only unquoted actual i32 host definition',()=>{
  const r=rewrite(guest+host);
  assert.equal(r.ir,guest+host.replace('@main',renamed));
  assert.equal(r.referencesRewritten,1);
  assert.equal(Object.isFrozen(r),true);
});
test('rewrites executable call sites but preserves the i64 guest symbol',()=>{
  const ir=guest+host+'define i32 @driver() { %r = call i32 @main() ret i32 %r }\n';
  const r=rewrite(ir);
  assert.equal(r.referencesRewritten,2);
  assert.match(r.ir,/call i32 @oreslang_numeric_unused_host_main\(\)/);
  assert.match(r.ir,/define i64 @__oreslang_guest_main\(\)/);
});
test('preserves semicolon line comments including fake functions and call sites',()=>{
  const comment='; define i32 @main() ; call i32 @main()\n';
  const r=rewrite(comment+host);
  assert.ok(r.ir.startsWith(comment));
  assert.equal(r.referencesRewritten,1);
});
test('preserves trailing LLVM comments after real declarations',()=>{
  const input='define i32 @main() { ret i32 0 } ; @main() is in documentation\n';
  const r=rewrite(input);
  assert.ok(r.ir.endsWith(' ; @main() is in documentation\n'));
  assert.equal(r.referencesRewritten,1);
});
test('preserves quoted debug metadata and source_filename strings',()=>{
  const metadata='source_filename = "source @main() should stay"\n'
    +'!0 = !{!"LLVM @main() metadata"}\n';
  const r=rewrite(metadata+host);
  assert.ok(r.ir.startsWith(metadata));
  assert.equal(r.referencesRewritten,1);
});
test('preserves LLVM c-string data with symbol-looking contents',()=>{
  const data='@label = private constant [8 x i8] c"@main(\\00"\n';
  const r=rewrite(data+host);
  assert.ok(r.ir.startsWith(data));
  assert.equal(r.referencesRewritten,1);
});
test('handles escaped double quotes and semicolons within a literal',()=>{
  const metadata='!1 = !{!"escaped \\" ; @main() quoted"}\n';
  const r=rewrite(metadata+host);
  assert.ok(r.ir.startsWith(metadata));
  assert.equal(r.referencesRewritten,1);
});
test('does not rename LLVM quoted names or longer symbol names',()=>{
  const misc='declare void @"main"()\ndeclare void @mainExtra()\n'
    +'declare void @main.v1()\ndeclare void @main_foo()\n';
  const r=rewrite(misc+host);
  assert.ok(r.ir.startsWith(misc));
  assert.equal(r.referencesRewritten,1);
});
test('supports whitespace before a real function call parenthesis',()=>{
  const call='call i32 @main   ( )\n';
  const r=rewrite(call+host);
  assert.ok(r.ir.startsWith('call i32 '+renamed+'   ( )\n'));
  assert.equal(r.referencesRewritten,2);
});
test('honors a semicolon in a quoted string before a real reference',()=>{
  const meta='!1 = !{!"semicolon; literal @main()"}\n';
  const r=rewrite(meta+host);
  assert.equal(r.ir,meta+host.replace('@main',renamed));
});
test('comment-only or string-only main text cannot count as a real reference',()=>{
  assert.throws(()=>rewrite('; fake @main()\n'),/no unquoted main/);
  assert.throws(()=>rewrite('!0 = !{!"@main()"}\n'),/no unquoted main/);
});
test('invalid and oversized inputs fail before rewrite',()=>{
  for(const bad of [null,undefined,[],123,'', 'x'.repeat(4*1024*1024+1)]){
    assert.throws(()=>rewrite(bad),/invalid or oversized/);
  }
});
