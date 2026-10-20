import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILD_REACHABILITY_SCHEMA,
  REACHABILITY_SCHEMA,
  validateBuildReachabilityManifest,
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


function buildSample() {
  return {
    schema: BUILD_REACHABILITY_SCHEMA,
    entryUnit: "app.ores",
    retainedUnits: ["app.ores", "lib.ores"],
    removedUnits: ["dead.ores"],
    units: {
      "app.ores": sample(),
      "lib.ores": {
        ...sample(),
        entryPoints: ["live"],
        retainedSymbols: ["$root.live"],
        removedSymbols: []
      }
    }
  };
}

test("accepts canonical whole-build manifest", () => {
  assert.equal(validateBuildReachabilityManifest(buildSample()), true);
});

test("whole-build manifest requires exact retained-unit coverage", () => {
  const manifest = buildSample();
  delete manifest.units["lib.ores"];
  assert.throws(
    () => validateBuildReachabilityManifest(manifest),
    /exactly cover retainedUnits/
  );
});

test("whole-build manifest rejects removed entry or overlap", () => {
  const missingEntry = buildSample();
  missingEntry.retainedUnits = ["lib.ores"];
  assert.throws(
    () => validateBuildReachabilityManifest(missingEntry),
    /entryUnit must be retained/
  );

  const overlap = buildSample();
  overlap.removedUnits = ["app.ores"];
  assert.throws(
    () => validateBuildReachabilityManifest(overlap),
    /both retained and removed/
  );
});

test("whole-build unit keys must be canonical sorted order", () => {
  const manifest = buildSample();
  manifest.units = {
    "lib.ores": manifest.units["lib.ores"],
    "app.ores": manifest.units["app.ores"]
  };
  assert.throws(
    () => validateBuildReachabilityManifest(manifest),
    /strictly sorted/
  );
});
