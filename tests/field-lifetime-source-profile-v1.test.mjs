import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const load=p=>JSON.parse(readFileSync(new URL('../contracts/'+p,import.meta.url),'utf8'));
const profile=load('field-lifetime-source-profile-v1.json');
const parent=load('atto-source-repository-parity-audit-v1.json');
const pin={"repo":"atto-lang/atto-source.rs","commit":"78d30c0ca0ba0fc3c7a335b545db3c524b8ae39a","tree":"5d1056b38ad2f22e1896b6636c968363d64b7f5e","tracked_blobs":1189};
const expectedBlobs={"tests/fixtures/fail/996-copy-doublebang-exclusive-loan.atto":"39e2ce59944d6e1ab08711d344ab4a35b27bb759","tests/fixtures/fail/field-loan-nll-borrowed-class-never-becomes-owner.atto":"fddaa26f4b9cf8dd4719836d7e80c4ce1466e953","tests/fixtures/fail/field-loan-nll-reject-later-branch-use.atto":"2899ca70bcfa667e436f710d2cd40bbed40e4b6a","tests/fixtures/fail/field-loan-reject-disjoint-on-unverified-owner.atto":"4308274a71fbeab2f875ed0ba5696d77338082ba","tests/fixtures/fail/field-loan-reject-mut-scalar-projection.atto":"37f95c1b6772b4fad88bdcf769f9be983655e181","tests/fixtures/fail/field-loan-reject-opaque-receiver-method.atto":"f5b67c8d934fd57c788e20b4b0683614c7e7d35e","tests/fixtures/fail/field-loan-reject-overlap.atto":"95ff1264bc24c31ddccfe609f9aac93d2c130be3","tests/fixtures/fail/field-loan-reject-owner-moved-during-rhs.atto":"121106b655cfe1e133c3362b8fced57f3cfaf4fa","tests/fixtures/fail/field-loan-reject-owner-take.atto":"a5f76acc8a59f7a369a5ffb56c3e91d043e61393","tests/fixtures/fail/field-loan-reject-unverified-alias-root.atto":"423c4b9fdebdb235b36577b31e8fec75f245337f","tests/fixtures/fail/field-loan-reject-whole-owner.atto":"1899460a10c89925f4f24df6f3a6bfd9046bdd45","tests/fixtures/pass/field-loan-disjoint-name-age.atto":"10200f91020718cbefe0ff764f89b3055553c181","tests/fixtures/pass/field-loan-disjoint-other-direction.atto":"30b04bf1fde852893fad11028b13866c7d4e120b","tests/fixtures/pass/field-loan-nll-branch-join.atto":"d98c6d87dfda2dee0a8aaabb6d5c65335cd05e02","tests/fixtures/pass/field-loan-nll-copy-after-last-mut-use.atto":"2736980bdebb97f8d98cf1d7f320dfb79d816f9a","tests/fixtures/pass/field-loan-nll-copy-after-unused-mut.atto":"c64f0948143c823c03ed91a419b39289882e209c","tests/fixtures/pass/field-loan-nll-same-field-after-last-use.atto":"7e41ae347c2465aa08ec62e2f63f061c434ab6f5","tests/fixtures/pass/field-loan-nll-whole-class-reader-then-writer.atto":"84d7eda992a0a3879abbd4e152df6f3c12c4a8af","tests/fixtures/pass/field-loan-two-readers-same-owner.atto":"d33cbc1c65328f563534c639a23b2d18365d9b7b"};
// Independent exact expectation pins. Host-only validation must reject
// swapped diagnostics or stdout even without the source checkout.
const expectedOracles={"tests/fixtures/fail/996-copy-doublebang-exclusive-loan.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-nll-borrowed-class-never-becomes-owner.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-nll-reject-later-branch-use.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-disjoint-on-unverified-owner.atto":{"decision":"REJECT","reference_diagnostic":"E_OWNERSHIP","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-mut-scalar-projection.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-opaque-receiver-method.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-overlap.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-owner-moved-during-rhs.atto":{"decision":"REJECT","reference_diagnostic":"E_MOVED","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-owner-take.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-unverified-alias-root.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/fail/field-loan-reject-whole-owner.atto":{"decision":"REJECT","reference_diagnostic":"E_BORROW","artifact":"NONE"},"tests/fixtures/pass/field-loan-disjoint-name-age.atto":{"decision":"ACCEPT","exit":42,"stdout":["Alice"]},"tests/fixtures/pass/field-loan-disjoint-other-direction.atto":{"decision":"ACCEPT","exit":42,"stdout":["Bob","42"]},"tests/fixtures/pass/field-loan-nll-branch-join.atto":{"decision":"ACCEPT","exit":42,"stdout":["30"]},"tests/fixtures/pass/field-loan-nll-copy-after-last-mut-use.atto":{"decision":"ACCEPT","exit":42,"stdout":[]},"tests/fixtures/pass/field-loan-nll-copy-after-unused-mut.atto":{"decision":"ACCEPT","exit":42,"stdout":[]},"tests/fixtures/pass/field-loan-nll-same-field-after-last-use.atto":{"decision":"ACCEPT","exit":42,"stdout":["Alice"]},"tests/fixtures/pass/field-loan-nll-whole-class-reader-then-writer.atto":{"decision":"ACCEPT","exit":42,"stdout":["30"]},"tests/fixtures/pass/field-loan-two-readers-same-owner.atto":{"decision":"ACCEPT","exit":42,"stdout":["Alice","30"]}};
function inspect(p){
  assert.equal(p.schema,'atto.field-lifetime-source-profile.v1');
  assert.equal(p.parent_registry,'contracts/atto-source-repository-parity-audit-v1.json');
  assert.deepEqual(p.source,pin);
  assert.equal(p.full_parity_certified,false);
  assert.deepEqual(Object.keys(p.backend_targets),parent.source_repositories.map(r=>r.repo));
  for(const b of Object.values(p.backend_targets)) assert.deepEqual(b,{status:'TARGET_NOT_CERTIFIED',receipts:[]});
  assert.equal(p.cases.length,19);
  assert.deepEqual(Object.fromEntries(p.cases.map(c=>[c.source_path,c.expected])),expectedOracles);
  assert.equal(new Set(p.cases.map(c=>c.source_path)).size,19);
  assert.deepEqual(Object.fromEntries(p.cases.map(c=>[c.source_path,c.blob_sha])),expectedBlobs);
  assert.equal(p.cases.filter(c=>c.expected.decision==='ACCEPT').length,8);
  for(const c of p.cases){
    assert.match(c.source_path,/^tests\/fixtures\/(pass|fail)\/[a-z0-9-]+\.atto$/);
    if(c.source_path.includes('/pass/')){
      assert.equal(c.expected.decision,'ACCEPT');assert.equal(c.expected.exit,42);
      assert.ok(Array.isArray(c.expected.stdout)&&c.expected.stdout.every(s=>typeof s==='string'));
    } else {
      assert.equal(c.expected.decision,'REJECT');assert.equal(c.expected.artifact,'NONE');
      assert.match(c.expected.reference_diagnostic,/^E_(BORROW|OWNERSHIP|MOVED)$/);
    }
    assert.equal(c.profile,c.source_path.includes('mut-scalar-projection')?'restricted-snapshot-field-v1-only':c.source_path.includes('opaque')||c.source_path.includes('unverified')?'restricted-unproven-authority-v1':'lifetime-invariant');
  }
}
test('complete eleven-repository target inventory and 19 pinned cases',()=>inspect(profile));
test('missing target, fabricated receipt, or parity claim is rejected',()=>{
  for(const mutation of [p=>delete p.backend_targets['atto-lang/atto-source.java'],p=>p.backend_targets['atto-lang/atto-source.rs'].status='PASS',p=>p.full_parity_certified=true]){
    const p=structuredClone(profile);mutation(p);assert.throws(()=>inspect(p));
  }
});
test('fixture loss, substitution, wrong profile or negative artifact is rejected',()=>{
  for(const mutation of [p=>p.cases.pop(),p=>p.cases[0].blob_sha='0'.repeat(40),p=>p.cases[0].expected.artifact='WASM',p=>p.cases.find(c=>c.source_path.includes('mut-scalar-projection')).profile='lifetime-invariant']){
    const p=structuredClone(profile);mutation(p);assert.throws(()=>inspect(p));
  }
});
test('immutable compiler checkout and real source bytes match every fixture header',{skip:!process.env.ATTO_FIELD_SOURCE},()=>{
  const cwd=process.env.ATTO_FIELD_SOURCE;
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  assert.equal(git('rev-parse','HEAD'),pin.commit);
  assert.equal(git('rev-parse','HEAD^{tree}'),pin.tree);
  assert.equal(git('ls-files').split('\n').length,pin.tracked_blobs);
  for(const c of profile.cases){
    const bytes=readFileSync(cwd+'/'+c.source_path);
    const hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    assert.equal(hash,c.blob_sha);
    const source=bytes.toString('utf8');
    if(c.expected.decision==='ACCEPT'){
      assert.equal(Number(source.match(/^\/\/ expect-exit:\s*([^\r\n]+)$/m)?.[1]),c.expected.exit);
      assert.deepEqual([...source.matchAll(/^\/\/ expect-stdout:\s*([^\r\n]+)$/gm)].map(m=>m[1]),c.expected.stdout);
    }else assert.equal(source.match(/^\/\/ expect-error:\s*([^\r\n]+)$/m)?.[1],c.expected.reference_diagnostic);
  }
});

test('host-only validator rejects changed expected diagnostic and stdout',()=>{
  for(const mutate of [
    p=>p.cases.find(c=>c.expected.reference_diagnostic==='E_BORROW').expected.reference_diagnostic='E_MOVED',
    p=>p.cases.find(c=>c.expected.decision==='ACCEPT').expected.stdout=['wrong'],
    p=>p.cases.find(c=>c.expected.decision==='ACCEPT').expected.exit=41
  ]) {const p=structuredClone(profile);mutate(p);assert.throws(()=>inspect(p));}
});
