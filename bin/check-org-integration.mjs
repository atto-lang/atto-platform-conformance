#!/usr/bin/env node
import { loadOrgIntegrationRegistry, validateOrgIntegrationRegistry } from "../src/integration-registry.mjs";

try {
  if (process.argv.length !== 2) throw new Error("no arguments accepted");
  const registry = loadOrgIntegrationRegistry();
  const report = validateOrgIntegrationRegistry(registry);
  console.log(JSON.stringify({
    schemaVersion: registry.schemaVersion,
    snapshotDate: registry.snapshotDate,
    organization: registry.organization,
    inventoryCount: report.count,
    intendedEdges: report.edgeCount,
    byArea: report.areaCounts,
    orderedIntegrations: report.topologicalOrder,
    // This is only a structural check. It is never compiler or CI proof.
    evidence: "STRUCTURAL_METADATA_ONLY"
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
