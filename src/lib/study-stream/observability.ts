export type StudyStreamMetricRoute =
  | "bootstrap"
  | "action"
  | "action-recovery"
  | "credential-renewal";

export type StudyStreamMetricOutcome =
  | "success"
  | "duplicate-replay"
  | "assignment-off"
  | "client-rejected"
  | "auth-rejected"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "unavailable"
  | "server-error";

export interface StudyStreamMetricContext {
  flowVersion?: "v1" | "v2";
  actionKind?: string;
  outcome?: StudyStreamMetricOutcome;
}

export interface StudyStreamMetric {
  metric: "study_stream_request";
  metricVersion: 1;
  route: StudyStreamMetricRoute;
  flowVersion: "v1" | "v2";
  status: number;
  outcome: StudyStreamMetricOutcome;
  durationMs: number;
  actionKind?: string;
}

function statusOutcome(status: number): StudyStreamMetricOutcome {
  if (status >= 200 && status < 300) return "success";
  if (status === 401 || status === 403) return "auth-rejected";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate-limited";
  if (status === 503) return "unavailable";
  if (status >= 400 && status < 500) return "client-rejected";
  return "server-error";
}

export function classifyStudyStreamStatus(status: number): StudyStreamMetricOutcome {
  return statusOutcome(status);
}

function safeActionKind(value: string | undefined): string | undefined {
  if (!value || !/^[A-Z][A-Z0-9_]{0,31}$/.test(value)) return undefined;
  return value;
}

/**
 * Emit only aggregate, allowlisted request metadata. Never pass credentials,
 * operation IDs, user IDs, words, request payloads or exception messages here.
 * Vercel structured logs can ingest this stable shape until a shared metrics
 * backend is approved for production.
 */
export function recordStudyStreamMetric(
  metric: Omit<StudyStreamMetric, "metric" | "metricVersion" | "outcome" | "flowVersion"> &
    Partial<Pick<StudyStreamMetric, "outcome" | "flowVersion">>,
): void {
  const safe: StudyStreamMetric = {
    metric: "study_stream_request",
    metricVersion: 1,
    route: metric.route,
    flowVersion: metric.flowVersion ?? "v2",
    status: metric.status,
    outcome: metric.outcome ?? statusOutcome(metric.status),
    durationMs: Math.max(0, Math.min(Math.round(metric.durationMs), 600_000)),
    ...(safeActionKind(metric.actionKind)
      ? { actionKind: safeActionKind(metric.actionKind) }
      : {}),
  };
  console.info("[study-stream:metric]", JSON.stringify(safe));
}

export async function observeStudyStreamRequest<T extends Response>(
  route: StudyStreamMetricRoute,
  handler: () => Promise<T>,
  getContext: () => StudyStreamMetricContext = () => ({}),
): Promise<T> {
  const startedAt = Date.now();
  try {
    const response = await handler();
    const context = getContext();
    recordStudyStreamMetric({
      route,
      status: response.status,
      durationMs: Date.now() - startedAt,
      flowVersion: context.flowVersion,
      actionKind: context.actionKind,
      outcome: context.outcome,
    });
    return response;
  } catch (error) {
    const context = getContext();
    recordStudyStreamMetric({
      route,
      status: 500,
      durationMs: Date.now() - startedAt,
      flowVersion: context.flowVersion,
      actionKind: context.actionKind,
      outcome: "server-error",
    });
    throw error;
  }
}
