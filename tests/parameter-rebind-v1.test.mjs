import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const m=JSON.parse(readFileSync(new URL('contracts/parameter-rebind-v1.json',root),'utf8'));
test('parameter rebind source contract: exact fixtures, no executed guest claims',()=>{
 assert.equal(m.status,'TARGET_NOT_EXECUTED');
 assert.equal(m.schema,'atto.parameter-rebind.v1');
 assert.equal(m.required_cases.length,6);
 assert.equal(new Set(m.required_cases.map(x=>x.id)).size,6);
 assert.ok(Object.values(m.backend_status).every(x=>x==='NOT_EXECUTED'));
 for(const x of m.required_cases){
  assert.match(x.id,/^[a-z_]+$/);
  assert.ok(['pass','fail'].includes(x.kind));
  assert.equal(x.path,'fixtures/parameter-rebind-v1/'+x.kind+'/'+x.id+'.atto');
  const url=new URL(x.path,root);assert.ok(lstatSync(url).isFile());
  const bytes=readFileSync(url);
  assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),x.source_blob_sha);
  if(x.kind==='pass'){assert.ok([69,15,23].includes(x.expected_exit));assert.equal(x.expected_error,undefined);}
  else {assert.ok(['E_IMMUTABLE','E_BORROW'].includes(x.expected_error));assert.equal(x.expected_exit,undefined);}
 }
 assert.equal(m.required_cases.filter(x=>x.kind==='pass').length,4);
});
