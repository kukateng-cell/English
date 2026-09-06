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
  const leftPriority = left.selectionPriority ?? Number.POSITIVE_INFINITY;
  const rightPriority = right.selectionPriority ?? Number.POSITIVE_INFINITY;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
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

function spacedCandidates(
  eligible: readonly CandidateRecord[],
  state: SelectionState,
): { candidates: readonly CandidateRecord[]; overridden: boolean } {
  const spacing = new Set(
    state.recentWordIds?.length
      ? state.recentWordIds
      : state.lastWordId
        ? [state.lastWordId]
        : [],
  );
  if (spacing.size === 0) return { candidates: eligible, overridden: false };
  // A tiny unit may contain only a recently seen word. Keep an explicit
  // fallback rather than silently ending the stream; when alternatives exist,
  // every candidate source observes the same learner-scoped spacing rule.
  const spaced = eligible.filter((candidate) => !spacing.has(candidate.wordId));
  return spaced.length > 0
    ? { candidates: spaced, overridden: false }
    : { candidates: eligible, overridden: true };
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

  // A currently leased card belongs to this session and must be resumable
  // even if its word is also in the learner-scoped spacing window.
  const currentLease = eligible.find(
    (candidate) => candidate.leasedToCurrentSession,
  );
  if (currentLease) return decision(currentLease, "resume-leased", eligible);

  const spaced = spacedCandidates(eligible, state);
  const selectionEligible = spaced.candidates;

  const activeWork = state.activeWork.filter((work) =>
    isWorkEligible(work, state.now),
  );
  const workIds = new Set(activeWork.map((work) => work.id));
  const workCandidates = selectionEligible
    .filter((candidate) => candidate.workId && workIds.has(candidate.workId))
    .sort(compareUrgency);

  const dueProbes = selectionEligible
    .filter(
      (candidate) =>
        candidate.kind === "OBJECTIVE_PROBE" &&
        candidate.purpose === "DUE_REVIEW" &&
        !candidate.workId,
    )
    .sort(compareUrgency);
  const remediationCards = selectionEligible
    .filter(
      (candidate) =>
        candidate.kind === "LEARNING_CARD" && candidate.workId !== undefined,
    )
    .sort(compareUrgency);
  const ordinary = selectionEligible
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
  // `consecutiveProbes` is also the bounded indicator that a previous probe
  // exists in the retained recent shape. Until the minimum number of
  // acknowledged non-probe items has intervened, a probe may only be selected
  // when no non-probe candidate can keep the stream live.
  const interveningGapOpen =
    state.consecutiveProbes === 0 ||
    state.acknowledgedItemsSinceProbe >= policy.minInterveningItems;
  const probeMayRun = interveningGapOpen || !nonProbeCandidate;
  const softCapOverride = probeSoftCapped && !nonProbeCandidate;
  const overrideReason = [
    gapOverride ? "max-eligible-service-gap" : null,
    softCapOverride ? "probe-soft-cap-exhausted" : null,
    spaced.overridden ? "spacing-only-candidate" : null,
  ].filter((reason): reason is string => reason !== null).join("+") || undefined;

  if (oldestWork && ((!probeSoftCapped && interveningGapOpen) || gapOverride || !nonProbeCandidate)) {
    return decision(
      oldestWork,
      "evidence-work",
      selectionEligible,
      overrideReason,
    );
  }
  if (dueProbes[0] && ((!probeSoftCapped && interveningGapOpen) || probeMayRun)) {
    return decision(dueProbes[0], "due-review", selectionEligible, overrideReason);
  }
  if (nonProbeCandidate) {
    return decision(
      nonProbeCandidate,
      spaced.overridden ? "spacing-override" : "probe-soft-cap-rest",
      selectionEligible,
      overrideReason,
    );
  }
  if (oldestWork) {
    return decision(
      oldestWork,
      "evidence-work",
      selectionEligible,
      ["probe-only-legal-item", overrideReason].filter(Boolean).join("+") || undefined,
    );
  }
  if (dueProbes[0]) return decision(dueProbes[0], "due-review", selectionEligible, overrideReason);
  return decision(
    selectionEligible.slice().sort(compareUrgency)[0],
    spaced.overridden ? "spacing-override" : "fallback",
    selectionEligible,
    overrideReason,
  );
}

export function combinedDebtWithinCap(
  work: readonly SelectionState["activeWork"][number][],
  policy: RetrievalPolicyConfig = RETRIEVAL_V1_POLICY,
): boolean {
  return activeWorkCount(work) <= policy.maxCombinedWorkDebt;
}
