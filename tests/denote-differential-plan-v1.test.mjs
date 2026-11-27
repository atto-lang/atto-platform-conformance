import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../contracts/denote-type-expression-v1.json',import.meta.url),'utf8'));
const blob=source=>createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');
// These pins identify fixture bytes, not compiler execution or trusted CI receipts.
const pins=new Map(Object.entries({
  'transparent-scalar':'5e6a5b27c85f913a50c778bbcc064cac2182c641',
  'literal-union-admission':'0fbe1d9620288564e110dc4107b86802ada1bc4e',
  'literal-union-rejection':'115d771384ccfa632ae7b797616013569d648151',
  'forward-alias':'6db2a69b1b8ea618a20c404f5fddf357dc440f45',
  'public-alias':'9f58face2bd46526c64944cf7146139d3f790e0f',
  'package-alias':'aec8f9fca1cc92a02cf1dab41a5f12f83fe58ef0',
  'generic-tuple':'4d4ea30e22ea31077412ee2e26b9cff5866d3a30',
  'comments-and-strings':'9a759103d184d562a64709d0df57b7b69c7b8efb',
  'legacy-pair-control':'16f75bd0faaf3d62e08905e9c7ab46d8a48f6a39',
  'missing-rhs':'7733ec53ea3de220595000f76fe4f9a1252d8422',
  'missing-semicolon':'1f991016303e6001c0b4114f47245daa2fb69da4',
  'wrong-separator':'bcaab408ce15562f789ac860dd9ccaea2393953c',
  'wrong-entity':'629eac730bf30cf4e85534e2f70e142efb9c3428',
  'value-decl':'6e202306e6b7a9907d36af3fe8a29d44b4c55028',
  'duplicate-alias':'c406f6eaf3b441f5df7cf1097823faf3b29f2fe6',
  'builtin-collision':'3f06fec055cfe9b30bd98b18470512bd592c073a',
  'unresolved':'938f35e316fb3ea59d7803cad8e26590544a0c8d',
  'direct-cycle':'47acb37094ffce879488b5a1bb6f83e944b9b113',
  'mutual-cycle':'84b5c255832c7874206aaccd651f715cc5363bf3',
  'nominal-collision':'ec4ec26eba11e9bffabc68404b2068e903d729c2',
  'generic-arity':'c88ba2b2710f7180f2d8b83a31cd6d88dd0cbba2',
  'runtime-expression':'201134876fdf2e11fcbc044da77713a0674c20c6',
  'scalar-val-chain':'81d65f8042f7c505012868ccbac23bf5f6caf6f1',
  'scalar-val-mismatch':'10c68eade4415cb3c49d75a3203c80615db43f52',
  'boolean-parameter':'dfa2e671e4746682c0b8da130bc42bc6f0180536',
  'boolean-parameter-mismatch':'1fb944287ce898bf15ab139f8cc63217ecc99401'
}));
function checkPins(cases){
  assert.equal(cases.length,pins.size);
  const seen=new Set();
  for(const c of cases){
    assert.ok(!seen.has(c.id));seen.add(c.id);
    assert.equal(blob(c.source),pins.get(c.id),c.id);
  }
}
const cases=new Map(manifest.cases.map(c=>[c.id,c]));
test('all 26 inline sources match their independently pinned Git blob identities',()=>checkPins(manifest.cases));
test('valid-looking source changes and swapped case IDs invalidate the pins',()=>{
  const changed=structuredClone(manifest.cases);changed[0].source=changed[0].source.replace('42','43');
  assert.throws(()=>checkPins(changed));
  const swapped=structuredClone(manifest.cases);[swapped[0].id,swapped[1].id]=[swapped[1].id,swapped[0].id];
  assert.throws(()=>checkPins(swapped));
});
test('literal and boolean negative fixtures differ from their positive controls only at the invalid value',()=>{
  for(const [yes,no,from,to] of [
    ['literal-union-admission','literal-union-rejection','a = 5','a = 8'],
    ['boolean-parameter','boolean-parameter-mismatch','identity(true)','identity(42)']
  ]){
    const positive=cases.get(yes),negative=cases.get(no);
    assert.equal(positive.expected.compile,'accept');
    assert.equal(negative.expected.compile,'reject');
    assert.equal(negative.expected.noArtifact,true);
    assert.equal(positive.source.split(from).length,2);
    assert.equal(positive.source.replace(from,to),negative.source);
  }
});
