import { STUDY_STREAM_FLOW_VERSION } from "@/lib/study-stream/contracts";

export interface StudyFlowAssignment {
  flowVersion: "v1" | typeof STUDY_STREAM_FLOW_VERSION;
  reason: "legacy-default" | "internal-allowlist";
}

function parseIds(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 128),
  );
}

/**
 * V2 is deliberately deny-by-default. This allowlist is for internal/test
 * accounts only; it is not a student cohort or research assignment switch.
 */
export function resolveStudyFlowAssignment(
  userId: string,
  internalUserIds = process.env.STUDY_V2_INTERNAL_USER_IDS,
): StudyFlowAssignment {
  if (parseIds(internalUserIds).has(userId)) {
    return { flowVersion: STUDY_STREAM_FLOW_VERSION, reason: "internal-allowlist" };
  }
  return { flowVersion: "v1", reason: "legacy-default" };
}

export function isStudyStreamV2Assigned(
  userId: string,
  internalUserIds = process.env.STUDY_V2_INTERNAL_USER_IDS,
): boolean {
  return resolveStudyFlowAssignment(userId, internalUserIds).flowVersion === STUDY_STREAM_FLOW_VERSION;
}
