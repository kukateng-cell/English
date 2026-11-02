/** 三階段共用純政策；runtime、模擬器均使用同一套輪次及間隔。 */
export const PHASE_LANES = ["initial", "due", "due", "new"] as const;
export type PhaseLane = typeof PHASE_LANES[number];
export function normalizedTerm(term: string): string {
  return term.normalize("NFKC").trim().toLocaleLowerCase("en");
}
export function initialCheckReady(now: number, exposedAt: number, otherTerms: readonly string[], term: string): boolean {
  return now - exposedAt >= 600_000 || new Set(otherTerms.map(normalizedTerm).filter(t => t !== normalizedTerm(term))).size >= 2;
}
export function nextPhaseCursor(reason: string | null | undefined): number {
  const match = reason?.match(/(?:^|\+)phase-lane:([0-3])(?:\+|$)/u);
  return match ? (Number(match[1]) + 1) % PHASE_LANES.length : 3;
}
export function choosePhase<T>(cursor: number, available: (lane: PhaseLane) => T | undefined): { value: T; laneIndex: number } | null {
  for (let offset = 0; offset < PHASE_LANES.length; offset++) {
    const laneIndex = (cursor + offset) % PHASE_LANES.length;
    const value = available(PHASE_LANES[laneIndex]);
    if (value !== undefined) return { value, laneIndex };
  }
  return null;
}
