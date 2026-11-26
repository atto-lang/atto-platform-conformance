import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateStrictManifest} from "./verified-strict-manifest.mjs";
const manifest=JSON.parse(readFileSync(new URL("../fixtures/verified-core-strict-i64-v1/cases.json",import.meta.url),"utf8"));
assert.equal(validateStrictManifest(manifest),manifest);
const mutations=[m=>m.cases.push(m.cases[0]),
m=>m.cases[0].tier="typo",
m=>m.cases[0].id="../x",
m=>m.cases[0].expected.decimal="9223372036854775808",
m=>m.cases[0].expected.decimal="-0",
m=>m.cases[0].expected={kind:"diagnostic",category:"E_X",decimal:"1"},
m=>m.cases[0].source="",
m=>m.cases[0].expected={kind:"unknown"},
m=>m.cases[0].expected={kind:"diagnostic",category:"E_X.*"},
m=>m.cases[0].expected.decimal="-9223372036854775809"];
for(const mutate of mutations){const x=structuredClone(manifest);mutate(x);assert.throws(()=>validateStrictManifest(x),/invalid strict manifest/);}
console.log("STRICT_MANIFEST_PREFLIGHT_PASS",mutations.length);
