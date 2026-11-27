import assert from 'node:assert/strict';

export const smokeIds=Object.freeze(['fib-0','fib-1','fib-10','fib-10-explicit-semicolon','fib-55-linear','fib-92-linear','fib-93-overflow','fib-name-does-not-escape']);
const nested=new Set(['fib-55-linear','fib-92-linear','fib-93-overflow']);
export function selectCases(manifest,profile){
  assert.ok(['full-smoke','direct-stage'].includes(profile),'unknown profile');
  assert.equal(manifest.status,'CANDIDATE_SOURCE_NOT_EXECUTED');
  assert.deepEqual(manifest.cases.filter(c=>c.tier==='smoke').map(c=>c.id),smokeIds);
  assert.deepEqual(manifest.cases.filter(c=>c.tier==='extended').map(c=>c.id),['fib-55-exact']);
  assert.equal(manifest.cases.length,smokeIds.length+1);
  assert.equal(new Set(manifest.cases.map(c=>c.id)).size,manifest.cases.length);
  const selected=smokeIds.filter(id=>profile==='full-smoke'||!nested.has(id));
  return {selected,skipped:smokeIds.filter(id=>!selected.includes(id))};
}
export function summarizeCases(manifest,profile,rows){
  const {selected,skipped}=selectCases(manifest,profile);
  assert.deepEqual(rows.map(r=>r.id),['fib-55-exact',...selected],'missing, extra, reordered or duplicate receipt');
  for(const row of rows){
    const expected=manifest.cases.find(c=>c.id===row.id).expected;
    assert.deepEqual(row.expected,expected,'receipt oracle mismatch');
    if(row.status==='compile_only'){
      assert.equal(row.id,'fib-55-exact');
      assert.equal(row.compiled,true);
      assert.equal(row.executed,false);
      assert.match(row.artifact_sha256,/^[0-9a-f]{64}$/);
    }
    if(row.status==='pass'){
      assert.notEqual(row.id,'fib-55-exact');
      if(expected.kind==='reject'){
        assert.equal(row.compiled,false);
        assert.equal(row.executed,false);
        assert.equal(row.artifact_present,false);
      }else{
        assert.equal(row.compiled,true);
        assert.equal(row.executed,true);
        assert.deepEqual(row.actual,expected);
        assert.match(row.artifact_sha256,/^[0-9a-f]{64}$/);
      }
    }
  }
  const passed=rows.filter(r=>r.status==='pass').length;
  const compileOnly=rows[0].status==='compile_only';
  const complete=passed===selected.length&&compileOnly;
  return {passed,failed:rows.filter(r=>r.status==='fail').length,
    incomplete:rows.filter(r=>!['pass','fail','compile_only'].includes(r.status)).length,
    skipped_smoke:skipped,extended:compileOnly?'compile_only_not_executed':'not_executed',
    status:complete?(profile==='direct-stage'?'direct_stage_pass':'smoke_pass'):'incomplete'};
}
