#!/usr/bin/env node
// Static reviewed source snapshot only. No source checkout, network, guest or release claims.
import {readFileSync} from "node:fs";
import {validateMlSourceLock} from "../src/ml-source-lock.mjs";
try {
  if(process.argv.length!==2)throw Error("Usage: node bin/check-ml-source-lock.mjs");
  const lock=JSON.parse(readFileSync(new URL("../integration/ml-source-blob-lock.v1.json",import.meta.url),"utf8"));
  const registry=JSON.parse(readFileSync(new URL("../integration/org-repositories.v1.json",import.meta.url),"utf8"));
  const result=validateMlSourceLock(lock,registry);
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
