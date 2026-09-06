/**
 * Pure contracts shared by the Learning Stream policy, API and UI layers.
 * Keep these values serialisable: the server persists the version bundle with
 * every admission/selection decision so later projections do not silently use
 * today's policy for yesterday's evidence.
 */

export const RETRIEVAL_POLICY_VERSION = "retrieval-v1" as const;
export const OBJECTIVE_QUALITY_POLICY_VERSION = "retrieval-v1-quality-v1" as const;
export const OBJECTIVE_ITEM_CONSTRUCTION_VERSION = "retrieval-v1-mcq-curated-v2" as const;

export type StreamMode = "global" | "unit";

export type StreamItemKind = "LEARNING_CARD" | "OBJECTIVE_PROBE";

export type ProbePurpose =
  | "DUE_REVIEW"
  | "EVIDENCE_OBLIGATION"
  | "OPERATIONAL_DIAGNOSTIC"
  | "RESEARCH_DIAGNOSTIC";

export type WorkKind = "EVIDENCE_OBLIGATION" | "REMEDIATION";

export type WorkStatus =
  | "PENDING"
  | "LEASED"
  | "ANSWERED"
  | "EXPIRED"
  | "CANCELLED"
  | "SUPERSEDED";

export type SelfRating = "selfForgot" | "selfRecalled";

export interface RetrievalPolicyConfig {
  policyVersion: typeof RETRIEVAL_POLICY_VERSION;
  qualityPolicyVersion: typeof OBJECTIVE_QUALITY_POLICY_VERSION;
  itemConstructionVersion: typeof OBJECTIVE_ITEM_CONSTRUCTION_VERSION;
  maxCombinedWorkDebt: number;
  softDebtThreshold: number;
  maxConsecutiveProbes: number;
  minInterveningItems: number;
  minVerificationDelayMs: number;
  maxObligationAgeMs: number;
  /** The simulation-backed v1 service-gap bound. */
  maxEligibleServiceGap: number;
}

export const RETRIEVAL_V1_POLICY: Readonly<RetrievalPolicyConfig> = Object.freeze({
  policyVersion: RETRIEVAL_POLICY_VERSION,
  qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
  itemConstructionVersion: OBJECTIVE_ITEM_CONSTRUCTION_VERSION,
  maxCombinedWorkDebt: 5,
  softDebtThreshold: 3,
  maxConsecutiveProbes: 2,
  minInterveningItems: 2,
  minVerificationDelayMs: 10 * 60 * 1_000,
  maxObligationAgeMs: 24 * 60 * 60 * 1_000,
  maxEligibleServiceGap: 6,
});

export interface WorkRecord {
  id: string;
  learnerId: string;
  wordId: string;
  senseId?: string | null;
  kind: WorkKind;
  status: WorkStatus;
  admittedAt: number;
  eligibleAt: number;
  expiresAt: number;
  lastServedAt?: number | null;
  sourceOperationId?: string | null;
}

export interface CandidateRecord {
  id: string;
  wordId: string;
  senseId?: string | null;
  kind: StreamItemKind;
  purpose?: ProbePurpose;
  workId?: string;
  eligibleAt?: number;
  expiresAt?: number;
  /** A leased item belongs to the current server-pinned session. */
  leasedToCurrentSession?: boolean;
  /** Used by the scheduler to keep a Unit candidate inside its scope. */
  mode?: StreamMode;
  /** Stable learner-facing priority within an urgency tier (lower first). */
  selectionPriority?: number;
  selectionReason: string;
}

export interface SelectionState {
  mode: StreamMode;
  now: number;
  consecutiveProbes: number;
  acknowledgedItemsSinceProbe: number;
  lastWordId?: string | null;
  /** Learner-scoped recent acknowledged words used for spacing. */
  recentWordIds?: readonly string[];
  activeWork: WorkRecord[];
  candidates: CandidateRecord[];
}

export interface SelectionDecision {
  candidate: CandidateRecord | null;
  reason: string;
  overrideReason?: string;
  versionBundle: {
    policyVersion: typeof RETRIEVAL_POLICY_VERSION;
    qualityPolicyVersion: typeof OBJECTIVE_QUALITY_POLICY_VERSION;
    itemConstructionVersion: typeof OBJECTIVE_ITEM_CONSTRUCTION_VERSION;
  };
  candidateCount: number;
  eligibleSetDigestInput: string[];
}

export function isActiveWorkStatus(status: WorkStatus): boolean {
  return status === "PENDING" || status === "LEASED";
}

export function activeWorkCount(work: readonly WorkRecord[]): number {
  return work.filter((record) => isActiveWorkStatus(record.status)).length;
}

export function isWorkEligible(record: WorkRecord, now: number): boolean {
  return (
    isActiveWorkStatus(record.status) &&
    record.eligibleAt <= now &&
    record.expiresAt > now
  );
}
