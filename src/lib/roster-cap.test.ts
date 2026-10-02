import assert from "node:assert/strict";
import test from "node:test";
import { createBulkClassPreview } from "@/app/api/admin/roster/students/bulk-class/route";

test("bulk class preview rejects the 501st selected student before opening a transaction", async () => {
  await assert.rejects(
    createBulkClassPreview({
      req: new Request("http://localhost/api/admin/roster/students/bulk-class"),
      actorUserId: "admin",
      academicYearId: "year",
      targetClassCode: null,
      studentIds: Array.from({ length: 501 }, (_, index) => `student-${index}`),
      operationId: "bulk-cap-test",
    }),
    (error: unknown) => error instanceof Error && error.message === "SELECTION_CAP",
  );
});
