#!/usr/bin/env node
// Fail-closed admission of real, separately produced Java and LLVM reports.
// Neither compiler source-to-binary provenance nor runtime parity is inferred.
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {loadManifest} from "../src/harness.mjs";
import {verifyPairedSourceChecks} from "../src/paired-proof.mjs";

try {
  if (process.argv.length !== 4) {
    throw new Error("usage: node bin/verify-paired.mjs java-report.json llvm-report.json");
  }
  const manifest = await loadManifest();
  // This paired gate only certifies fixtures intentionally shared by both
  // backends. Refuse manifests with backend-specific fixtures until separate
  // backend-completeness and shared-fixture reports are implemented.
  if (manifest.cases.some(c => !c.backends.includes("java") || !c.backends.includes("llvm"))) {
    throw new Error("the pinned manifest has fixtures not shared by Java and LLVM");
  }
  const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
  const expected = await Promise.all(manifest.cases.map(async c => ({
    id: c.id,
    fixtureSha256: createHash("sha256").update(await readFile(resolve(fixturesRoot, c.file))).digest("hex"),
  })));
  const [java, llvm] = await Promise.all(process.argv.slice(2).map(async p =>
    JSON.parse(await readFile(resolve(p), "utf8"))));
  const result = verifyPairedSourceChecks(java, llvm, expected);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("paired source-check evidence rejected:", error.message);
  process.exitCode = 1;
}
