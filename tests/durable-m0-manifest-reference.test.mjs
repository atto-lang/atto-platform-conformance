import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyDurableM0Reference} from '../src/durable-m0-manifest-reference.mjs';
const raw=readFileSync(new URL('../contracts/durable-m0/v1/manifest-v1.json',import.meta.url));
const expected=readFileSync(new URL('../contracts/durable-m0/v1/manifest-v1.sha256',import.meta.url),'utf8').trim();
const decode=()=>JSON.parse(raw.toString('utf8'));
const encode=v=>Buffer.from(JSON.stringify(v));
const reject=(mutate,diagnostic)=>{
 const model=decode();mutate(model);
 assert.throws(()=>verifyDurableM0Reference(encode(model)),new RegExp(diagnostic));
};
test('pinned 1671-byte nonempty canonical Java-M0 reference',()=>{
 assert.equal(expected,'aa1eed7637b99d8c270c3cd7a3f15ab83acf0463b00ebaa58f0f52c8dd525784');
 const out=verifyDurableM0Reference(raw,{expectedSha256:expected});
 assert.deepEqual([out.bytes,out.activities,out.workflows,out.commands,out.queries],[1671,1,1,3,1]);
 assert.equal(out.gate,'SOURCE_FREE_REFERENCE_ONLY_NOT_GUEST_EXECUTION');
});
test('rejects digest mismatch and forbidden noncanonical text',()=>{
 assert.throws(()=>verifyDurableM0Reference(raw,{expectedSha256:'0'.repeat(64)}),/SHA256_MISMATCH/);
 assert.throws(()=>verifyDurableM0Reference(Buffer.concat([raw,Buffer.from('\n')])),/NONCANONICAL/);
 assert.throws(()=>verifyDurableM0Reference(Buffer.from('{"x":1,"x":2}')),/NONCANONICAL/);
 assert.throws(()=>verifyDurableM0Reference(Buffer.from([0xff])),/INVALID_UTF8/);
 assert.throws(()=>verifyDurableM0Reference(Buffer.alloc(131073)),/BYTES_BUDGET/);
});
test('denies malformed or unbounded durable containers',()=>{
 reject(v=>v.workflows[0].state.push({field:'secret'}),'STATE_SCHEMA_UNSUPPORTED');
 reject(v=>v.workflows[0].version=2,'WORKFLOW_VERSION');
 reject(v=>v.activities[0].version=2,'ACTIVITY_VERSION');
 reject(v=>v.format='atto.durable.manifest.v0','FORMAT_UNSUPPORTED');
 reject(v=>v.workflows[0].commands[1].order=0,'HISTORY_ORDER');
 reject(v=>v.workflows[0].commands[1].id='charge-1','DUPLICATE_COMMAND_ID');
 reject(v=>v.workflows[0].commands[0].kind='query','COMMAND_KIND_UNSUPPORTED');
 reject(v=>v.workflows[0].commands[0].target='Billing.Missing.charge','ACTIVITY_TARGET_UNKNOWN');
 reject(v=>v.workflows[0].queries.push(v.workflows[0].queries[0]),'DUPLICATE_QUERY');
 reject(v=>v.workflows[0].queries[0].endpoint='unknown','QUERY_ENDPOINT_UNKNOWN');
 reject(v=>v.workflows[0].members[0].suspends=true,'METHOD_EFFECT_UNSUPPORTED');
 reject(v=>v.workflows[0].members[0].async=true,'METHOD_EFFECT_UNSUPPORTED');
 reject(v=>v.workflows[0].members[0].parameters[0].name='','PARAM_INVALID');
 reject(v=>v.workflows[0].commands[0].arguments[0].kind='closure','EXPRESSION_KIND_UNSUPPORTED');
 reject(v=>v.workflows[0].commands[0].arguments[0].value='$private','EXPRESSION_NAME');
 reject(v=>v.workflows[0].commands[1].arguments[0].value=Number.MAX_SAFE_INTEGER+1,'I64_NEEDS_TYPED_DECODER');
 reject(v=>v.workflows[0].members.push(v.workflows[0].members[0]),'DUPLICATE_WORKFLOW_MEMBER');
 reject(v=>v.workflows[0].commands[1].arguments=[],'TIMER_SHAPE');
 reject(v=>v.workflows[0].commands[2].arguments.push({kind:'int',value:1}),'WAIT_EVENT_SHAPE');
 reject(v=>v.activities[0].operations[0].arity=2,'METHOD_ARITY');
 reject(v=>v.workflows[0].members[0].generics.push('T'),'GENERICS_UNSUPPORTED');
 reject(v=>v.activities[0].operations.push(v.activities[0].operations[0]),'DUPLICATE_ACTIVITY_OPERATION');
 reject(v=>v.workflows[0].extra='unsafe','WORKFLOW_SHAPE');
 reject(v=>v.activities.push(v.activities[0]),'DUPLICATE_ACTIVITY');
 reject(v=>v.workflows.push(v.workflows[0]),'DUPLICATE_WORKFLOW');
 reject(v=>v.workflows[0].commands[0].arguments.push({kind:'int',value:1}),'ACTIVITY_TARGET_UNKNOWN');
 reject(v=>v.workflows[0].queries[0].returns='bool','QUERY_SIGNATURE_MISMATCH');
 reject(v=>v.workflows[0].queries[0].parameters[0].type='bool','QUERY_SIGNATURE_MISMATCH');

});
test('declaration corpus is identical but recorded steps remain AST-only',()=>{
 const corpus=readFileSync(new URL('../contracts/durable-m0/v1/checkout.atto',import.meta.url));
 assert.equal(corpus.length,464);
 const text=corpus.toString('utf8');
 assert.match(text,/define module Billing as/);
 assert.match(text,/define activity PaymentProvider as/);
 assert.match(text,/define workflow Checkout as/);
 assert.match(text,/run\(int order_id\) -> int/);
 assert.doesNotMatch(text,/recorded\s+activity_step/);
 // The reference manifest's history comes from a constructed Java AST, not
 // from source-level durable command grammar or a guest scheduler.
 const commands=decode().workflows[0].commands;
 assert.deepEqual(commands.map(c=>c.kind),['activity_step','timer','wait_event']);
});
test('source-free acceptance does not claim native or guest execution',()=>{
 const a=verifyDurableM0Reference(raw),b=verifyDurableM0Reference(Buffer.from(raw));
 assert.deepEqual(a,b);
 assert.equal(a.commands,3);
 assert.equal(a.queries,1);
});
