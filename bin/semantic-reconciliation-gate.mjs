#!/usr/bin/env node
import {runSemanticAdmission} from "../src/semantic-reconciliation-v1.mjs";
try {
  const args = {};
  for (const item of process.argv.slice(2)) {
    const m = /^--(backend|argv|source-sha|timeout-ms|suite)=(.+)$/.exec(item);
    if (!m || Object.hasOwn(args, m[1])) throw Error("invalid or duplicated option: " + item);
    args[m[1]] = m[2];
  }
  const result = await runSemanticAdmission({backend:args.backend, argv:args.argv?JSON.parse(args.argv):undefined,
    sourceSha:args["source-sha"], timeoutMs:args["timeout-ms"]?Number(args["timeout-ms"]):12000,
    suite:args.suite || "all"});
  console.log(JSON.stringify(result,null,2));
  if (!result.ok) process.exitCode=1;
} catch (error) { console.error(error.stack || error.message); process.exitCode=2; }
