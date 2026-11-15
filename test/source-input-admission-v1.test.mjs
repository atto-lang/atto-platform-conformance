import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Independent scalar-byte reference; does not invoke any Oreslang backend.
function firstInvalidByte(bytes) {
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i];
    if (lead === 0) return {status:"nul",offset:i};
    if (lead <= 0x7f) {i++; continue;}
    let follow = 0, min = 0x80, max = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) follow = 1;
    else if (lead >= 0xe0 && lead <= 0xef) {
      follow = 2;
      if (lead === 0xe0) min = 0xa0;
      if (lead === 0xed) max = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      follow = 3;
      if (lead === 0xf0) min = 0x90;
      if (lead === 0xf4) max = 0x8f;
    } else return {status:"invalid_utf8",offset:i};
    if (bytes.length - i <= follow)
      return {status:"invalid_utf8",offset:i};
    for (let j = 1; j <= follow; j++) {
      if (bytes[i+j] < (j === 1 ? min : 0x80) ||
          bytes[i+j] > (j === 1 ? max : 0xbf))
        return {status:"invalid_utf8",offset:i+j};
    }
    i += follow + 1;
  }
  return {status:"valid",offset:null};
}

const contract = JSON.parse(readFileSync(
  new URL("../contracts/source-input-admission-v1.json",import.meta.url),"utf8"));

test("source admission reference is fixed, bounded and source-only",()=>{
  assert.equal(contract.schema_version,"source-input-admission-v1");
  assert.equal(contract.verification,"REFERENCE_ONLY_NOT_EXECUTED_BY_BACKENDS");
  assert.deepEqual(Object.keys(contract.backend_profiles).sort(),
    ["forge","java","llvm","net","rs","wasm"]);
  assert.equal(contract.cases.length,9);
  assert.equal(new Set(contract.cases.map(entry=>entry.name)).size,9);
});

for (const entry of contract.cases) {
  test("source admission byte oracle: "+entry.name,()=>{
    assert.match(entry.hex,/^(?:[0-9a-f]{2})+$/);
    const bytes=Buffer.from(entry.hex,"hex");
    assert.ok(bytes.length>0 && bytes.length<1024);
    assert.deepEqual(firstInvalidByte(bytes),{
      status:entry.status,offset:entry.offset
    });
    // Built-in decoder provides an independent strict UTF-8 validity check
    // but does not report the error offset; that is checked above.
    if (entry.status === "invalid_utf8")
      assert.throws(()=>new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    else {
      const decoded=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      assert.equal(decoded.includes("\0"),entry.status==="nul");
    }
  });
}
