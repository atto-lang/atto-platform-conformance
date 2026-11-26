import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const ledger=JSON.parse(readFileSync(new URL('./counted-profile-evidence.json',import.meta.url)));
export function verifyEvidence(data=ledger,m=manifest){
  assert.equal(data.schema,'atto-counted-profile-evidence-v1');
  assert.match(data.corpusCommit,/^[a-f0-9]{40}$/);assert.match(data.corpusTree,/^[a-f0-9]{40}$/);
  const cases=new Map(m.cases.map(c=>[c.id,c]));
  const receipts=new Set(),cells=new Set();
  for(const r of data.records){
    assert.ok(m.backends.includes(r.backend));assert.ok(r.profile&&r.command&&r.limits.length);
    const profile=r.backend+'/'+r.profile;
    const receipt=JSON.stringify([profile,r.head,r.run,r.job]);
    assert.ok(!receipts.has(receipt),'duplicate execution receipt');receipts.add(receipt);
    if(r.carrier!==undefined)assert.match(r.carrier,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    for(const field of ['head','tree'])assert.match(r[field],/^[a-f0-9]{40}$/);
    for(const field of ['pr','run','job','steps'])assert.ok(Number.isSafeInteger(r[field])&&r[field]>0);
    if(r.profile==='counted-ready-v1-chrome-dedicated-worker'){
      for(const field of ['compilerHead','compilerTree'])assert.match(r[field],/^[a-f0-9]{40}$/);
      assert.ok(data.records.some(o=>o.backend==='rs'&&o.profile==='counted-ready-v1-direct-wasm'&&o.head===r.compilerHead&&o.tree===r.compilerTree));
    }
    if(r.profile==='counted-ready-v1-shared-cpp-native'){
      const s=r.sharedImplementation;assert.equal(s?.repository,'atto-lang/atto-source.llvm');
      for(const field of ['head','tree'])assert.match(s[field],/^[a-f0-9]{40}$/);
      assert.equal(s.blobs.length,5);assert.equal(new Set(s.blobs).size,5);
      for(const blob of s.blobs)assert.match(blob,/^[a-f0-9]{40}$/);
      assert.ok(r.limits.some(x=>x.includes('not independent Forge native emitter')));
    }
    const unsupported=new Set(r.unsupportedFixtureIds??[]);
    if(r.profile==='counted-static-ready-v1-native-object'){
      assert.deepEqual([...unsupported].sort(),['counted-dynamic','counted-dynamic-zero']);
      assert.deepEqual(r.fixtures.filter(e=>e.outcome==='unsupported-reject-no-artifact').map(e=>e.id).sort(),[...unsupported].sort());
    }else if(r.profile.startsWith('counted-static-single-v1-')){
      assert.match(r.sharedFrontendBlob,/^[a-f0-9]{40}$/);
      assert.ok(data.records.some(o=>o.backend!==r.backend&&o.profile.startsWith('counted-static-single-v1-')&&o.sharedFrontendBlob===r.sharedFrontendBlob),'missing shared frontend peer');
      assert.deepEqual([...unsupported].sort(),["counted-distinct-alias-projection","counted-dynamic","counted-dynamic-zero","counted-mixed-future-alias","counted-mixed-zero","counted-multi-channel-fair"]);
      assert.deepEqual(r.fixtures.filter(e=>e.outcome==='unsupported-reject-no-artifact').map(e=>e.id).sort(),[...unsupported].sort());
    }else assert.equal(unsupported.size,0);
    for(const e of r.fixtures){
      const f=cases.get(e.id);assert.ok(f&&e.blob===f.gitBlobSha1);
      const raw=readFileSync(new URL('./'+f.path,import.meta.url));
      assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),e.blob);
      assert.ok(!cells.has(profile+'/'+e.id));cells.add(profile+'/'+e.id);
      if(e.outcome==='guest-exit-42'){
        assert.equal(f.target.mode,'run');assert.equal(f.target.exitCode,42);
        assert.ok(!r.profile.startsWith('unsupported')&&!r.limits.includes('not counted guest')&&!unsupported.has(e.id));
      }else if(e.outcome==='compiler-reject-no-artifact')assert.equal(f.target.mode,'reject');
      else if(e.outcome==='unsupported-reject-no-artifact'){assert.equal(f.target.mode,'run');assert.ok(r.limits.includes('not counted guest')||unsupported.has(e.id));}
      else assert.fail('unknown outcome');
    }
  }
  assert.ok(data.notExecuted.some(x=>x.backend==='atto'&&x.reason.includes('no general Atto-authored compiler CLI')));
  return cells.size;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)console.log('COUNTED_PROFILE_LEDGER_INTEGRITY_PASS '+verifyEvidence()+' observed cells; NOT fresh guest execution');
