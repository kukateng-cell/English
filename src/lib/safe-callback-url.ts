/**
 * Return a same-origin application path, or the supplied fallback.
 *
 * Browsers treat backslashes as separators while parsing special-scheme URLs,
 * so a string such as `/\\evil.example` must be rejected before navigation.
 */
export function safeCallbackPath(
  candidate: string | null | undefined,
  origin: string,
  fallback = "/",
): string {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    /[\\\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const url = new URL(candidate, origin);
    if (url.origin !== origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
