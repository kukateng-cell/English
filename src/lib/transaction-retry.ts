/**
 * Prisma's pg driver adapter reports PostgreSQL serialization failures as a
 * DriverAdapterError with SQLSTATE 40001, while PostgreSQL deadlocks use
 * 40P01 and other Prisma engines may expose P2034. Treat all retryable
 * transaction-abort representations identically.
 */
export function isRetryableTransactionConflict(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  for (let inspected = 0; queue.length > 0 && inspected < 16; inspected += 1) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (
      value.code === "P2034" ||
      value.code === "40001" ||
      value.code === "40P01" ||
      value.originalCode === "40001" ||
      value.originalCode === "40P01" ||
      value.kind === "TransactionWriteConflict"
    ) {
      return true;
    }
    queue.push(value.cause, value.meta, value.error, value.originalError, value.driverAdapterError);
  }

  return false;
}

export async function waitForTransactionRetry(attempt: number): Promise<void> {
  const exponentialMs = Math.min(40, 4 * 2 ** attempt);
  const jitterMs = Math.floor(Math.random() * 5);
  await new Promise((resolve) => setTimeout(resolve, exponentialMs + jitterMs));
}
