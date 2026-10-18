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
