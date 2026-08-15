const MAX_COMPATIBILITY_WINDOW_MS = 30 * 60_000;
const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const RESET_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

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
  if (isProductionRuntime(env) && env.STUDY_V2_ASSIGNMENT_MODE === "all") {
    errors.push("STUDY_V2_ASSIGNMENT_MODE=all is only permitted in local development");
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    errors.push("distributed Upstash login/study rate limiting is required");
  }
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) {
    errors.push("CRON_SECRET must contain at least 16 characters");
  }
  const auditSecret = env.SECURITY_AUDIT_HMAC_SECRET ?? env.SECURITY_AUDIT_HASH_SECRET;
  if (!auditSecret || auditSecret.length < 32) {
    errors.push("SECURITY_AUDIT_HMAC_SECRET must contain at least 32 characters");
  }
  const auditKeyId = env.SECURITY_AUDIT_HMAC_KEY_ID ?? env.SECURITY_AUDIT_HASH_KEY_ID;
  if (!auditKeyId || !/^[A-Za-z0-9._-]{1,64}$/u.test(auditKeyId)) {
    errors.push("SECURITY_AUDIT_HMAC_KEY_ID must be a safe non-empty key id");
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

/**
 * Validate the dedicated reset-precondition keyring independently from the
 * wider production gate. Local development may run with a valid keyring even
 * when production-only Upstash/CRON/audit configuration is intentionally
 * absent.
 */
export function teacherResetPreconditionConfigurationErrors(
  env: Environment = process.env,
): string[] {
  const errors: string[] = [];
  const current = env.TEACHER_RESET_PRECONDITION_KEY_CURRENT;
  const currentId = env.TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID;
  const previous = env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS;
  const previousId = env.TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID;
  if (!current || Buffer.from(current, "base64url").length !== 32) {
    errors.push("TEACHER_RESET_PRECONDITION_KEY_CURRENT must be a 32-byte base64url secret");
  }
  if (!currentId || !RESET_KEY_ID.test(currentId)) {
    errors.push("TEACHER_RESET_PRECONDITION_KEY_CURRENT_ID must be a safe non-empty key id");
  }
  if (Boolean(previous) !== Boolean(previousId)) {
    errors.push("TEACHER_RESET_PRECONDITION_KEY_PREVIOUS and _PREVIOUS_ID must be configured together");
  }
  if (previous && Buffer.from(previous, "base64url").length !== 32) {
    errors.push("TEACHER_RESET_PRECONDITION_KEY_PREVIOUS must be a 32-byte base64url secret");
  }
  if (previousId && !RESET_KEY_ID.test(previousId)) {
    errors.push("TEACHER_RESET_PRECONDITION_KEY_PREVIOUS_ID must be a safe key id");
  }
  if (currentId && previousId && currentId === previousId) {
    errors.push("teacher reset current and previous key ids must differ");
  }
  return errors;
}
