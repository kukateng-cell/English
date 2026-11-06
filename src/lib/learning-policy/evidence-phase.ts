/** 呼叫端須先通過客觀 provenance 檢查，歷史未標階段的資料保留 unknown。 */
export type PhaseCount = { attempts: number; correct: number; accuracyPercent: number | null };
export type ObjectivePhases = { initial: PhaseCount; due: PhaseCount; unknown: PhaseCount };
export function summarizeObjectivePhases(events: readonly {
  quality: number | null;
  probePurpose: string | null;
  objectiveEvidenceTarget?: { policyVersion?: string | null } | null;
}[]): ObjectivePhases {
  const phases: ObjectivePhases = {
    initial: { attempts: 0, correct: 0, accuracyPercent: null },
    due: { attempts: 0, correct: 0, accuracyPercent: null },
    unknown: { attempts: 0, correct: 0, accuracyPercent: null },
  };
  for (const event of events) {
    const phase = event.objectiveEvidenceTarget?.policyVersion !== "retrieval-v3" ? phases.unknown
      : event.probePurpose === "EVIDENCE_OBLIGATION" ? phases.initial
        : event.probePurpose === "DUE_REVIEW" ? phases.due : phases.unknown;
    phase.attempts++;
    if (event.quality === 4) phase.correct++;
  }
  for (const phase of Object.values(phases)) if (phase.attempts) phase.accuracyPercent = Math.round(phase.correct / phase.attempts * 10000) / 100;
  return phases;
}
