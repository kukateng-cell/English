import test from "node:test";
import assert from "node:assert/strict";
import {
  legacyOperationIdCompatibilityEndsAt,
  productionConfigurationErrors,
} from "./production-config";

test("production configuration requires distributed limits and cron auth", () => {
  assert.deepEqual(productionConfigurationErrors({}, 0), [
    "distributed Upstash login/study rate limiting is required",
    "CRON_SECRET must contain at least 16 characters",
    "SECURITY_AUDIT_HASH_SECRET must contain at least 32 characters",
  ]);
});

test("legacy operation compatibility has a hard 30 minute deadline", () => {
  const now = Date.parse("2026-08-09T00:00:00Z");
  assert.equal(
    legacyOperationIdCompatibilityEndsAt("2026-08-09T00:20:00Z", now),
    Date.parse("2026-08-09T00:20:00Z"),
  );
  assert.equal(
    legacyOperationIdCompatibilityEndsAt("2026-08-09T00:31:00Z", now),
    null,
  );
  assert.equal(
    legacyOperationIdCompatibilityEndsAt("2026-08-08T23:59:00Z", now),
    null,
  );
});

test("strict production configuration rejects the old shared switch", () => {
  assert.deepEqual(
    productionConfigurationErrors(
      {
        UPSTASH_REDIS_REST_URL: "https://redis.example",
        UPSTASH_REDIS_REST_TOKEN: "token",
        CRON_SECRET: "1234567890abcdef",
        SECURITY_AUDIT_HASH_SECRET: "1234567890abcdef1234567890abcdef",
        REQUIRE_STUDY_OPERATION_ID: "0",
      },
      0,
    ),
    ["REQUIRE_STUDY_OPERATION_ID=0 is no longer permitted"],
  );
});
