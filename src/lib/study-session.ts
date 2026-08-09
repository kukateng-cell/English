/** Browser checkpoint / GET query can safely carry at most this many word ids. */
export const MAX_STUDY_SESSION_WORDS = 200;
export const RESUME_SESSION_MIN_REMAINING_MS = 2 * 60_000;

export function canReuseResumeSession(
  session: {
    expiresAt: Date;
    retiredAt: Date | null;
    items: Array<{
      wordId: string;
      usedAt: Date | null;
      renewedAt: Date | null;
      operationId: string | null;
    }>;
  } | null,
  requestedIds: string[],
  now = Date.now(),
): boolean {
  if (
    !session ||
    session.retiredAt !== null ||
    session.expiresAt.getTime() <= now + RESUME_SESSION_MIN_REMAINING_MS ||
    session.items.length !== requestedIds.length
  ) {
    return false;
  }
  const sourceIds = new Set(session.items.map((item) => item.wordId));
  return (
    sourceIds.size === requestedIds.length &&
    requestedIds.every((id) => sourceIds.has(id)) &&
    // A checkpoint may legitimately contain earlier words whose submissions
    // already consumed their nonce. Reuse never mints replacements, so those
    // used items are safe to retain; every still-unfinished item remains the
    // original pristine credential. Renewed / operation-bound items belong to
    // a different continuation and must not be folded back into this session.
    session.items.every(
      (item) => item.renewedAt === null && item.operationId === null,
    )
  );
}

export function canResumeStudySession(ids: unknown): ids is string[] {
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_STUDY_SESSION_WORDS
  ) {
    return false;
  }
  if (
    ids.some(
      (id) =>
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > 128 ||
        !/^[A-Za-z0-9_-]+$/.test(id),
    )
  ) {
    return false;
  }
  return new Set(ids).size === ids.length;
}
