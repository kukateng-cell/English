export type LearningCardState =
  | "PROMPT"
  | "REVEALED"
  | "SUBMITTING"
  | "ACKNOWLEDGED"
  | "NEXT"
  | "SYNC_BLOCKED";

export type ObjectiveProbeState =
  | "PROMPT"
  | "SUBMITTING"
  | "FEEDBACK"
  | "NEXT"
  | "SYNC_BLOCKED";

export type LearningCardEvent =
  | { type: "REVEAL" }
  | { type: "SELF_RATING"; rating: "selfForgot" | "selfRecalled" }
  | { type: "ACKNOWLEDGED" }
  | { type: "SYNC_FAILED" }
  | { type: "RETRY" }
  | { type: "NEXT" };

export type ObjectiveProbeEvent =
  | { type: "SELECT_OPTION"; optionId: string }
  | { type: "ACKNOWLEDGED"; correct: boolean; feedback: string }
  | { type: "SYNC_FAILED" }
  | { type: "RETRY" }
  | { type: "ACK_FEEDBACK" };

export type TransitionFailure = {
  ok: false;
  state: LearningCardState | ObjectiveProbeState;
  error: "INVALID_TRANSITION" | "MISSING_OPTION";
};

export type LearningTransition =
  | { ok: true; state: LearningCardState; rating?: "selfForgot" | "selfRecalled" }
  | TransitionFailure;

export type ProbeTransition =
  | { ok: true; state: ObjectiveProbeState; optionId?: string; correct?: boolean; feedback?: string }
  | TransitionFailure;

function invalid(
  state: LearningCardState | ObjectiveProbeState,
): TransitionFailure {
  return { ok: false, state, error: "INVALID_TRANSITION" };
}

export function transitionLearningCard(
  state: LearningCardState,
  event: LearningCardEvent,
): LearningTransition {
  if (state === "PROMPT" && event.type === "REVEAL") {
    return { ok: true, state: "REVEALED" };
  }
  if (state === "REVEALED" && event.type === "SELF_RATING") {
    return { ok: true, state: "SUBMITTING", rating: event.rating };
  }
  if (state === "SUBMITTING" && event.type === "ACKNOWLEDGED") {
    return { ok: true, state: "ACKNOWLEDGED" };
  }
  if (state === "SUBMITTING" && event.type === "SYNC_FAILED") {
    return { ok: true, state: "SYNC_BLOCKED" };
  }
  if (state === "SYNC_BLOCKED" && event.type === "RETRY") {
    return { ok: true, state: "SUBMITTING" };
  }
  if (state === "ACKNOWLEDGED" && event.type === "NEXT") {
    return { ok: true, state: "NEXT" };
  }
  return invalid(state);
}

export function transitionObjectiveProbe(
  state: ObjectiveProbeState,
  event: ObjectiveProbeEvent,
): ProbeTransition {
  if (state === "PROMPT" && event.type === "SELECT_OPTION") {
    if (!event.optionId) return { ok: false, state, error: "MISSING_OPTION" };
    return { ok: true, state: "SUBMITTING", optionId: event.optionId };
  }
  if (state === "SUBMITTING" && event.type === "ACKNOWLEDGED") {
    return {
      ok: true,
      state: "FEEDBACK",
      correct: event.correct,
      feedback: event.feedback,
    };
  }
  if (state === "SUBMITTING" && event.type === "SYNC_FAILED") {
    return { ok: true, state: "SYNC_BLOCKED" };
  }
  if (state === "SYNC_BLOCKED" && event.type === "RETRY") {
    return { ok: true, state: "SUBMITTING" };
  }
  if (state === "FEEDBACK" && event.type === "ACK_FEEDBACK") {
    return { ok: true, state: "NEXT" };
  }
  return invalid(state);
}
