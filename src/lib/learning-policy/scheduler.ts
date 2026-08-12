import {
  RETRIEVAL_V1_POLICY,
  activeWorkCount,
  isWorkEligible,
  type CandidateRecord,
  type RetrievalPolicyConfig,
  type SelectionDecision,
  type SelectionState,
} from "./types";

function compareUrgency(left: CandidateRecord, right: CandidateRecord): number {
  const leftExpiry = left.expiresAt ?? Number.POSITIVE_INFINITY;
  const rightExpiry = right.expiresAt ?? Number.POSITIVE_INFINITY;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  const leftEligible = left.eligibleAt ?? 0;
  const rightEligible = right.eligibleAt ?? 0;
  if (leftEligible !== rightEligible) return leftEligible - rightEligible;
  return left.id.localeCompare(right.id);
}

function eligibleCandidates(state: SelectionState): CandidateRecord[] {
  return state.candidates.filter((candidate) => {
    if (candidate.mode && candidate.mode !== state.mode) return false;
    if (candidate.eligibleAt !== undefined && candidate.eligibleAt > state.now) {
      return false;
    }
    if (candidate.expiresAt !== undefined && candidate.expiresAt <= state.now) {
      return false;
    }
    return true;
  });
}

function digestInput(candidates: readonly CandidateRecord[]): string[] {
  return candidates
    .map((candidate) => `${candidate.id}:${candidate.kind}:${candidate.wordId}`)
    .sort();
}

function decision(
  candidate: CandidateRecord | null,
  reason: string,
  eligible: readonly CandidateRecord[],
  overrideReason?: string,
): SelectionDecision {
  return {
    candidate,
    reason,
    ...(overrideReason ? { overrideReason } : {}),
    versionBundle: {
      policyVersion: RETRIEVAL_V1_POLICY.policyVersion,
      qualityPolicyVersion: RETRIEVAL_V1_POLICY.qualityPolicyVersion,
      itemConstructionVersion: RETRIEVAL_V1_POLICY.itemConstructionVersion,
    },
    candidateCount: eligible.length,
    eligibleSetDigestInput: digestInput(eligible),
  };
}

/**
 * Select one item. The function never mutates the candidate list or work
 * records; admission and lease writes happen inside the server transaction.
 */
export function selectNextItem(
  state: SelectionState,
  policy: RetrievalPolicyConfig = RETRIEVAL_V1_POLICY,
): SelectionDecision {
  const eligible = eligibleCandidates(state);
  if (eligible.length === 0) return decision(null, "no-candidate", eligible);

  const currentLease = eligible.find(
    (candidate) => candidate.leasedToCurrentSession,
  );
  if (currentLease) return decision(currentLease, "resume-leased", eligible);

  const activeWork = state.activeWork.filter((work) =>
    isWorkEligible(work, state.now),
  );
  const workIds = new Set(activeWork.map((work) => work.id));
  const workCandidates = eligible
    .filter((candidate) => candidate.workId && workIds.has(candidate.workId))
    .sort(compareUrgency);

  const dueProbes = eligible
    .filter(
      (candidate) =>
        candidate.kind === "OBJECTIVE_PROBE" &&
        candidate.purpose === "DUE_REVIEW" &&
        !candidate.workId,
    )
    .sort(compareUrgency);
  const remediationCards = eligible
    .filter(
      (candidate) =>
        candidate.kind === "LEARNING_CARD" && candidate.workId !== undefined,
    )
    .sort(compareUrgency);
  const ordinary = eligible
    .filter(
      (candidate) =>
        !candidate.workId &&
        !(candidate.kind === "OBJECTIVE_PROBE" && candidate.purpose === "DUE_REVIEW"),
    )
    .sort(compareUrgency);

  const oldestWork = workCandidates[0];
  const gapOverride =
    oldestWork && state.acknowledgedItemsSinceProbe >= policy.maxEligibleServiceGap;
  const probeSoftCapped = state.consecutiveProbes >= policy.maxConsecutiveProbes;
  const nonProbeCandidate = [...remediationCards, ...ordinary].sort(compareUrgency)[0];

  if (oldestWork && (!probeSoftCapped || gapOverride || !nonProbeCandidate)) {
    return decision(
      oldestWork,
      "evidence-work",
      eligible,
      gapOverride ? "max-eligible-service-gap" : undefined,
    );
  }
  if (dueProbes[0] && (!probeSoftCapped || !nonProbeCandidate)) {
    return decision(dueProbes[0], "due-review", eligible);
  }
  if (nonProbeCandidate) {
    return decision(nonProbeCandidate, "probe-soft-cap-rest", eligible);
  }
  if (oldestWork) {
    return decision(
      oldestWork,
      "evidence-work",
      eligible,
      "probe-only-legal-item",
    );
  }
  if (dueProbes[0]) return decision(dueProbes[0], "due-review", eligible);
  return decision(eligible.slice().sort(compareUrgency)[0], "fallback", eligible);
}

export function combinedDebtWithinCap(
  work: readonly SelectionState["activeWork"][number][],
  policy: RetrievalPolicyConfig = RETRIEVAL_V1_POLICY,
): boolean {
  return activeWorkCount(work) <= policy.maxCombinedWorkDebt;
}
