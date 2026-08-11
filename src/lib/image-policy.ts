/**
 * Word-coach images are deliberately same-origin only.  This keeps the
 * content surface from becoming an arbitrary remote-image fetcher while still
 * allowing the app's own public/static or uploaded image paths.
 */
export function isSameOriginImageUrl(value: unknown, allowedOrigin?: string): boolean {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001f\\]/.test(candidate)) return false;

  // Relative application paths are the preferred persisted representation.
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return true;
  if (!allowedOrigin) return false;

  try {
    const expected = new URL(allowedOrigin).origin;
    const parsed = new URL(candidate);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === expected;
  } catch {
    return false;
  }
}

export function getAllowedImageOrigin(request: Request): string | undefined {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the request origin for local/test environments.
    }
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return undefined;
  }
}

export function getSafeImageSrc(value: unknown): string | null {
  if (typeof window === "undefined") {
    return isSameOriginImageUrl(value) ? String(value).trim() : null;
  }
  return isSameOriginImageUrl(value, window.location.origin) ? String(value).trim() : null;
}
