import test from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {validateEnumManifest,validateEnumFiles} from "../lib/enum-semantics-v1-policy.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const manifest=JSON.parse(readFileSync(resolve(root,"contracts/enum-semantics-v1.json"),"utf8"));
test("enum manifest has a closed, duplicate-free, uncertified backend inventory",()=>{
 validateEnumManifest(manifest);
});
test("enum fixtures are complete, regular, canonical UTF-8 and Git-blob pinned",()=>{
 validateEnumFiles(root,manifest);
});
