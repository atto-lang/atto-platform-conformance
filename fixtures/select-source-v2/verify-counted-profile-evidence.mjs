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
    for(const e of r.fixtures){
      const f=cases.get(e.id);assert.ok(f&&e.blob===f.gitBlobSha1);
      const raw=readFileSync(new URL('./'+f.path,import.meta.url));
      assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),e.blob);
      assert.ok(!cells.has(profile+'/'+e.id));cells.add(profile+'/'+e.id);
      if(e.outcome==='guest-exit-42'){
        assert.equal(f.target.mode,'run');assert.equal(f.target.exitCode,42);
        assert.ok(!r.profile.startsWith('unsupported')&&!r.limits.includes('not counted guest'));
      }else if(e.outcome==='compiler-reject-no-artifact')assert.equal(f.target.mode,'reject');
      else if(e.outcome==='profile-limited-reject-no-artifact'){
        assert.equal(f.target.mode,'run');
        assert.ok(!r.profile.startsWith('unsupported')&&!r.limits.includes('not counted guest'));
        assert.ok(typeof e.limitation==='string'&&e.limitation.length>0&&r.limits.includes(e.limitation));
      }else if(e.outcome==='unsupported-reject-no-artifact'){assert.equal(f.target.mode,'run');assert.ok(r.limits.includes('not counted guest'));}
      else assert.fail('unknown outcome');
    }
  }
  assert.ok(data.notExecuted.some(x=>x.backend==='atto'&&x.reason.includes('no general Atto-authored compiler CLI')));
  return cells.size;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)console.log('COUNTED_PROFILE_LEDGER_INTEGRITY_PASS '+verifyEvidence()+' observed cells; NOT fresh guest execution');
