import type { Quality } from "@/lib/sm2";
import {
  OBJECTIVE_QUALITY_POLICY_VERSION,
  type ProbePurpose,
} from "./types";

export type ObjectiveFirstResponse = "correct" | "wrong";

export interface ObjectiveQualityMapping {
  quality: Quality;
  qualityPolicyVersion: typeof OBJECTIVE_QUALITY_POLICY_VERSION;
}

/**
 * Recognition is weaker evidence than free recall. V1 deliberately maps a
 * valid operational probe to 4/2 and gives no quality to self-rating,
 * reveal-only, timeout or research-only actions.
 */
export function mapObjectiveFirstResponse(
  response: ObjectiveFirstResponse | null,
  purpose: ProbePurpose,
): ObjectiveQualityMapping | null {
  if (response === null || purpose === "RESEARCH_DIAGNOSTIC") return null;
  if (purpose === "OPERATIONAL_DIAGNOSTIC") return null;
  return {
    quality: response === "correct" ? 4 : 2,
    qualityPolicyVersion: OBJECTIVE_QUALITY_POLICY_VERSION,
  };
}
