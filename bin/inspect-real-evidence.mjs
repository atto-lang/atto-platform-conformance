#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateRealCompilerReport } from "../src/real-evidence.mjs";
const [file] = process.argv.slice(2);
if (!file || process.argv.length !== 3) {
  console.error("usage: node bin/inspect-real-evidence.mjs <private-ci-report.json>");
  process.exit(2);
}
try {
  const report = JSON.parse(await readFile(file, "utf8"));
  const result = validateRealCompilerReport(report);
  console.log(JSON.stringify(result, null, 2));
  // Successful *consistency* validation is not compiler attestation.
} catch (error) {
  console.error("evidence rejected: " + error.message);
  process.exitCode = 1;
}
