import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkCase,verifyManifest} from "../src/borrow-check-unification-v1.mjs";
const m=JSON.parse(readFileSync(new URL("../contracts/borrow-check-unification-v1.json",import.meta.url),"utf8"));
test("shared candidate matrix includes five explicit backends and admits no false evidence",()=>assert.equal(verifyManifest(m),22));
for(const c of m.cases)test("reference "+c.id,()=>assert.equal(checkCase(c),c.expected));
test("cannot forge compiler execution from host-only test",()=>{for(const b of m.backends){let t=JSON.parse(JSON.stringify(m));t.status[b]="PASS";assert.throws(()=>verifyManifest(t),/E_FALSE_EVIDENCE/);}});
test("no missing backend, duplicate case or forged expected result",()=>{let t=JSON.parse(JSON.stringify(m));t.backends.pop();assert.throws(()=>verifyManifest(t));t=JSON.parse(JSON.stringify(m));t.cases.push(t.cases[0]);assert.throws(()=>verifyManifest(t));t=JSON.parse(JSON.stringify(m));t.cases[0].expected="WRONG";assert.throws(()=>verifyManifest(t));});
