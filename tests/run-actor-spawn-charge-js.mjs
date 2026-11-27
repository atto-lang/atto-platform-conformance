// Usage: node tests/run-actor-spawn-charge-js.mjs /absolute/path/to/backend/src/actor-spawn-charge-plan.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
if (process.argv.length !== 3) throw new Error('expected backend module path');
const {resolveSpawnCharge} = await import(pathToFileURL(resolve(process.argv[2])).href);
const rows = readFileSync(new URL('../contracts/actor-spawn-charge-v1.tsv', import.meta.url),'utf8').split('\n').filter(x=>x && !x.startsWith('#'));
const opt = (x, parse) => x === '-' ? undefined : parse(x);
const ids = new Set(); let accept=0, reject=0;
for (const row of rows) {
  const [id,serial,cap,dc,slots,hl,sl,ml,mb,da,dh,ds,dm,rc,ra,rh,rs,rm,expected] = row.split('\t');
  assert.equal(row.split('\t').length,19,id); assert.ok(!ids.has(id),id); ids.add(id);
  const p={serial:serial==='1',carrierCap:Number(cap),defaultCarriers:Number(dc),liveStackSlots:BigInt(slots),heapLimit:BigInt(hl),stackLimit:BigInt(sl),mailboxMessagesLimit:BigInt(ml),mailboxByteCharge:BigInt(mb)};
  const d={affinity:da,heapBytes:BigInt(dh),stackBytes:BigInt(ds),mailboxMessages:BigInt(dm)};
  const r={carriers:opt(rc,Number),affinity:opt(ra,String),heapBytes:opt(rh,BigInt),stackBytes:opt(rs,BigInt),mailboxMessages:opt(rm,BigInt)};
  if (expected.startsWith('E_')) { assert.throws(()=>resolveSpawnCharge(p,d,r),{message:expected},id); reject++; }
  else { const x=resolveSpawnCharge(p,d,r); assert.equal([x.carrierCap,x.affinity,x.stackBytes,x.heap,x.stacks,x.mailboxBytes,x.messages].join(','),expected,id); accept++; }
}
assert.equal(ids.size,25); assert.equal(accept,6); assert.equal(reject,19);
console.log(`SPAWN_CHARGE_JS_HOST_PASS ${accept} accepts ${reject} denials; no guest execution`);
