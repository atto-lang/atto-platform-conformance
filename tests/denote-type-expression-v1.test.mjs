import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../contracts/denote-type-expression-v1.json',import.meta.url),'utf8'));
function validate(m){
 const req=(b,msg)=>{if(!b)throw new Error(msg)};
 const backends=['rs','atto','net','hdl','java','realtime','llvm','js','forge','wasm','cranelift'].map(x=>'atto-lang/atto-source.'+x);
 req(m.schema==='atto.denote-type-expression-v1'&&m.status==='CANDIDATE_SOURCE_NOT_EXECUTED','noncandidate schema/status');
 req(Object.keys(m.backendResults).length===backends.length&&backends.every(x=>m.backendResults[x]==='not_executed'),'backend promotion or missing lane');
 req(Array.isArray(m.cases)&&m.cases.length===26,'case inventory count');
 const ids=new Set(),sources=new Set();
 for(const c of m.cases){
  req(typeof c.id==='string'&&/^[a-z0-9-]+$/.test(c.id)&&!ids.has(c.id),'invalid or duplicate ID');ids.add(c.id);
  req(typeof c.source==='string'&&c.source.endsWith('\n')&&!c.source.includes('\r')&&!c.source.includes('\0')&&!sources.has(c.source),'bad or duplicate source');sources.add(c.source);
  req(c.status==='not_executed','case promotion');
  req(c.expected.compile==='accept'?c.expected.exit===42&&Object.keys(c.expected).length===2:c.expected.compile==='reject'&&c.expected.noArtifact===true&&typeof c.expected.reason==='string'&&c.expected.reason.length>0&&Object.keys(c.expected).length===3,'invalid expectation');
 }
 for(const id of ['scalar-val-chain','scalar-val-mismatch','boolean-parameter','boolean-parameter-mismatch'])req(ids.has(id),'missing scalar differential case');
}
const mutations=[
x=>x.status='PASSED',
x=>x.backendResults['atto-lang/atto-source.js']='passed',
x=>delete x.backendResults['atto-lang/atto-source.rs'],
x=>x.cases[1].id=x.cases[0].id,
x=>x.cases[1].source=x.cases[0].source,
x=>x.cases[0].status='passed',
x=>x.cases.find(c=>c.expected.compile==='reject').expected.noArtifact=false,
x=>x.cases.find(c=>c.expected.compile==='accept').expected.exit=0,
x=>x.cases[0].source=x.cases[0].source.replace(/\n/g,'\r\n')
];
test('all 26 target sources remain unexecuted and all eleven lanes are present',()=>validate(manifest));
test('reject nine forged or malformed source-only manifests',()=>{
 for(const mutate of mutations){const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>validate(copy));}
});
