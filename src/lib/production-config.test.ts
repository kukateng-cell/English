import test from "node:test";
import assert from "node:assert/strict";
import {
  describeBackendFailure,
  isProductionRuntime,
  legacyOperationIdCompatibilityEndsAt,
  productionConfigurationErrors,
  requiresDistributedRateLimitBackend,
} from "./production-config";

test("backend failure diagnostics omit exception messages and unsafe names", () => {
  const error = new Error("redis-token-and-request-body");
  error.name = "credential=secret";
  assert.equal(describeBackendFailure(error), "Error");
  assert.equal(describeBackendFailure({ message: "request body" }), "object");
});

test("production runtime detection fails closed for either deployment signal", () => {
  assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
  assert.equal(isProductionRuntime({ VERCEL_ENV: "production" }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: "development", VERCEL_ENV: "preview" }), false);
  assert.equal(requiresDistributedRateLimitBackend({ NODE_ENV: "production" }), true);
  assert.equal(requiresDistributedRateLimitBackend({ VERCEL_ENV: "production" }), true);
  assert.equal(
    requiresDistributedRateLimitBackend({ NODE_ENV: "production", ENABLE_TEST_ROUTES: "1" }),
    false,
  );
  assert.equal(requiresDistributedRateLimitBackend({ VERCEL_ENV: "preview" }), false);
});

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

test("production configuration rejects the browser-test queue limit override", () => {
  const errors = productionConfigurationErrors({
    UPSTASH_REDIS_REST_URL: "https://example.invalid",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    CRON_SECRET: "local-check-secret",
    SECURITY_AUDIT_HASH_SECRET: "local-check-security-audit-secret",
    E2E_STUDY_QUEUE_LOAD_LIMIT: "1000",
  });
  assert.ok(errors.some((error) => error.includes("E2E_STUDY_QUEUE_LOAD_LIMIT")));
});

test("production configuration rejects browser-only test routes", () => {
  const errors = productionConfigurationErrors({
    UPSTASH_REDIS_REST_URL: "https://example.invalid",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    CRON_SECRET: "local-check-secret",
    SECURITY_AUDIT_HASH_SECRET: "local-check-security-audit-secret",
    ENABLE_TEST_ROUTES: "1",
  });
  assert.ok(errors.some((error) => error.includes("ENABLE_TEST_ROUTES")));
});
