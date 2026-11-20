import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {
  CHECKED_I64_CONTRACT, CHECKED_I64_SOURCE_DIRECTIVE, I64_MIN, I64_MAX,
  CheckedI64ContractError, evaluateCheckedI64,
  evaluateCheckedI64Json, renderCheckedI64GuestSource
} from '../src/checked-i64-oracle.mjs';

const matrixBytes=await readFile(new URL('../fixtures/checked-i64-v1.json',import.meta.url));
const gitBlobSha1=createHash('sha1')
  .update('blob '+matrixBytes.length+'\0')
  .update(matrixBytes).digest('hex');
const matrix=JSON.parse(matrixBytes);
const L=value=>({op:'literal',value:String(value)});
const B=(op,a,b)=>({op,args:[a,b]});
test('checked-i64 v1 contract has complete, unique, bounded evidence inventory',()=>{
  assert.equal(matrix.schemaVersion,1);
  assert.equal(matrix.contract,CHECKED_I64_CONTRACT);
  assert.equal(matrix.status,'candidate-unattested');
  assert.equal(matrix.cases.length,43);
  const ids=new Set();
  for(const row of matrix.cases){
    assert.match(row.id,/^[a-z0-9-]+$/);
    assert.ok(!ids.has(row.id),'duplicate '+row.id);
    ids.add(row.id);
    assert.ok(['value','error'].includes(row.expected.kind));
    if(row.expected.kind==='value'){
      assert.match(row.expected.decimal,/^(0|-?[1-9][0-9]*)$/);
      assert.equal(row.expected.category,undefined);
    }else{
      assert.ok(['integer_overflow','division_by_zero'].includes(row.expected.category));
      assert.ok(['compile','runtime'].includes(row.expected.phase));
    }
    assert.ok(row.guestSource?.startsWith('pub fnc main(): int')||
              row.guestSourceStatus==='abstract-unmapped',row.id);
    if(row.guestSourceStatus==='abstract-unmapped')
      assert.match(JSON.stringify(row.expr),/div_trunc/);
  }
  for(const id of ['literal-min','literal-max','literal-over-max',
    'literal-under-min','neg-min','mul-min-negative-one',
    'rem-min-minus-one','intermediate-add-overflow','intermediate-sub-overflow',
    'intermediate-mul-overflow','div-trunc-min-minus-one']){
    assert.ok(ids.has(id),'required vector '+id);
  }
});
test('Java source-mapped checked-i64 fixtures are byte-for-byte pinned',()=>{
  // Same deterministic mapping used by the Java JUnit suite. This ties its
  // 38 source-executable rows to the independently authored JSON fixture and
  // catches changes to expression text, expected values or error phases even
  // when the category counts remain identical.
  const rows=matrix.cases.filter(row=>typeof row.guestSource==='string');
  assert.equal(rows.length,38);
  const canonical=rows.map(row=>{
    const source=/^pub fnc main\(\): int \{ return (.*); \}\n$/.exec(row.guestSource);
    assert.ok(source,'unrecognized mapped source: '+row.id);
    return [
      row.id,source[1],row.expected.kind,
      row.expected.kind==='value'?row.expected.decimal:row.expected.category,
      row.expected.phase??'none'
    ].join('\0')+'\n';
  }).join('');
  const mappedDigest=createHash('sha256').update(canonical,'utf8').digest('hex');
  // Independently pinned in Java ExperimentalCheckedI64SharedVectorTest.
  assert.equal(mappedDigest,
    'b83276db9e770025291dd09b0837a55cd8fadc2a7f9fff4c2a78a2ea836c3044');
});

test('every mathematical checked-i64 vector has its independently specified outcome',()=>{
  let values=0,failures=0;
  for(const row of matrix.cases){
    if(row.expected.kind==='value'){
      assert.equal(evaluateCheckedI64(row.expr).toString(),row.expected.decimal,row.id);
      values++;
    }else{
      assert.throws(()=>evaluateCheckedI64(row.expr),error=>
        error instanceof CheckedI64ContractError &&
        error.code===row.expected.category,row.id);
      failures++;
    }
  }
  assert.equal(values,26);
  assert.equal(failures,17);
});
test('checked range boundaries and signed remainder distinguish wrapping from conformance',()=>{
  assert.equal(I64_MIN.toString(),'-9223372036854775808');
  assert.equal(I64_MAX.toString(),'9223372036854775807');
  assert.equal(evaluateCheckedI64(B('rem',L(I64_MIN),L(-1))),0n);
  assert.throws(()=>evaluateCheckedI64(B('add',L(I64_MAX),L(1))),
    {name:'CheckedI64ContractError',code:'integer_overflow'});
  assert.throws(()=>evaluateCheckedI64(B('sub',
    B('add',L(I64_MAX),L(1)),L(1))),
    {name:'CheckedI64ContractError',code:'integer_overflow'});
  assert.equal(BigInt.asIntN(64,I64_MAX+1n),I64_MIN);
});
test('reference only admits bounded, well-formed expression trees',()=>{
  for(const invalid of [
    null,[],{op:'literal',value:42},{op:'literal',value:'01'},
    {op:'literal',value:'-0'},{op:'literal',value:'+'},
    {op:'literal',value:'1',extra:'ignored'},
    {op:'no-such-op',args:[]},{op:'neg',args:[]},
    {op:'add',args:[L(1)]},{op:'add',args:[L(1),L(2),L(3)]},
    {op:'literal',value:'1'.repeat(65)}
  ])assert.throws(()=>evaluateCheckedI64(invalid));
  let deep=L(1);
  for(let i=0;i<70;i++)deep={op:'neg',args:[deep]};
  assert.throws(()=>evaluateCheckedI64(deep),/budget/);
});


test('fixture bytes are frozen; guest source must match the canonical expression renderer',()=>{
  // Independent Git blob ID of the reviewed matrix. Update intentionally only
  // as part of a separately reviewed fixture version/migration.
  assert.equal(gitBlobSha1,'44224caf6f6c76dedff429a47d51edc926830fdc');
  for(const row of matrix.cases){
    const rendered=renderCheckedI64GuestSource(row.expr);
    if(rendered===null){
      assert.equal(row.guestSourceStatus,'abstract-unmapped',row.id);
      assert.equal(row.guestSource,undefined,row.id);
    }else{
      assert.equal(row.guestSource,rendered,row.id);
      assert.equal(row.guestSourceStatus,undefined,row.id);
    }
  }
  const forged=structuredClone(matrix.cases.find(x=>x.id==='add-basic'));
  forged.guestSource='pub fnc main(): int { return 99; }\n';
  assert.notEqual(forged.guestSource,renderCheckedI64GuestSource(forged.expr));
  const div=structuredClone(matrix.cases.find(x=>x.id==='div-trunc-negative'));
  assert.equal(renderCheckedI64GuestSource(div.expr),null);
});

test('compile-time literal overflow is separate from runtime arithmetic errors',()=>{
  for(const row of matrix.cases){
    if(row.expected.kind!=='error')continue;
    if(row.expected.phase==='compile'){
      assert.equal(row.expr.op,'literal',row.id);
      assert.equal(row.expected.category,'integer_overflow',row.id);
    }else{
      assert.notEqual(row.expr.op,'literal',row.id);
    }
  }
});

test('foreign expressions must enter as bounded canonical parsed JSON, not live proxies',()=>{
  assert.equal(evaluateCheckedI64Json(JSON.stringify(B('add',L(20),L(22)))),42n);
  for(const invalid of [
    null,{},'','not-json',' null','{"op":"literal","value":"1"}\n',
    '{"op":"literal","value":"1","op":"literal"}',
    '{"value":"1","op":"literal"}  ',
    ' '.repeat(16385),'{"op":"literal","value":"01"}',
  ])assert.throws(()=>evaluateCheckedI64Json(invalid));
  let traps=0,gets=0;
  const proxy=new Proxy({}, {get(){traps++;throw Error('active get');},
    ownKeys(){traps++;throw Error('active enumerate');}});
  assert.throws(()=>evaluateCheckedI64Json(proxy),/canonical JSON/);
  assert.equal(traps,0);
  const active={op:'literal'};
  Object.defineProperty(active,'value',{
    get(){gets++;throw Error('active literal accessor');},enumerable:true
  });
  assert.throws(()=>evaluateCheckedI64(active),/non-inert expression record field/);
  assert.equal(gets,0);
  const sparse=[L(1),L(2)];
  delete sparse[0];
  assert.throws(()=>evaluateCheckedI64({op:'add',args:sparse}),/argument/);
  const extended=Object.assign([L(1),L(2)],{ignored:L(10)});
  assert.throws(()=>evaluateCheckedI64({op:'add',args:extended}),/argument/);
  const symbolic={op:'literal',value:'1',[Symbol('invisible')]:true};
  assert.throws(()=>evaluateCheckedI64(symbolic),/record fields/);
});


test('Java experimental checked header is exact and identical for both backend inputs',()=>{
  // The Java reference currently requires this exact *first line* to enable
  // checked evaluation. JS must compile the identical source bytes; it treats
  // a line-comment directive lexically as a comment. This is a transitional
  // opt-in profile, not proof that Java unmarked int is checked by default.
  assert.equal(CHECKED_I64_SOURCE_DIRECTIVE,'// oreslang:checked-i64-v1\n');
  for(const row of matrix.cases){
    const plain=renderCheckedI64GuestSource(row.expr,'portable-default');
    const explicit=renderCheckedI64GuestSource(row.expr,'checked-i64-v1');
    assert.equal(plain,row.guestSource??null,row.id);
    assert.equal(explicit,plain===null?null:CHECKED_I64_SOURCE_DIRECTIVE+plain,row.id);
  }
  const expr=matrix.cases.find(x=>x.id==='add-max-one').expr;
  assert.throws(()=>renderCheckedI64GuestSource(expr,'legacy-wrap'),/unsupported checked-i64 source profile/);
  assert.throws(()=>renderCheckedI64GuestSource(expr,null),/unsupported checked-i64 source profile/);
});

test('checked-i64 operand arrays use own length descriptors, not Proxy get traps',()=>{
  let reads=0;
  const args=new Proxy([L(20),L(22)],{
    get(target,key,receiver){
      if(key==='length'){reads++;throw Error('untrusted operand count getter');}
      return Reflect.get(target,key,receiver);
    }
  });
  assert.equal(evaluateCheckedI64({op:'add',args}),42n);
  assert.equal(reads,0);
  const spoofed=new Proxy([L(20),L(22)],{
    get(target,key,receiver){return key==='length'?0:Reflect.get(target,key,receiver);}
  });
  assert.equal(evaluateCheckedI64({op:'add',args:spoofed}),42n);
});

test('checked-i64 operand slots fail closed without invoking accessors',()=>{
  let reads=0;
  const active=[L(20),L(22)];
  Object.defineProperty(active,'0',{get(){reads++;throw Error('active operand getter');},enumerable:true});
  assert.throws(()=>evaluateCheckedI64({op:'add',args:active}),/non-inert expression argument/);
  assert.equal(reads,0);
  const nonenumerable=[L(20),L(22)];
  Object.defineProperty(nonenumerable,'1',{value:L(22),enumerable:false});
  assert.throws(()=>evaluateCheckedI64({op:'add',args:nonenumerable}),/non-inert expression argument/);
  const extra=[L(20),L(22)];
  extra[Symbol('hidden')]=L(99);
  assert.throws(()=>evaluateCheckedI64({op:'add',args:extra}),/invalid expression argument array/);
});

test('checked-i64 nested intermediate failure cannot be canceled later',()=>{
  const intermediateAdd=B('sub',B('add',L('9223372036854775807'),L(1)),L(1));
  const intermediateNeg=B('add',{op:'neg',args:[L('-9223372036854775808')]},L(1));
  for(const expr of [intermediateAdd,intermediateNeg])
    assert.throws(()=>evaluateCheckedI64(expr),/integer_overflow/);
  assert.throws(()=>evaluateCheckedI64(B('div_trunc',L(1),L(0))),/division_by_zero/);
  assert.throws(()=>evaluateCheckedI64(L('-0')),/noncanonical signed decimal literal/);
  assert.equal(evaluateCheckedI64(B('rem',L('-9223372036854775808'),L(-1))),0n);
});

test('checked-i64 foreign JSON byte caps reject UTF8 excess before parsing',()=>{
  const oversized=[
    '{"op":"literal","value":"'+ 'é'.repeat(9000) +'"}',
    '{"op":"literal","value":"'+ '😀'.repeat(4200) +'"}'
  ];
  const original=JSON.parse;
  let parsed=0;
  try {
    JSON.parse=function(text,...args){parsed++;return original(text,...args);};
    for(const source of oversized){
      assert.ok(Buffer.byteLength(source,'utf8')>16384);
      assert.throws(()=>evaluateCheckedI64Json(source),
        /missing or oversized canonical JSON expression/);
    }
    assert.equal(parsed,0,'foreign oversize bytes must not enter JSON.parse');
    assert.equal(evaluateCheckedI64Json('{"op":"literal","value":"42"}'),42n);
    assert.equal(parsed,1);
  } finally {JSON.parse=original;}
});
