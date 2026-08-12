const MAX_COMPATIBILITY_WINDOW_MS = 30 * 60_000;
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

type Environment = Record<string, string | undefined>;

/**
 * Treat both the framework runtime and the hosting environment as production.
 * Vercel sets NODE_ENV for normal builds, but keeping VERCEL_ENV here prevents
 * a production deployment with an unusual build/runtime combination from
 * silently selecting local security fallbacks.
 */
export function isProductionRuntime(
  env: Environment = process.env,
): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * Browser-test builds intentionally run with NODE_ENV=production so they use
 * the same optimized bundle. The explicit local test flag is the only
 * exception to the distributed limiter requirement and is rejected by the
 * real production configuration gate.
 */
export function requiresDistributedRateLimitBackend(
  env: Environment = process.env,
): boolean {
  return isProductionRuntime(env) && env.ENABLE_TEST_ROUTES !== "1";
}

/**
 * Keep rate-limit failure diagnostics useful without copying an upstream
 * exception message, request URL, headers or response body into application
 * logs. Error names are retained only when they are a small allowlisted token.
 */
export function describeBackendFailure(error: unknown): string {
  if (error instanceof Error && SAFE_ERROR_TYPE.test(error.name)) return error.name;
  if (error instanceof Error) return "Error";
  return typeof error;
}

export function legacyOperationIdCompatibilityEndsAt(
  value: string | undefined,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  if (timestamp <= now || timestamp > now + MAX_COMPATIBILITY_WINDOW_MS) {
    return null;
  }
  return timestamp;
}

export function productionConfigurationErrors(
  env: Environment,
  now = Date.now(),
): string[] {
  const errors: string[] = [];
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    errors.push("distributed Upstash login/study rate limiting is required");
  }
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) {
    errors.push("CRON_SECRET must contain at least 16 characters");
  }
  if (
    !env.SECURITY_AUDIT_HASH_SECRET ||
    env.SECURITY_AUDIT_HASH_SECRET.length < 32
  ) {
    errors.push("SECURITY_AUDIT_HASH_SECRET must contain at least 32 characters");
  }
  if (env.REQUIRE_STUDY_OPERATION_ID === "0") {
    errors.push("REQUIRE_STUDY_OPERATION_ID=0 is no longer permitted");
  }
  if (env.E2E_STUDY_QUEUE_LOAD_LIMIT) {
    errors.push("E2E_STUDY_QUEUE_LOAD_LIMIT is only permitted in local browser tests");
  }
  if (env.ENABLE_TEST_ROUTES === "1") {
    errors.push("ENABLE_TEST_ROUTES=1 is only permitted in local browser tests");
  }
  if (
    env.STUDY_OPERATION_ID_COMPAT_UNTIL &&
    legacyOperationIdCompatibilityEndsAt(
      env.STUDY_OPERATION_ID_COMPAT_UNTIL,
      now,
    ) === null
  ) {
    errors.push(
      "STUDY_OPERATION_ID_COMPAT_UNTIL must be a future ISO timestamp no more than 30 minutes away",
    );
  }
  return errors;
}
