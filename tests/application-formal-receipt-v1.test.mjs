import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyApplicationFormalReceipt as verify,
  verifyApplicationFormalReceiptFile as verifyFile} from '../bin/verify-application-formal-receipt-v1.mjs';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40), D='d'.repeat(64);
const run=(repository,head)=>({repository,head,runId:100,attempt:1,jobId:101,
  executedSteps:5,status:'completed',conclusion:'success'});
const base=()=>({
  schema:'attolang.application-formal/1', claim:'model-only',
  source:{repository:'ores-otel/ores.otel.log',commit:A,path:'formal/attolang/delivery_policy.atto',gitBlobSha1:B},
  model:{repository:'ores-otel/ores.otel.log',commit:A,inputBlobSha1:B,states:68,edges:124,
    mutationsRejected:4,run:run('ores-otel/ores.otel.log',A)},
  guests:[], production:null
});
const guest=backend=>({backend,compilerRepository:'ores-truffle-oreslang/oreslang-source.'+backend,
  compilerCommit:C,compilerBinarySha256:D,inputBlobSha1:B,stdoutSha256:D,
  negativeCases:1,executed:true,run:run('ores-truffle-oreslang/oreslang-source.'+backend,C)});
const product=()=>({repository:'opto-sync/opto-sync-clients',commit:C,inputBlobSha1:B,
  tracesReplayed:20,mismatches:0,run:run('opto-sync/opto-sync-clients',C)});
const rejects=(mutate,pattern)=>{
  const x=base();mutate(x);const result=verify(x);assert.equal(result.ok,false);
  assert.match(result.errors.join(';'),pattern);
};
test('model-only shape requires positive executed-step claim',()=>{
  assert.equal(verify(base()).ok,true);
  rejects(x=>x.model.run.executedSteps=0,/positive safe integer/);
  rejects(x=>x.model.run.conclusion='failure',/completed successful/);
  rejects(x=>x.model.run.attempt=0,/positive safe integer/);
  rejects(x=>x.model.run.head=C,/exact repository and commit/);
});
test('only compatible source .atto blobs and safe paths are accepted',()=>{
  rejects(x=>x.source.path='../private.atto',/canonical relative/);
  rejects(x=>x.source.path='formal\\bad.atto',/canonical relative/);
  rejects(x=>x.source.gitBlobSha1=C,/model must bind the exact/);
  rejects(x=>x.model.repository='attomq/atto.mq',/model must bind/);
  rejects(x=>x.source.extra='unreviewed',/exact keys/);
});
test('compiler guest shape must be backend-bound and negative-tested',()=>{
  const x=base();x.claim='compiler-guest';x.guests=[guest('java')];
  assert.equal(verify(x).ok,true);
  x.guests[0].run.executedSteps=0;
  assert.equal(verify(x).ok,false);
  x.guests[0]=guest('java');x.guests[0].compilerRepository='attomq/atto.mq';
  assert.match(verify(x).errors.join(';'),/compiler repository/);
  x.guests[0]=guest('java');x.guests[0].inputBlobSha1=C;
  assert.match(verify(x).errors.join(';'),/source blob/);
  x.guests[0]=guest('java');x.guests[0].negativeCases=0;
  assert.match(verify(x).errors.join(';'),/negativeCases/);
  x.guests[0]=guest('java');x.guests[0].executed=false;
  assert.match(verify(x).errors.join(';'),/actual execution/);
});
test('production and five-backend shapes require independent witnesses',()=>{
  const x=base();x.claim='production-refined';x.guests=[guest('java')];
  assert.match(verify(x).errors.join(';'),/independent product trace/);
  x.production=product();assert.equal(verify(x).ok,true);
  x.production.mismatches=1;
  assert.match(verify(x).errors.join(';'),/zero trace mismatches/);
  x.claim='five-backend';x.production=null;
  x.guests=['java','llvm','net','wasm','forge'].map(guest);
  assert.equal(verify(x).ok,true);
  x.guests[4]=guest('java');
  assert.match(verify(x).errors.join(';'),/duplicate backend receipt/);
  assert.match(verify(x).errors.join(';'),/five distinct/);
});
test('no stage may silently promote source-only evidence',()=>{
  const x=base();x.claim='compiler-guest';
  assert.match(verify(x).errors.join(';'),/requires executed compiler guest/);
  x.claim='model-only';x.guests=[guest('java')];
  assert.match(verify(x).errors.join(';'),/cannot contain guest/);
  x.claim='model-only';x.guests=[];x.production=product();
  assert.match(verify(x).errors.join(';'),/cannot imply production/);
});
test('on-disk canonical JSON rejects duplicate keys and symlinks',()=>{
  const dir=mkdtempSync(join(tmpdir(),'formal-receipt-'));
  const good=join(dir,'good.json');writeFileSync(good,JSON.stringify(base(),null,2)+'\n');
  assert.equal(verifyFile(good).ok,true);
  const dup=join(dir,'dup.json');
  writeFileSync(dup,JSON.stringify(base(),null,2).replace('"schema":','"schema": "wrong",\n  "schema":')+'\n');
  assert.throws(()=>verifyFile(dup),/noncanonical\/duplicate-key/);
  const link=join(dir,'link.json');symlinkSync(good,link);
  assert.throws(()=>verifyFile(link),/nonsymlink/);
});
