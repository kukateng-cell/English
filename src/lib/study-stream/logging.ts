const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;

/**
 * Return an allowlisted diagnostic shape for unexpected V2 failures.
 *
 * Never pass the original Error to a logger: Prisma validation errors can
 * include request arguments such as opaque credentials or answer keys.
 */
export function describeStudyStreamFailure(error: unknown): {
  errorType: string;
  errorCode?: string;
} {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown };
    const result: { errorType: string; errorCode?: string } = {
      errorType: error.name.slice(0, 64) || "Error",
    };
    if (typeof candidate.code === "string" && SAFE_ERROR_CODE.test(candidate.code)) {
      result.errorCode = candidate.code;
    }
    return result;
  }
  return { errorType: typeof error };
}
