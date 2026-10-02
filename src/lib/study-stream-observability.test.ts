import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStudyStreamStatus,
  observeStudyStreamRequest,
  recordStudyStreamMetric,
} from "@/lib/study-stream/observability";

test("study stream status classification provides stable operational buckets", () => {
  assert.equal(classifyStudyStreamStatus(200), "success");
  assert.equal(classifyStudyStreamStatus(403), "auth-rejected");
  assert.equal(classifyStudyStreamStatus(404), "not-found");
  assert.equal(classifyStudyStreamStatus(409), "conflict");
  assert.equal(classifyStudyStreamStatus(429), "rate-limited");
  assert.equal(classifyStudyStreamStatus(503), "unavailable");
  assert.equal(classifyStudyStreamStatus(500), "server-error");
});

test("structured study metrics omit identity, credentials and exception details", async () => {
  const messages: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    messages.push(args.map((value) => String(value)).join(" "));
  };
  try {
    const response = await observeStudyStreamRequest(
      "action",
      async () => new Response(null, { status: 200 }),
      () => ({ flowVersion: "v2", actionKind: "OBJECTIVE_ANSWER", outcome: "success" }),
    );
    assert.equal(response.status, 200);
    recordStudyStreamMetric({
      route: "action",
      status: 409,
      durationMs: 12.4,
      actionKind: "FEEDBACK_ACK",
      outcome: "conflict",
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(messages.length, 2);
  for (const message of messages) {
    const json = JSON.parse(message.slice(message.indexOf("{") )) as Record<string, unknown>;
    assert.equal(json.metric, "study_stream_request");
    assert.equal(json.metricVersion, 1);
    assert.equal("userId" in json, false);
    assert.equal("operationId" in json, false);
    assert.equal("itemCredential" in json, false);
    assert.equal("errorMessage" in json, false);
  }
});
