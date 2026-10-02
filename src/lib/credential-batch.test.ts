import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { prepareCredentials } from "@/lib/credential-batch";

test("credential batch keeps account order and returns verifiable bcrypt hashes", async () => {
  const credentials = await prepareCredentials(["student-a", "student-b"], ["user-a", "user-b"]);

  assert.equal(credentials.length, 2);
  assert.deepEqual(credentials.map((item) => item.accountName), ["student-a", "student-b"]);
  assert.deepEqual(credentials.map((item) => item.userId), ["user-a", "user-b"]);
  assert.notEqual(credentials[0]?.temporaryPassword, credentials[1]?.temporaryPassword);
  assert.equal(await bcrypt.compare(credentials[0]!.temporaryPassword, credentials[0]!.passwordHash), true);
  assert.equal(await bcrypt.compare(credentials[1]!.temporaryPassword, credentials[1]!.passwordHash), true);
});

test("empty credential batches do not create worker jobs", async () => {
  assert.deepEqual(await prepareCredentials([]), []);
});
