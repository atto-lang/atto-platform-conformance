// Synthetic WebAssembly adapter checks ONLY: these are not compiled Atto guests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const adapter = join(dirname(fileURLToPath(import.meta.url)), '../bin/borrow_guest_exit.mjs');
function uleb(n) {
  const out=[]; let x=n;
  do { const v=x&127; x>>>=7; out.push(x?v|128:v); } while(x);
  return out;
}
function section(id, data) { return [id,...uleb(data.length),...data]; }
function name(s) { const b=[...Buffer.from(s)]; return [...uleb(b.length),...b]; }
function mockGuest(result) {
  const type=section(1,[1,0x60,0,1,0x7e]);
  const funcs=section(3,[1,0]);
  const panic=section(6,[1,0x7f,1,0x41,0,0x0b]);
  const exports=section(7,[2,...name('main'),0,0,...name('panic_code'),3,0]);
  const body=[0,0x42,...uleb(result),0x0b];
  const code=section(10,[1,...uleb(body.length),...body]);
  return Buffer.from([0,97,115,109,1,0,0,0,...type,...funcs,...panic,...exports,...code]);
}
function execute(bytes) {
  const dir=mkdtempSync(join(tmpdir(),'borrow-adapter-'));
  try {
    const file=join(dir,'guest.wasm'); writeFileSync(file,bytes);
    return spawnSync(process.execPath,[adapter,file],{encoding:'utf8'});
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
test('guest main i64 42 becomes process exit 42',()=>{
  const r=execute(mockGuest(42));assert.equal(r.status,42);assert.equal(r.stderr,'');
});
test('guest main i64 41 does not become success 42',()=>{
  const r=execute(mockGuest(41));assert.equal(r.status,41);
});
test('invalid Wasm fails closed',()=>{
  const r=execute(Buffer.from([1,2,3]));assert.equal(r.status,1);assert.match(r.stderr,/ATTO_GUEST_INVALID/);
});
test('unexpected Wasm export fails closed',()=>{
  const b=mockGuest(42);const marker=Buffer.from('panic_code');
  const at=b.indexOf(marker);assert.ok(at>=0);b.set(Buffer.from('panic_codx'),at);
  const r=execute(b);assert.equal(r.status,1);assert.match(r.stderr,/ATTO_GUEST_INVALID/);
});
