import test from "node:test";
import assert from "node:assert/strict";
import {
  REACHABILITY_SCHEMA,
  validateReachabilityManifest
} from "../src/reachability-manifest.mjs";

function sample() {
  return {
    schema: REACHABILITY_SCHEMA,
    entryPoints: ["main"],
    preservePublicApi: false,
    retainedSymbols: ["$root.main", "Live.answer"],
    removedSymbols: ["Dead.unused"],
    externalBindings: ["stdio"],
    languageFeatures: ["allocation", "classes"],
    runtimeOperations: []
  };
}

test("accepts canonical disjoint manifest", () => {
  assert.equal(validateReachabilityManifest(sample()), true);
});

test("rejects unsorted or duplicate set-like arrays", () => {
  const unsorted = sample();
  unsorted.languageFeatures = ["classes", "allocation"];
  assert.throws(() => validateReachabilityManifest(unsorted), /strictly sorted/);

  const duplicate = sample();
  duplicate.externalBindings = ["stdio", "stdio"];
  assert.throws(() => validateReachabilityManifest(duplicate), /duplicate/);
});

test("rejects retained/removed overlap", () => {
  const manifest = sample();
  manifest.removedSymbols = ["$root.main"];
  assert.throws(() => validateReachabilityManifest(manifest), /both retained and removed/);
});

test("rejects extension fields until schema version changes", () => {
  const manifest = sample();
  manifest.backendGuess = "llvm";
  assert.throws(() => validateReachabilityManifest(manifest), /unexpected reachability field/);
});
