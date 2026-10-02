import type { PoolConfig } from "pg";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function databasePoolConfig(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  return {
    connectionString,
    max: boundedInteger(env.DATABASE_POOL_MAX, 3, 1, 10),
    connectionTimeoutMillis: boundedInteger(
      env.DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      1_000,
      30_000,
    ),
    idleTimeoutMillis: boundedInteger(
      env.DATABASE_IDLE_TIMEOUT_MS,
      10_000,
      1_000,
      300_000,
    ),
    allowExitOnIdle: true,
  };
}
