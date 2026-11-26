import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyEvidence} from './verify-counted-profile-evidence.mjs';
const data=()=>JSON.parse(readFileSync(new URL('./counted-profile-evidence.json',import.meta.url)));
test('profile evidence is exact-source and does not promote unsupported results',()=>assert.equal(verifyEvidence(),82));
test('mutated evidence cannot claim a guest result from an unsupported profile',()=>{const x=data();x.records.find(r=>r.backend==='forge').fixtures[0].outcome='guest-exit-42';assert.throws(()=>verifyEvidence(x));});
test('missing executed steps and changed fixture identity fail closed',()=>{const a=data();a.records[0].steps=0;assert.throws(()=>verifyEvidence(a));const b=data();b.records[0].fixtures[0].blob='0'.repeat(40);assert.throws(()=>verifyEvidence(b));});
test('a negative fixture cannot be promoted to a successful guest',()=>{const x=data();const r=x.records.find(r=>r.backend==='net');r.fixtures.find(f=>f.outcome==='compiler-reject-no-artifact').outcome='guest-exit-42';assert.throws(()=>verifyEvidence(x));});
