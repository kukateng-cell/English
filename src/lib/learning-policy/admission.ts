import {
  activeWorkCount,
  isActiveWorkStatus,
  RETRIEVAL_V1_POLICY,
  type RetrievalPolicyConfig,
  type SelfRating,
  type WorkKind,
  type WorkRecord,
} from "./types";

export type AdmissionReason =
  | "accepted"
  | "already-active"
  | "debt-cap"
  | "policy-not-required";

export interface AdmissionResult {
  admitted: boolean;
  reason: AdmissionReason;
  existing?: WorkRecord;
  record?: WorkRecord;
}

export interface EncounterPolicyInput {
  learnerId: string;
  wordId: string;
  selfRating: SelfRating;
  repetitions: number;
  hadObjectiveEvidence: boolean;
  activeWork: readonly WorkRecord[];
  now: number;
  sourceOperationId: string;
  policy?: RetrievalPolicyConfig;
}

/**
 * V1 only asks for a future verification after a recalled encounter that has
 * not yet accumulated objective evidence. A forgotten encounter is already a
 * remediation signal and does not create a second obligation.
 */
export function requiresEvidenceObligation(input: EncounterPolicyInput): boolean {
  if (input.selfRating !== "selfRecalled") return false;
  if (input.hadObjectiveEvidence) return false;
  return input.repetitions <= 1;
}

export function admitWork(
  input: {
    learnerId: string;
    wordId: string;
    kind: WorkKind;
    now: number;
    eligibleAt?: number;
    sourceOperationId?: string;
    activeWork: readonly WorkRecord[];
    policy?: RetrievalPolicyConfig;
  },
): AdmissionResult {
  const policy = input.policy ?? RETRIEVAL_V1_POLICY;
  const existing = input.activeWork.find(
    (record) =>
      record.learnerId === input.learnerId &&
      record.wordId === input.wordId &&
      record.kind === input.kind &&
      isActiveWorkStatus(record.status),
  );
  if (existing) {
    return { admitted: false, reason: "already-active", existing };
  }
  if (activeWorkCount(input.activeWork) >= policy.maxCombinedWorkDebt) {
    return { admitted: false, reason: "debt-cap" };
  }
  const eligibleAt = input.eligibleAt ?? input.now;
  const record: WorkRecord = {
    id: `work:${input.learnerId}:${input.wordId}:${input.kind}:${input.sourceOperationId ?? input.now}`,
    learnerId: input.learnerId,
    wordId: input.wordId,
    kind: input.kind,
    status: "PENDING",
    admittedAt: input.now,
    eligibleAt,
    expiresAt: input.now + policy.maxObligationAgeMs,
    lastServedAt: null,
    sourceOperationId: input.sourceOperationId ?? null,
  };
  return { admitted: true, reason: "accepted", record };
}

export function verificationTimes(
  now: number,
  policy: RetrievalPolicyConfig = RETRIEVAL_V1_POLICY,
): { eligibleAt: number; expiresAt: number } {
  return {
    eligibleAt: now + policy.minVerificationDelayMs,
    expiresAt: now + policy.maxObligationAgeMs,
  };
}
