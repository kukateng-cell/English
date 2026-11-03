import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_INITIAL_ACTIVATION_SELECTION_RULE,
  catalogSenseKeySetDigest,
  readCatalogInitialActivationManifest,
} from "@/lib/catalog/initial-activation";

const SOURCE_DIGEST =
  "696557d4267efc4cb46ecfc84a0c2c3f0b87b274f2f9743b51ac40c5c5cc136a";

test("checked-in initial activation manifest fixes the formal baseline", async () => {
  const manifest = await readCatalogInitialActivationManifest(
    process.cwd(),
    SOURCE_DIGEST,
  );
  assert.equal(
    manifest.selectionRule,
    CATALOG_INITIAL_ACTIVATION_SELECTION_RULE,
  );
  assert.deepEqual(manifest.expected, {
    sourceRows: 5641,
    validRows: 5576,
    activeSenses: 5469,
    draftSenses: 107,
    validationFailedRows: 65,
  });
  assert.deepEqual(manifest.selectionDigests, {
    activeSenseKeysSha256:
      "0ca5e279e332783cb9d5113466510bbaeb40d03fb332fadabc1f23c1e9fbd45f",
    draftSenseKeysSha256:
      "6b665ac9b5f9402234e4130ae0e69a5c8df3d4a63b88eced05a917a7d874d916",
  });
});

test("sense-key set digest is sorted and order-independent", () => {
  assert.equal(
    catalogSenseKeySetDigest(["sense-b", "sense-a"]),
    catalogSenseKeySetDigest(["sense-a", "sense-b"]),
  );
});

test("initial activation manifest rejects a different CSV digest", async () => {
  await assert.rejects(
    readCatalogInitialActivationManifest(process.cwd(), "different-digest"),
    /does not match the supported contract or CSV source digest/u,
  );
});
