/**
 * Prisma's pg driver adapter reports PostgreSQL serialization failures as a
 * DriverAdapterError with SQLSTATE 40001, while other Prisma engines expose
 * the same condition as P2034. Treat both representations identically.
 */
export function isRetryableTransactionConflict(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();

  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null || seen.has(current)) {
      return false;
    }
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (
      value.code === "P2034" ||
      value.code === "40001" ||
      value.originalCode === "40001" ||
      value.kind === "TransactionWriteConflict"
    ) {
      return true;
    }
    current = value.cause;
  }

  return false;
}

export async function waitForTransactionRetry(attempt: number): Promise<void> {
  const exponentialMs = Math.min(40, 4 * 2 ** attempt);
  const jitterMs = Math.floor(Math.random() * 5);
  await new Promise((resolve) => setTimeout(resolve, exponentialMs + jitterMs));
}
