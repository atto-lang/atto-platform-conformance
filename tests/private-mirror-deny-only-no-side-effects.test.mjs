import {test} from "node:test";
import assert from "node:assert/strict";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

const DENIED = "PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL";

// A security hold is not an admission policy. Even apparently approved
// caller-controlled inputs cannot trigger property reads, network access,
// Git-object creation, or any other side effect in these retired entrypoints.
for (const [name, invoke] of [
  ["preflight", requirePrivateMirror],
  ["publisher", publishPrivateMirror]
]) {
  test(name + " unconditionally denies hostile options without evaluating any getters", async () => {
    let traps = 0;
    const hostile = new Proxy(Object.create(null), {
      get() { traps++; throw Error("FORBIDDEN_GETTER_EVALUATED"); },
      ownKeys() { traps++; throw Error("FORBIDDEN_ENUMERATION"); },
      getOwnPropertyDescriptor() { traps++; throw Error("FORBIDDEN_DESCRIPTOR"); }
    });

    for (const value of [undefined, null, hostile, "approved",
      Object.freeze({source:"ores-truffle-oreslang/oreslang-source.java",
        destination:"private-org/carrier", token:"fake", approvedDestinations:["private-org/carrier"]})]) {
      await assert.rejects(invoke(value),
        err => err instanceof Error && err.message === DENIED);
    }
    assert.equal(traps, 0, "deny-only API must not inspect untrusted options");
  });

  test(name + " refuses every incident-specific synthetic approval without network or credentials", async () => {
    let getterCount = 0, fetchCount = 0;
    for (const incident of [22, 77, 127, 212, 171, 172, 198, 200, 252]) {
      const options = Object.create(null, {
        incident: {value: incident, enumerable: true},
        approvedDestinations: {value: ["carrier/private"], enumerable: true},
        getSource: {get() { getterCount++; throw Error("PRIVATE_SOURCE_READ"); }, enumerable: true},
        fetchImpl: {value: async () => { fetchCount++; throw Error("NETWORK_USED"); }, enumerable: true}
      });
      await assert.rejects(invoke(options),
        err => err instanceof Error && err.message === DENIED);
    }
    assert.equal(getterCount, 0, "no input getter may run");
    assert.equal(fetchCount, 0, "no supplied transport may run");
  });
}
