#!/usr/bin/env node
import {resolve} from "node:path";
import {verifyImplicitValInitializeFixtureManifest} from "../src/implicit-val-initialize-manifest.mjs";

try {
  if (process.argv.length !== 3) {
    throw new Error("usage: node bin/verify-implicit-val-initialize.mjs <fixture-directory>");
  }
  const result = await verifyImplicitValInitializeFixtureManifest(resolve(process.argv[2]));
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
}
