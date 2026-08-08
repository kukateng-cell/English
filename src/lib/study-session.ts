/** Browser checkpoint / GET query can safely carry at most this many word ids. */
export const MAX_STUDY_SESSION_WORDS = 200;

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
