#!/usr/bin/env node
import {open, stat} from "node:fs/promises";
import {resolve} from "node:path";
import {validateReachabilityManifest} from "../src/reachability-manifest.mjs";

const MAX_BYTES = 2 * 1024 * 1024;

try {
  if (process.argv.length !== 3) {
    throw new Error("usage: verify-reachability-manifest.mjs <manifest.json>");
  }
  const path = resolve(process.argv[2]);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error("manifest path is not a regular file");
  if (metadata.size > MAX_BYTES) throw new Error("manifest exceeds 2 MiB limit");

  const handle = await open(path, "r");
  let text;
  try {
    text = await handle.readFile({encoding: "utf8"});
  } finally {
    await handle.close();
  }

  const manifest = JSON.parse(text);
  validateReachabilityManifest(manifest);
  process.stdout.write(JSON.stringify({ok: true, schema: manifest.schema}) + "\n");
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
}
