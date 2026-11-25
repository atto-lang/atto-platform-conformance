#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateExternalOresAudit } from "../src/external-ores-integration-audit.mjs";
const path = new URL("../integration/external-ores-100-issues.json", import.meta.url);
try {
  const audit = JSON.parse(readFileSync(path, "utf8"));
  const checked = validateExternalOresAudit(audit);
  process.stdout.write(JSON.stringify(checked) + "\n");
} catch (error) {
  process.stderr.write(String(error?.message ?? error) + "\n");
  process.exitCode = 1;
}
