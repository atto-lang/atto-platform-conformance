import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyEvidence} from './verify-counted-profile-evidence.mjs';
const data=()=>JSON.parse(readFileSync(new URL('./counted-profile-evidence.json',import.meta.url)));
test('profile evidence is exact-source and does not promote unsupported results',()=>assert.equal(verifyEvidence(),160));
test('mutated evidence cannot claim a guest result from an unsupported profile',()=>{const x=data();x.records.find(r=>r.backend==='forge').fixtures[0].outcome='guest-exit-42';assert.throws(()=>verifyEvidence(x));});
test('missing executed steps and changed fixture identity fail closed',()=>{const a=data();a.records[0].steps=0;assert.throws(()=>verifyEvidence(a));const b=data();b.records[0].fixtures[0].blob='0'.repeat(40);assert.throws(()=>verifyEvidence(b));});
test('a negative fixture cannot be promoted to a successful guest',()=>{const x=data();const r=x.records.find(r=>r.backend==='net');r.fixtures.find(f=>f.outcome==='compiler-reject-no-artifact').outcome='guest-exit-42';assert.throws(()=>verifyEvidence(x));});

test('different exact receipts may cover disjoint cells of one profile; duplicate cells reject',()=>{const x=data();const duplicate=structuredClone(x.records.at(-1));duplicate.run+=1;duplicate.job+=1;x.records.push(duplicate);assert.throws(()=>verifyEvidence(x));});

test('shared implementation pins required',()=>{const x=data();delete x.records.find(r=>r.profile==='counted-ready-v1-shared-cpp-native').sharedImplementation;assert.throws(()=>verifyEvidence(x));const y=data();y.records.find(r=>r.profile==='counted-ready-v1-chrome-dedicated-worker').compilerTree='0'.repeat(40);assert.throws(()=>verifyEvidence(y));});
test('unsupported dynamic target cannot be promoted',()=>{const x=data();x.records.find(r=>r.profile==='counted-static-ready-v1-native-object').fixtures.find(f=>f.id==='counted-dynamic').outcome='guest-exit-42';assert.throws(()=>verifyEvidence(x));});
