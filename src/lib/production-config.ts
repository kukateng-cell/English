const MAX_COMPATIBILITY_WINDOW_MS = 30 * 60_000;

type Environment = Record<string, string | undefined>;

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
