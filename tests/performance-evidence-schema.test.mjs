import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validatePerformanceEvidence} from '../src/performance-evidence.mjs';

// Source-free contract cross-check; this is NOT an independent JSON Schema
// validator or a performance measurement. The imperative validator remains
// the authoritative runtime gate and always denies self-attestation.
const schema=JSON.parse(readFileSync(fileURLToPath(
  new URL('../schemas/performance-evidence.schema.json',import.meta.url)),'utf8'));
test('JSON Schema is closed and cannot carry certificate self-assertions',()=>{
  assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties,false);
  for(const name of ['authenticated','performance_claim_certified','passed'])
    assert.equal(Object.hasOwn(schema.properties,name),false);
  assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());
  assert.equal(schema.properties.samples.maxItems,10000);
  assert.equal(schema.properties.evidence.maxItems,32);
});
test('schema family + metric units agree with runtime admission',()=>{
  const entries=[
    ['software',['java','llvm','wasm'],{latency:'ns',throughput:'ops/s',allocation:'bytes/op',build_time:'ms',image_size:'bytes'}],
    ['fpga',['fpga'],{ii:'cycles',fmax:'MHz',lut:'count',ff:'count',bram:'count',dsp:'count'}],
    ['asic',['asic'],{area:'um2',slack:'ns',critical_path:'ns',power:'mW'}]
  ];
  const report=(family,backend,kind,unit)=>({
    schemaVersion:1,status:'UNCONFIGURED',family,backend,kind,unit,
    mode:'unit-test',sourceSha:'0'.repeat(40),compilerSha256:'0'.repeat(64),
    fixtureSha256:'0'.repeat(64),
    toolchain:{name:'fixture',version:'unconfigured'},
    environment:{target:'unknown',cpu:'unknown',clockPolicy:'unknown'},
    samples:[],correctness:'UNVERIFIED',evidence:[]
  });
  for(const [family,backends,metrics] of entries){
    const rule=schema.allOf.find(r=>r.if?.properties?.family?.const===family);
    assert.deepEqual(rule.then.properties.backend.enum,backends);
    assert.deepEqual(rule.then.properties.kind.enum,Object.keys(metrics));
    for(const [kind,unit] of Object.entries(metrics)){
      const unitRule=schema.allOf.find(r=>r.if?.properties?.kind?.const===kind);
      assert.equal(unitRule.then.properties.unit.const,unit);
      for(const backend of backends){
        const result=validatePerformanceEvidence(report(family,backend,kind,unit));
        assert.equal(result.performance_claim_certified,false);
      }
    }
  }
});
test('schema disallows unsupported silicon measurement promotions',()=>{
  const measured=schema.allOf.find(r=>r.if?.properties?.status?.const==='MEASURED');
  assert.deepEqual(measured.then.properties.family.enum,['software','fpga']);
  assert.equal(measured.then.properties.samples.minItems,5);
  const notPromoted=schema.allOf.find(r=>r.if?.properties?.status?.enum?.includes('UNCONFIGURED'));
  assert.equal(notPromoted.then.properties.samples.maxItems,0);
});

test('schema artifact locator syntax agrees with structural validator',()=>{
  const field=schema.properties.evidence.items.properties.locator;
  const pattern=new RegExp(field.pattern);
  for(const good of ['ci/raw-artifacts/report.json','artifacts/sha256_abc-01.txt']) {
    assert.equal(pattern.test(good),true,good);
  }
  for(const bad of ['../secret','./entry','/absolute','https://host/x',
    'artifact/%2e%2e/secret','foo\\\\bar','artifact//x','x/../y']) {
    assert.equal(pattern.test(bad),false,bad);
  }
});

test('Draft 2020-12 evidence stage admission is aligned with the runtime gate',()=>{
  // This is a source-free structural check; the separate Python jsonschema
  // suite evaluates actual Draft2020-12 semantics across 896 stage subsets.
  const clauses=schema.allOf.filter(x=>x.then?.properties?.evidence?.contains);
  const stageOf=x=>x.then.properties.evidence.contains.properties.stage.const;
  const matches=(clause,request)=>Object.entries(clause.if.properties).every(([k,v])=>
    Object.hasOwn(v,'const')?request[k]===v.const:v.enum?.includes(request[k]));
  const vectors=[
    [{status:'MEASURED',family:'software',kind:'latency'},['correctness','benchmark']],
    [{status:'MEASURED',family:'fpga',kind:'fmax'},['correctness','benchmark','place-route','board']],
    [{status:'SYNTH_ONLY',family:'fpga',kind:'lut'},['correctness','synthesis']],
    [{status:'SIMULATED_ONLY',family:'fpga',kind:'ii'},['correctness','simulation']],
    [{status:'PLACE_ROUTE_VERIFIED',family:'fpga',kind:'fmax'},['correctness','place-route']],
    [{status:'SYNTH_ONLY',family:'asic',kind:'power'},['correctness','synthesis','power-model']],
    [{status:'SIMULATED_ONLY',family:'asic',kind:'area'},['correctness','simulation']],
    [{status:'SIMULATED_ONLY',family:'asic',kind:'power'},['correctness','simulation','power-model']],
  ];
  assert.equal(clauses.length,9);
  for(const [claim,required] of vectors){
    const stages=clauses.filter(c=>matches(c,claim)).map(stageOf);
    assert.deepEqual([...new Set(stages)].sort(),required.sort(),
      JSON.stringify(claim));
  }
});
