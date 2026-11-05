#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {validateSourcePlatformGovernance} from "../src/source-platform-governance.mjs";

try {
  if (process.argv.length !== 2)
    throw new Error("usage: node bin/audit-source-platform-governance.mjs");
  const registry = JSON.parse(readFileSync(new URL("../integration/repositories.json", import.meta.url), "utf8"));
  const capabilities = JSON.parse(readFileSync(new URL("../contracts/platform-capabilities-v1.json", import.meta.url), "utf8"));
  console.log(JSON.stringify(validateSourcePlatformGovernance(registry, capabilities)));
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
