import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableTransactionConflict } from "./transaction-retry";

test("recognizes Prisma and pg-adapter transaction conflicts", () => {
  assert.equal(isRetryableTransactionConflict({ code: "P2034" }), true);
  assert.equal(
    isRetryableTransactionConflict(
      Object.assign(new Error("TransactionWriteConflict"), {
        name: "DriverAdapterError",
        cause: {
          originalCode: "40001",
          kind: "TransactionWriteConflict",
        },
      }),
    ),
    true,
  );
  assert.equal(
    isRetryableTransactionConflict({ cause: { code: "40001" } }),
    true,
  );
  assert.equal(isRetryableTransactionConflict({ code: "40P01" }), true);
  assert.equal(
    isRetryableTransactionConflict({ cause: { originalCode: "40P01" } }),
    true,
  );
  assert.equal(
    isRetryableTransactionConflict({ code: "P2010", meta: { code: "40001" } }),
    true,
  );
  assert.equal(
    isRetryableTransactionConflict({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40P01" } } } }),
    true,
  );
});

test("does not retry unrelated database or application failures", () => {
  assert.equal(isRetryableTransactionConflict({ code: "P2002" }), false);
  assert.equal(isRetryableTransactionConflict(new Error("boom")), false);
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;
  assert.equal(isRetryableTransactionConflict(cyclic), false);
});
