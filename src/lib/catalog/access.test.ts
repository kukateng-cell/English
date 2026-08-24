import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@/lib/prisma";
import { lockCatalogReviewUsers } from "./access";

test("catalog reviewer user locks are deduplicated and acquired in stable ID order", async () => {
  const lockedIds: string[] = [];
  const tx = {
    $queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      lockedIds.push(String(values[0]));
      return Promise.resolve([]);
    },
  } as unknown as Prisma.TransactionClient;

  await lockCatalogReviewUsers(tx, ["reviewer-z", null, "reviewer-a", "reviewer-z", undefined, "reviewer-m"]);

  assert.deepEqual(lockedIds, ["reviewer-a", "reviewer-m", "reviewer-z"]);
});
