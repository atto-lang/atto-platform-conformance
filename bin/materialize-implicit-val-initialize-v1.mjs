#!/usr/bin/env node
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {loadCorpus, materializeCorpus, BACKENDS} from "../src/implicit-val-initialize-v1.mjs";

// This command intentionally does not execute code or claim backend parity.
// Directory cleanup belongs to the authorized compiler runner.
const arg = process.argv.slice(2);
if (arg.length !== 1 || !BACKENDS.includes(arg[0])) {
  console.error("usage: node bin/materialize-implicit-val-initialize-v1.mjs <java|llvm|net|wasm|forge>");
  process.exitCode = 2;
} else {
  const folder = await mkdtemp(join(tmpdir(), "ores-implicit-val-v1-"));
  try {
    const corpus = await loadCorpus();
    console.log(JSON.stringify(await materializeCorpus(corpus,arg[0],folder),null,2));
  } catch (error) {
    await rm(folder,{recursive:true,force:true});
    console.error(error.message);
    process.exitCode = 1;
  }
}
