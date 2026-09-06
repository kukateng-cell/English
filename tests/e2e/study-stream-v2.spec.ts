import { expect, test } from "@playwright/test";
import type { PublicStreamResponse, StudyStreamActionInput } from "../../src/lib/study-stream/contracts";

for (const actionKind of ["REVEAL", "OBJECTIVE_ANSWER"] as const) {
  test(`late ${actionKind} receipt from unit A cannot overwrite unit B`, async ({ page }) => {
    let firstRequest = true;
    let replayed = false;
    const actions: StudyStreamActionInput[] = [];
    const objective = actionKind === "OBJECTIVE_ANSWER";
    await page.route("**/api/study/stream**", async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("assignmentOnly")) return route.continue();
      const unit = url.searchParams.get("category") === "actions" ? "B" : "A";
      const response: PublicStreamResponse = {
        ok: true, assigned: true, resumedFeedback: false,
        session: { id: `session-${unit}`, mode: "unit", flowVersion: "v2", policyVersion: "retrieval-v1", revision: unit === "B" ? 7 : 0, expiresAt: new Date(Date.now() + 1800000).toISOString() },
        item: {
          streamItemId: `stream-item-${unit}`, kind: objective ? "OBJECTIVE_PROBE" : "LEARNING_CARD",
          flowVersion: "v2", policyVersion: "retrieval-v1", qualityPolicyVersion: "retrieval-v1-quality-v1",
          itemConstructionVersion: "retrieval-v1-mcq-curated-v2", selectionReason: "audit-test",
          itemCredential: `credential-${unit}-012345678901234567890123456789`,
          credentialExpiresAt: new Date(Date.now() + 900000).toISOString(), clientRevision: unit === "B" ? 7 : 0,
          prompt: unit === "A" ? "apple" : "banana",
          ...(objective ? { objectiveQuestion: { prompt: unit === "A" ? "apple" : "banana", direction: "en-zh" as const, itemConstructionVersion: "retrieval-v1-mcq-curated-v2", options: [1, 2, 3, 4].map(i => ({ id: `${unit}-${i}`, text: `${unit} option ${i}` })) } } : {}),
        },
      };
      await route.fulfill({ json: response });
    });
    await page.route("**/api/study/actions", async route => {
      const action = route.request().postDataJSON() as StudyStreamActionInput;
      actions.push(action);
      if (firstRequest) {
        firstRequest = false;
        // Simulate a committed operation whose network response was lost.
        await route.abort("failed");
        return;
      }
      replayed = true;
      await route.fulfill({ json: {
        ok: true, operationId: action.operationId, actionKind, duplicate: true, itemStatus: objective ? "ANSWERED" : "REVEALED",
        clientRevision: 2, requiresFeedbackAck: objective, nextItem: null,
        ...(objective ? { feedback: { selectedOptionId: "A-1", correctOptionId: "A-2", quality: 2, isCorrect: false, acknowledged: false } }
          : { learningCard: { term: "apple", definition: "蘋果", phonetic: null, pos: null, examples: [] } }),
      } });
    });
    await page.goto("/study?mode=unit&level=A1&category=daily-life");
    if (objective) {
      await page.getByText("A option 1", { exact: true }).click();
    } else {
      const hint = page.getByTestId("word-card-hint");
      await expect(hint).toBeVisible();
      const box = (await hint.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.waitForTimeout(3250); await page.mouse.up();
    }
    const alert = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "重試" }) });
    await expect(alert).toBeVisible();
    await page.goto("/study?mode=unit&level=A1&category=actions");
    await expect(page.getByText("banana", { exact: true }).first()).toBeVisible();
    await alert.getByRole("button", { name: "重試" }).click();
    await expect.poll(() => replayed).toBe(true);
    await expect(alert).toHaveCount(0);
    await expect(page.getByText("banana", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("apple", { exact: true })).toHaveCount(0);
    if (objective) {
      await expect(page.getByRole("radio", { name: "B option 1" })).not.toBeChecked();
      await expect(page.getByTestId("study-stream-feedback-affordance")).not.toHaveClass(/is-visible/);
      await expect(page.getByRole("radio", { name: "B option 1" })).toBeEnabled();
    } else {
      await expect(page.getByTestId("word-card-flip")).toHaveAttribute("data-flipped", "false");
    }
    const state = await page.evaluate(() => ({
      checkpoints: Object.keys(localStorage).filter(key => key.includes("study-stream-v2:checkpoint:") && key.endsWith("A1::actions")).map(key => JSON.parse(localStorage.getItem(key)!)),
      outboxes: Object.keys(localStorage).filter(key => key.includes("study-stream-v2:outbox:")).map(key => JSON.parse(localStorage.getItem(key)!)),
    }));
    expect(state.checkpoints).toHaveLength(1);
    expect(state.checkpoints[0]).toMatchObject({ sessionId: "session-B", streamItemId: "stream-item-B", clientRevision: 7, phase: objective ? "objective-probe" : "learning-card" });
    expect(state.outboxes.flat()).toEqual([]);
    expect(actions).toHaveLength(2);
    expect(actions[1].operationId).toBe(actions[0].operationId);
  });
}

test("an expired session resumes read-only Objective Probe feedback before scheduling", async ({ page }) => {
  const sessionId = "expired-feedback-session";
  const streamItemId = "expired-feedback-item";
  const itemCredential = "expired-feedback-credential-012345678901234567890123456789";
  const actions: StudyStreamActionInput[] = [];
  let answered = false;
  let feedbackAcknowledged = false;

  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("assignmentOnly")) return route.continue();
    const pendingFeedback = answered && !feedbackAcknowledged;
    const response: PublicStreamResponse = pendingFeedback ? {
      ok: true,
      assigned: true,
      resumedFeedback: true,
      session: {
        id: sessionId,
        mode: "global",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        revision: 1,
        // The server deliberately returns the expired source session while
        // the learner confirms its read-only feedback.
        expiresAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
      item: {
        streamItemId,
        kind: "OBJECTIVE_PROBE",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
        selectionReason: "audit-expired-feedback",
        itemCredential,
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        clientRevision: 1,
        prompt: "apple",
        objectiveQuestion: {
          prompt: "apple",
          direction: "en-zh",
          itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
          options: [1, 2, 3, 4].map((index) => ({ id: `option-${index}`, text: `選項 ${index}` })),
        },
        feedback: {
          selectedOptionId: "option-1",
          correctOptionId: "option-2",
          quality: 2,
          isCorrect: false,
          acknowledged: false,
        },
      },
    } : {
      ok: true,
      assigned: true,
      resumedFeedback: false,
      session: {
        id: sessionId,
        mode: "global",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        revision: 0,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
      item: feedbackAcknowledged ? {
        streamItemId: "next-item",
        kind: "LEARNING_CARD",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
        selectionReason: "audit-expired-feedback",
        itemCredential: "next-credential-012345678901234567890123456789",
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        clientRevision: 2,
        prompt: "banana",
      } : {
        streamItemId,
        kind: "OBJECTIVE_PROBE",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
        selectionReason: "audit-expired-feedback",
        itemCredential,
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        clientRevision: 0,
        prompt: "apple",
        objectiveQuestion: {
          prompt: "apple",
          direction: "en-zh",
          itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
          options: [1, 2, 3, 4].map((index) => ({ id: `option-${index}`, text: `選項 ${index}` })),
        },
      },
    };
    await route.fulfill({ json: response });
  });

  await page.route("**/api/study/actions", async (route) => {
    const action = route.request().postDataJSON() as StudyStreamActionInput;
    actions.push(action);
    if (action.actionKind === "OBJECTIVE_ANSWER") {
      answered = true;
      await route.fulfill({ json: {
        ok: true,
        operationId: action.operationId,
        actionKind: action.actionKind,
        duplicate: false,
        itemStatus: "ANSWERED",
        clientRevision: 1,
        requiresFeedbackAck: true,
        feedback: { selectedOptionId: "option-1", correctOptionId: "option-2", quality: 2, isCorrect: false, acknowledged: false },
        nextItem: null,
      } });
      return;
    }
    feedbackAcknowledged = true;
    await route.fulfill({ json: {
      ok: true,
      operationId: action.operationId,
      actionKind: action.actionKind,
      duplicate: false,
      itemStatus: "ACKNOWLEDGED",
      clientRevision: 2,
      requiresFeedbackAck: false,
      feedback: { selectedOptionId: "option-1", correctOptionId: "option-2", quality: 2, isCorrect: false, acknowledged: true },
      nextItem: null,
    } });
  });

  await page.goto("/study");
  await page.getByRole("radio", { name: "選項 1" }).locator("xpath=..").click();
  await expect(page.getByTestId("study-stream-feedback-affordance")).toHaveClass(/is-visible/);
  await expect(page.getByTestId("study-stream-probe-card")).toHaveAttribute("role", "button");
  await expect(page.getByTestId("study-stream-probe-card")).toHaveAttribute("aria-label", "輕點一下任意區域");
  await page.getByTestId("study-stream-probe-card").click({ position: { x: 48, y: 48 } });
  await expect.poll(() => actions.some((action) => action.actionKind === "FEEDBACK_ACK")).toBe(true);
  const ack = actions.find((action) => action.actionKind === "FEEDBACK_ACK");
  expect(ack?.studySessionId).toBe(sessionId);
  expect(ack?.streamItemId).toBe(streamItemId);
  await expect(page.getByText("banana", { exact: true })).toBeVisible();
  await expect(page.getByTestId("study-stream-feedback-affordance")).toHaveCount(0);
});

test("an older bootstrap generation cannot roll back the current item revision", async ({ page }) => {
  let calls = 0;
  let releaseOld!: () => void;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  let releaseUnmounted!: () => void;
  const unmountedGate = new Promise<void>(resolve => { releaseUnmounted = resolve; });
  await page.route("**/api/study/stream**", async route => {
    if (new URL(route.request().url()).searchParams.has("assignmentOnly")) return route.continue();
    const call = ++calls;
    if (call === 2) await oldGate;
    if (call === 4) await unmountedGate;
    const revision = call === 2 || call === 4 ? 1 : call >= 3 ? 9 : 7;
    const response: PublicStreamResponse = {
      ok: true, assigned: true, resumedFeedback: false,
      session: { id: "generation-session", flowVersion: "v2", mode: "global", policyVersion: "retrieval-v1", revision, expiresAt: new Date(Date.now() + 1800000).toISOString() },
      item: { streamItemId: "generation-item", flowVersion: "v2", kind: "LEARNING_CARD", policyVersion: "retrieval-v1", qualityPolicyVersion: "retrieval-v1-quality-v1", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", selectionReason: "audit-generation", prompt: `revision-${revision}`, clientRevision: revision, itemCredential: "generation-credential-012345678901234567890", credentialExpiresAt: new Date(Date.now() + 900000).toISOString() },
    };
    await route.fulfill({ json: response, headers: { "x-audit-generation": String(call) } });
  });
  await page.goto("/study");
  await expect(page.getByText("revision-7", { exact: true }).first()).toBeVisible();
  const reload = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.includes("study-stream-v2:checkpoint:") && key.endsWith(":global"));
    if (!key) throw new Error("missing checkpoint");
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  await reload();
  await expect.poll(() => calls).toBe(2);
  await reload();
  await expect(page.getByText("revision-9", { exact: true }).first()).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.headers()["x-audit-generation"] === "2");
  releaseOld();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText("revision-9", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("revision-1", { exact: true })).toHaveCount(0);
  const revisions = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes("study-stream-v2:checkpoint:") && key.endsWith(":global")).map(key => JSON.parse(localStorage.getItem(key)!).clientRevision));
  expect(revisions).toEqual([9]);

  await reload();
  await expect.poll(() => calls).toBe(4);
  // Client-side navigation unmounts this stream without destroying the
  // document, so its pending fetch could otherwise still write localStorage.
  await page.locator('a[href="/words"]').first().click();
  await expect(page).toHaveURL(/\/words$/);
  const unmountedResponse = page.waitForResponse(response => response.headers()["x-audit-generation"] === "4");
  releaseUnmounted();
  await (await unmountedResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterUnmount = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes("study-stream-v2:checkpoint:") && key.endsWith(":global")).map(key => JSON.parse(localStorage.getItem(key)!).clientRevision));
  expect(afterUnmount).toEqual([9]);
});

test("a committed action with a failed refresh locks the old item until GET retry", async ({ page }) => {
  let initialServed = false;
  let refreshFailures = 0;
  let retryRefreshStarted = false;
  let releaseRetryRefresh!: () => void;
  const retryRefreshGate = new Promise<void>(resolve => { releaseRetryRefresh = resolve; });
  let actionCount = 0;
  await page.route("**/api/study/stream**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("assignmentOnly")) return route.continue();
    if (!initialServed) {
      initialServed = true;
      const response: PublicStreamResponse = {
        ok: true, assigned: true, resumedFeedback: false,
        session: { id: "refresh-session", mode: "unit", flowVersion: "v2", policyVersion: "retrieval-v1", revision: 0, expiresAt: new Date(Date.now() + 1800000).toISOString() },
        item: {
          streamItemId: "refresh-item-A", kind: "OBJECTIVE_PROBE", flowVersion: "v2", policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality-v1", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", selectionReason: "audit-refresh",
          itemCredential: "refresh-credential-A-012345678901234567890123456789", credentialExpiresAt: new Date(Date.now() + 900000).toISOString(),
          clientRevision: 0, prompt: "apple",
          objectiveQuestion: { prompt: "apple", direction: "en-zh", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", options: [1, 2, 3, 4].map(i => ({ id: `A-${i}`, text: `A option ${i}` })) },
        },
      };
      await route.fulfill({ json: response });
      return;
    }
    if (refreshFailures < 1) {
      refreshFailures += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary refresh failure" }) });
      return;
    }
    if (!retryRefreshStarted) {
      retryRefreshStarted = true;
      await retryRefreshGate;
    }
    const response: PublicStreamResponse = {
      ok: true, assigned: true, resumedFeedback: false,
      session: { id: "refresh-session", mode: "unit", flowVersion: "v2", policyVersion: "retrieval-v1", revision: 1, expiresAt: new Date(Date.now() + 1800000).toISOString() },
      item: {
        streamItemId: "refresh-item-B", kind: "LEARNING_CARD", flowVersion: "v2", policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", selectionReason: "audit-refresh",
        itemCredential: "refresh-credential-B-012345678901234567890123456789", credentialExpiresAt: new Date(Date.now() + 900000).toISOString(),
        clientRevision: 1, prompt: "banana",
      },
    };
    await route.fulfill({ json: response });
  });
  await page.route("**/api/study/actions", async route => {
    actionCount += 1;
    const action = route.request().postDataJSON() as StudyStreamActionInput;
    await route.fulfill({ json: {
      ok: true, operationId: action.operationId, actionKind: action.actionKind, duplicate: false,
      itemStatus: "ANSWERED", clientRevision: 1, requiresFeedbackAck: true, nextItem: null,
      feedback: { selectedOptionId: "A-1", correctOptionId: "A-2", quality: 2, isCorrect: false, acknowledged: false },
    } });
  });

  await page.goto("/study?mode=unit&level=A1&category=daily-life");
  await expect(page.getByRole("radio", { name: "A option 1" })).toBeEnabled();
  await page.getByText("A option 1", { exact: true }).click();
  await expect(page.getByTestId("study-stream-refresh-pending")).toBeVisible();
  await expect(page.getByRole("radio", { name: "A option 1" })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => retryRefreshStarted).toBe(true);
  // Simulate another tab enqueueing while the refresh is in flight. The
  // storage event is intentionally ignored while actionPending is true; the
  // retrySync refresh must drain this row after its GET succeeds.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(candidate => candidate.startsWith("english:study-stream-v2:outbox:"));
    if (!key) throw new Error("missing V2 outbox");
    const rows = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
    rows.push({
      action: {
        flowVersion: "v2",
        studySessionId: "refresh-session",
        streamItemId: "refresh-item-A",
        operationId: "refresh-cross-tab-pending",
        itemCredential: "refresh-credential-A-012345678901234567890123456789",
        actionKind: "REVEAL",
        clientKnownRevision: 0,
        payload: {},
      },
      status: "pending",
      attempts: 0,
      lastError: null,
      updatedAt: Date.now(),
    });
    localStorage.setItem(key, JSON.stringify(rows));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  releaseRetryRefresh();
  await expect(page.getByText("banana", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("study-stream-refresh-pending")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("english:study-stream-v2:outbox:"))
    .flatMap((key) => JSON.parse(localStorage.getItem(key) ?? "[]")))).toEqual([]);
  expect(actionCount).toBe(2);
});

test("a terminal objective conflict removes only its outbox row and refreshes the current item", async ({ page }) => {
  let initialServed = false;
  let conflictReleased!: () => void;
  const conflictGate = new Promise<void>(resolve => { conflictReleased = resolve; });
  let actionCount = 0;
  await page.route("**/api/study/stream**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("assignmentOnly")) return route.continue();
    if (!initialServed) {
      initialServed = true;
      const response: PublicStreamResponse = {
        ok: true, assigned: true, resumedFeedback: false,
        session: { id: "terminal-session", mode: "global", flowVersion: "v2", policyVersion: "retrieval-v1", revision: 0, expiresAt: new Date(Date.now() + 1800000).toISOString() },
        item: {
          streamItemId: "terminal-item-A", kind: "OBJECTIVE_PROBE", flowVersion: "v2", policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality-v1", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", selectionReason: "audit-terminal",
          itemCredential: "terminal-credential-A-012345678901234567890123456789", credentialExpiresAt: new Date(Date.now() + 900000).toISOString(),
          clientRevision: 0, prompt: "apple",
          objectiveQuestion: { prompt: "apple", direction: "en-zh", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", options: [1, 2, 3, 4].map(i => ({ id: `A-${i}`, text: `A option ${i}` })) },
        },
      };
      await route.fulfill({ json: response });
      return;
    }
    const response: PublicStreamResponse = {
      ok: true, assigned: true, resumedFeedback: false,
      session: { id: "terminal-session", mode: "global", flowVersion: "v2", policyVersion: "retrieval-v1", revision: 1, expiresAt: new Date(Date.now() + 1800000).toISOString() },
      item: {
        streamItemId: "terminal-item-B", kind: "LEARNING_CARD", flowVersion: "v2", policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1", itemConstructionVersion: "retrieval-v1-mcq-curated-v2", selectionReason: "audit-terminal",
        itemCredential: "terminal-credential-B-012345678901234567890123456789", credentialExpiresAt: new Date(Date.now() + 900000).toISOString(),
        clientRevision: 1, prompt: "banana",
      },
    };
    await route.fulfill({ json: response });
  });
  await page.route("**/api/study/actions", async route => {
    actionCount += 1;
    await conflictGate;
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "該客觀證據目標已經完成", code: "OBJECTIVE_TARGET_CONSUMED" }) });
  });

  await page.goto("/study");
  await page.getByText("A option 1", { exact: true }).click();
  await expect.poll(() => actionCount).toBe(1);
  const outboxRowsBeforeRelease = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(candidate => candidate.startsWith("english:study-stream-v2:outbox:"));
    if (!key) throw new Error("missing V2 outbox");
    const rows = JSON.parse(localStorage.getItem(key)!) as unknown[];
    rows.push({
      action: {
        flowVersion: "v2", studySessionId: "secondary-session", streamItemId: "secondary-item",
        operationId: "secondary-operation", itemCredential: "secondary-credential-012345678901234567890123456789",
        actionKind: "REVEAL", clientKnownRevision: 0, payload: {},
      },
      status: "pending", attempts: 0, lastError: null, updatedAt: Date.now(),
    });
    localStorage.setItem(key, JSON.stringify(rows));
    return rows.length;
  });
  expect(outboxRowsBeforeRelease).toBe(2);
  conflictReleased();
  await expect(page.getByText("banana", { exact: true }).first()).toBeVisible();
  await expect.poll(() => actionCount).toBe(1);
  const outboxRowsAfterRelease = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(candidate => candidate.startsWith("english:study-stream-v2:outbox:"));
    if (!key) throw new Error("missing V2 outbox");
    return JSON.parse(localStorage.getItem(key)!) as unknown[];
  });
  expect(outboxRowsAfterRelease).toHaveLength(1);
  await expect(page.getByTestId("study-stream-refresh-pending")).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "尚未同步" })).toHaveCount(0);
});

test("one outbox trigger drains every pending action and resumes after a temporary error", async ({ page }) => {
  let streamCalls = 0;
  let actionCalls = 0;
  let temporaryFailure = true;
  const sessionId = "drain-session";
  const itemCredential = "drain-credential-012345678901234567890123456789";
  const makeAction = (operationId: string): StudyStreamActionInput => ({
    flowVersion: "v2",
    studySessionId: sessionId,
    streamItemId: "drain-item",
    operationId,
    itemCredential,
    actionKind: "REVEAL",
    clientKnownRevision: 0,
    payload: {},
  });

  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("assignmentOnly")) return route.continue();
    streamCalls += 1;
    const response: PublicStreamResponse = {
      ok: true,
      assigned: true,
      resumedFeedback: false,
      session: {
        id: sessionId,
        mode: "global",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        revision: 0,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      },
      item: {
        streamItemId: "drain-item",
        kind: "LEARNING_CARD",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
        selectionReason: "audit-drain",
        itemCredential,
        credentialExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        clientRevision: 0,
        prompt: "drain",
      },
    };
    await route.fulfill({ json: response });
  });

  await page.route("**/api/study/actions", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname !== "/api/study/actions") return route.continue();
    actionCalls += 1;
    const action = request.postDataJSON() as StudyStreamActionInput;
    if (action.operationId === "drain-op-2" && temporaryFailure) {
      temporaryFailure = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary sync failure" }),
      });
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        operationId: action.operationId,
        actionKind: action.actionKind,
        duplicate: false,
        itemStatus: "REVEALED",
        clientRevision: 0,
        requiresFeedbackAck: false,
        nextItem: null,
      },
    });
  });

  await page.goto("/study");
  await expect(page.getByText("drain", { exact: true }).first()).toBeVisible();
  const authSession = await page.request.get("/api/auth/session");
  const authPayload = await authSession.json() as { user?: { id?: string } };
  const userId = authPayload.user?.id;
  if (!userId) throw new Error("missing authenticated user id");
  const outboxKey = `english:study-stream-v2:outbox:${userId}`;
  await page.evaluate(({ key, actions }) => {
    localStorage.setItem(key, JSON.stringify(actions.map((action) => ({
      action,
      status: "pending",
      attempts: 0,
      lastError: null,
      updatedAt: Date.now(),
    }))));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, { key: outboxKey, actions: [makeAction("drain-op-1"), makeAction("drain-op-2"), makeAction("drain-op-3")] });

  // One storage trigger drains the first row, then stops at the temporary
  // failure while preserving the third row for a later retry.
  await expect.poll(() => actionCalls).toBe(2);
  await expect(page.getByRole("alert").filter({ has: page.getByRole("button", { name: "重試" }) })).toBeVisible();
  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").map((row: { action: StudyStreamActionInput; status: string }) => `${row.action.operationId}:${row.status}`), outboxKey)).toEqual([
    "drain-op-2:blocked",
    "drain-op-3:pending",
  ]);

  await page.getByRole("alert").filter({ has: page.getByRole("button", { name: "重試" }) }).getByRole("button", { name: "重試" }).click();
  await expect.poll(() => actionCalls).toBe(4);
  await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), outboxKey)).toEqual([]);
  await expect(page.getByRole("alert").filter({ has: page.getByRole("button", { name: "重試" }) })).toHaveCount(0);
  expect(streamCalls).toBeGreaterThanOrEqual(4);
});

for (const actionKind of ["REVEAL", "SELF_RATING"] as const) {
  test(`late ${actionKind} completion conflict is removed from the outbox`, async ({ page }) => {
    let actionCalls = 0;
    const sessionId = `terminal-${actionKind.toLowerCase()}-session`;
    const itemCredential = `terminal-${actionKind.toLowerCase()}-credential-012345678901234567890123456789`;
    await page.route("**/api/study/stream**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("assignmentOnly")) return route.continue();
      const response: PublicStreamResponse = {
        ok: true,
        assigned: true,
        resumedFeedback: false,
        session: {
          id: sessionId,
          mode: "global",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          revision: 0,
          expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
        },
        item: {
          streamItemId: `terminal-${actionKind.toLowerCase()}-item`,
          kind: "LEARNING_CARD",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality-v1",
          itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
          selectionReason: "audit-terminal-learning-card",
          itemCredential,
          credentialExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          clientRevision: 0,
          prompt: "terminal",
          ...(actionKind === "SELF_RATING"
            ? { learningCard: { term: "terminal", phonetic: null, definition: "終結", pos: null, examples: [] } }
            : {}),
        },
      };
      await route.fulfill({ json: response });
    });
    await page.route("**/api/study/actions", async (route) => {
      if (new URL(route.request().url()).pathname !== "/api/study/actions") return route.continue();
      actionCalls += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "學習項目已由其他操作完成", code: "STREAM_ITEM_COMPLETED" }),
      });
    });

    await page.goto("/study");
    if (actionKind === "SELF_RATING") {
      await page.getByRole("button", { name: "和剛才想的一樣" }).click();
    } else {
      const authSession = await page.request.get("/api/auth/session");
      const authPayload = await authSession.json() as { user?: { id?: string } };
      const userId = authPayload.user?.id;
      if (!userId) throw new Error("missing authenticated user id");
      const key = `english:study-stream-v2:outbox:${userId}`;
      const action: StudyStreamActionInput = {
        flowVersion: "v2",
        studySessionId: sessionId,
        streamItemId: "terminal-reveal-item",
        operationId: "terminal-reveal-op",
        itemCredential,
        actionKind: "REVEAL",
        clientKnownRevision: 0,
        payload: {},
      };
      await page.evaluate(({ key, action }) => {
        localStorage.setItem(key, JSON.stringify([{ action, status: "pending", attempts: 0, lastError: null, updatedAt: Date.now() }]));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      }, { key, action });
    }
    await expect.poll(() => actionCalls).toBe(1);
    await expect.poll(async () => page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith("english:study-stream-v2:outbox:"))
      .flatMap((key) => JSON.parse(localStorage.getItem(key) ?? "[]")))).toEqual([]);
    await expect(page.getByRole("alert").filter({ has: page.getByRole("button", { name: "重試" }) })).toHaveCount(0);
  });
}

test("local all-user assignment serves the V2 stream", async ({ page }) => {
  const response = await page.request.get("/api/study/stream?assignmentOnly=1");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, assigned: true, flowVersion: "v2" });
});

test("V2 gives a retrieval opportunity before Learning Card self-rating", async ({ page }) => {
  await page.goto("/study");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const card = page.getByTestId("word-card-drag-layer");
    const flip = page.getByTestId("word-card-flip");
    const selfRecall = page.getByRole("button", { name: "和剛才想的一樣" });
    if (await card.isVisible().catch(() => false)) {
      const isFlipped = await flip.getAttribute("data-flipped");
      if (isFlipped === "false") {
        const front = page.getByTestId("word-card-front");
        const term = (await front.locator(".word-card-term").textContent())?.trim() ?? "";
        await expect(page.getByTestId("study-stream-title")).toHaveText("連續學習");
        await expect(page.getByTestId("word-card-context")).toHaveText("認");
        await expect(page.getByTestId("word-card-context")).toHaveAttribute("aria-label", "認讀卡");
        const contextAlignment = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>('[data-testid="word-card-drag-layer"]');
          const context = document.querySelector<HTMLElement>('[data-testid="word-card-context"]');
          if (!card || !context) return null;
          const cardRect = card.getBoundingClientRect();
          const contextRect = context.getBoundingClientRect();
          return {
            contextCenterX: contextRect.left + contextRect.width / 2,
            contextCenterY: contextRect.top + contextRect.height / 2,
            targetCenterX: cardRect.right - contextRect.width / 2,
            targetCenterY: cardRect.top + contextRect.height / 2,
          };
        });
        expect(contextAlignment).not.toBeNull();
        expect(Math.abs((contextAlignment?.contextCenterX ?? 0) - (contextAlignment?.targetCenterX ?? 0))).toBeLessThanOrEqual(2);
        expect(Math.abs((contextAlignment?.contextCenterY ?? 0) - (contextAlignment?.targetCenterY ?? 0))).toBeLessThanOrEqual(2);
        await expect(page.getByTestId("word-card-level")).toBeVisible();
        await expect(front.getByTestId("word-card-phonetic")).toHaveCount(1);
        await expect(front.getByRole("button", { name: "發音" })).toContainText("發音");
        await expect(card).toHaveRole("button");
        await expect(card).toHaveAttribute("aria-label", "單詞卡，請長按 3 秒揭示答案");
        await expect(card).not.toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
        const hint = page.getByTestId("word-card-hint");
        const secondaryHint = page.getByTestId("word-card-secondary-hint");
        const secondaryHintSlot = page.getByTestId("word-card-secondary-hint-slot");
        const indicator = page.getByTestId("word-card-long-press-indicator");
        await expect(indicator).toHaveCount(1);
        await expect(secondaryHint).toHaveCount(0);
        await expect(secondaryHintSlot).toHaveCSS("height", "52px");
        await expect(secondaryHintSlot).toHaveCSS("opacity", "0");
        await expect(page.getByTestId("word-card-queue-note")).toHaveCount(0);
        await expect(hint).toHaveClass(/word-card-retrieval-hint/);
        await expect(hint).toHaveClass(/is-think-hint/);
        await expect(hint).toHaveText("先試著想一想這個詞的中文意思");
        const hintAnimation = await hint.evaluate((element) => getComputedStyle(element).animationDuration);
        expect(Number.parseFloat(hintAnimation)).toBeGreaterThanOrEqual(4);
        const earlyTermBox = await front.locator(".word-card-term").boundingBox();
        const earlyPhoneticBox = await front.getByTestId("word-card-phonetic").boundingBox();
        const earlyHintBox = await hint.boundingBox();
        const earlySpeakerBox = await front.getByRole("button", { name: "發音" }).boundingBox();
        const assertStableY = (
          before: { y: number; height: number } | null,
          after: { y: number; height: number } | null,
        ) => {
          expect(before).not.toBeNull();
          expect(after).not.toBeNull();
          if (!before || !after) return;
          expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
        };
        expect(earlyPhoneticBox).not.toBeNull();
        expect(earlyHintBox).not.toBeNull();
        expect(earlySpeakerBox).not.toBeNull();
        if (earlyTermBox && earlyPhoneticBox) {
          expect(earlyPhoneticBox.y).toBeGreaterThanOrEqual(earlyTermBox.y + earlyTermBox.height);
        }
        if (earlyPhoneticBox && earlyHintBox) {
          expect(earlyHintBox.y).toBeGreaterThanOrEqual(earlyPhoneticBox.y + earlyPhoneticBox.height);
        }
        await page.mouse.move(
          (earlyHintBox?.x ?? 0) + (earlyHintBox?.width ?? 0) / 2,
          (earlyHintBox?.y ?? 0) + (earlyHintBox?.height ?? 0) / 2,
        );
        await page.mouse.down();
        await page.waitForTimeout(1_150);
        await expect(hint).toHaveText("先試著想一想這個詞的中文意思");
        await expect(secondaryHint).toHaveText("長按 3 秒揭示答案");
        await expect(secondaryHint).toHaveClass(/is-long-press-hint/);
        await expect(secondaryHintSlot).toHaveClass(/is-visible/);
        const latePhoneticBox = await front.getByTestId("word-card-phonetic").boundingBox();
        const lateHintBox = await hint.boundingBox();
        const lateSpeakerBox = await front.getByRole("button", { name: "發音" }).boundingBox();
        assertStableY(earlyPhoneticBox, latePhoneticBox);
        assertStableY(earlyHintBox, lateHintBox);
        assertStableY(earlySpeakerBox, lateSpeakerBox);
        const secondaryHintAnimation = await secondaryHint.evaluate((element) => getComputedStyle(element).animationDuration);
        expect(Number.parseFloat(secondaryHintAnimation)).toBeGreaterThanOrEqual(4);
        const speakerBox = lateSpeakerBox;
        const secondaryHintBox = await secondaryHint.boundingBox();
        expect(speakerBox).not.toBeNull();
        expect(secondaryHintBox).not.toBeNull();
        expect(secondaryHintBox?.y ?? 0).toBeGreaterThan((speakerBox?.y ?? 0) + (speakerBox?.height ?? 0));
        const secondaryHintTransition = await secondaryHintSlot.evaluate((element) => getComputedStyle(element).transitionDuration);
        expect(Number.parseFloat(secondaryHintTransition)).toBeGreaterThan(0);
        await expect(indicator).toHaveClass(/is-active/);
        await page.mouse.up();
        await expect(indicator).not.toHaveClass(/is-active/);
        await expect(hint).toHaveText("先試著想一想這個詞的中文意思");
        await expect(secondaryHint).toHaveText("長按 3 秒揭示答案");
        await expect(page.getByTestId("study-stream-self-rating-actions")).toHaveCount(0);

        await front.getByRole("button", { name: "發音" }).click();
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await expect(page.getByTestId("word-card-back-face")).toHaveCount(0);

        await hint.click();
        await expect(flip).toHaveAttribute("data-flipped", "false");

        const hintBox = await hint.boundingBox();
        expect(hintBox).not.toBeNull();
        const holdX = (hintBox?.x ?? 0) + (hintBox?.width ?? 0) / 2;
        const holdY = (hintBox?.y ?? 0) + (hintBox?.height ?? 0) / 2;
        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(450);
        await expect(indicator).toHaveClass(/is-active/);
        const firstHoldVisual = await indicator.evaluate((element) => ({
          progress: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-progress")),
          pulseDuration: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-pulse-duration")),
        }));
        await page.waitForTimeout(450);
        const secondHoldVisual = await indicator.evaluate((element) => ({
          progress: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-progress")),
          pulseDuration: Number.parseFloat(element.style.getPropertyValue("--word-card-hold-pulse-duration")),
        }));
        expect(secondHoldVisual.progress).toBeGreaterThan(firstHoldVisual.progress);
        expect(secondHoldVisual.pulseDuration).toBeLessThan(firstHoldVisual.pulseDuration);
        await page.mouse.up();
        await expect(indicator).not.toHaveClass(/is-active/);

        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(2_100);
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await page.mouse.up();

        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(1_200);
        await page.mouse.move(holdX + 20, holdY);
        await page.waitForTimeout(2_100);
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await expect(indicator).not.toHaveClass(/is-active/);
        await page.mouse.up();

        await page.mouse.move(holdX, holdY);
        await page.mouse.down();
        await page.waitForTimeout(2_900);
        await expect(flip).toHaveAttribute("data-flipped", "false");
        await page.waitForTimeout(250);
        await expect(flip).toHaveAttribute("data-flipped", "true");
        const back = page.getByTestId("word-card-back-face");
        await expect(back).toBeVisible();
        await expect(back.locator(".word-card-term")).toHaveText(term);
        await expect(back.getByTestId("word-card-phonetic")).toHaveCount(1);
        await expect(back.locator(".word-card-answer-content")).toContainText("中文意思");
        // Measure after the 3D flip settles; a mid-animation bounding box is
        // perspective-projected and does not represent final alignment.
        await expect.poll(async () => back.evaluate((element) => {
          const content = element.querySelector<HTMLElement>(".word-card-answer-content")!;
          const definition = element.querySelector<HTMLElement>(".word-card-answer-definition")!;
          const a = content.getBoundingClientRect();
          const b = definition.getBoundingClientRect();
          return Math.abs(a.left + a.width / 2 - b.left - b.width / 2);
        })).toBeLessThanOrEqual(1);
        await expect(back.locator(".keyboard-hint")).toHaveCount(0);
        await expect(back.getByRole("button", { name: "發音" })).toBeVisible();
        await page.mouse.up();
        await expect(card).toHaveRole("group");
        await expect(card).toHaveAttribute("aria-label", "已揭示的單詞卡，右掃和剛才想的一樣，左掃和剛才想的不一樣");
        await expect(card).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight");
        await page.waitForTimeout(450);

        const actions = page.getByTestId("study-stream-self-rating-actions");
        await expect(actions).toBeVisible();
        await expect(actions.getByRole("button", { name: "和剛才想的不一樣" })).toBeVisible();
        await expect(actions.getByRole("button", { name: "和剛才想的一樣" })).toBeVisible();
        const metrics = await page.evaluate(() => {
          const cardElement = document.querySelector<HTMLElement>('[data-testid="word-card-drag-layer"]');
          const actionsElement = document.querySelector<HTMLElement>('[data-testid="study-stream-self-rating-actions"]');
          if (!cardElement || !actionsElement) return null;
          return {
            cardWidth: cardElement.getBoundingClientRect().width,
            actionsWidth: actionsElement.getBoundingClientRect().width,
            nestedInCard: Boolean(actionsElement.closest('[data-testid="word-card-drag-layer"]')),
          };
        });
        expect(metrics).not.toBeNull();
        expect(Math.abs((metrics?.cardWidth ?? 0) - (metrics?.actionsWidth ?? 0))).toBeLessThanOrEqual(1);
        expect(metrics?.nestedInCard).toBe(false);
        const levelBox = await back.getByTestId("word-card-level").boundingBox();
        expect(levelBox).not.toBeNull();
        for (const selector of [".word-card-drag-badge-left", ".word-card-drag-badge-right"]) {
          const badgeBox = await page.locator(selector).boundingBox();
          expect(badgeBox).not.toBeNull();
          if (badgeBox && levelBox) {
            expect(badgeBox.y).toBeGreaterThanOrEqual(levelBox.y + levelBox.height + 3);
          }
        }
        await selfRecall.click();
        return;
      }

      if (isFlipped === "true") {
        await selfRecall.click();
        return;
      }
    }

    if (await selfRecall.isVisible().catch(() => false)) {
      await selfRecall.click();
      return;
    }

    if (await card.isVisible().catch(() => false)) {
      await expect(card).not.toHaveAttribute("aria-disabled", "true");
    }

    /*
     * Objective Probe may be resumed in an answered, read-only state before
     * the stream reaches a Learning Card. Tap its surface to continue.
     */
    const probe = page.getByRole("radiogroup", { name: "客觀題選項" });
    if (await probe.isVisible().catch(() => false)) {
      await expect(page.getByTestId("study-stream-probe-title")).toHaveText("把意思配回單詞");
      const probeCard = page.getByTestId("study-stream-probe-card");
      await expect(probeCard).toBeVisible();
      await expect(page.getByTestId("study-stream-probe-level")).toBeVisible();
      const feedbackAffordance = page.getByTestId("study-stream-feedback-affordance");
      if (await feedbackAffordance.isVisible().catch(() => false)) {
        // The read-only feedback can remain disabled while its authoritative
        // response is still settling; keep polling the stream instead of
        // turning a transient transition into a test failure.
        if ((await probeCard.getAttribute("tabindex")) !== "0") {
          await page.waitForTimeout(250);
          continue;
        }
        await expect(probeCard).toHaveRole("button");
        await expect(probeCard).toHaveAttribute("aria-label", "輕點一下任意區域");
        await expect(page.getByRole("button", { name: "我看到了，繼續" })).toHaveCount(0);
        await expect(page.getByTestId("study-stream-feedback-hint")).toHaveCount(0);
        await expect(page.locator(".quiz-result")).toHaveCount(0);
        await expect(feedbackAffordance.locator(".quiz-feedback-affordance-circle")).toBeVisible();
        const affordanceMotion = await feedbackAffordance.locator(".quiz-feedback-affordance-circle").evaluate((element) => {
          const style = window.getComputedStyle(element);
          return { animationName: style.animationName, animationDuration: style.animationDuration };
        });
        expect(affordanceMotion.animationName).toBe("quiz-feedback-affordance-breathe");
        expect(parseFloat(affordanceMotion.animationDuration)).toBeGreaterThanOrEqual(4);
        await probeCard.click({ position: { x: 48, y: 48 } });
        await expect(page.locator('[data-testid="study-stream-feedback-affordance"].is-visible')).toHaveCount(0);
        continue;
      }
      const options = page.getByRole("radio");
      await expect(options).toHaveCount(4);
      await expect(page.getByTestId("study-stream-probe-options")).toBeVisible();
      if (!(await options.first().isEnabled())) {
        await page.waitForTimeout(250);
        continue;
      }
      await options.first().locator("xpath=..").click();
      await expect(options.first().locator("xpath=..")).toHaveClass(/quiz-option-(correct|wrong)/);
      await expect(feedbackAffordance).toBeVisible();
      continue;
    }

    await page.waitForTimeout(250);
  }

  throw new Error("The local V2 stream did not expose a Learning Card within 12 items");
});

test("an evicted credential on an already completed item converges through terminal reconciliation", async ({ page }) => {
  const sessionId = "evicted-terminal-session";
  const streamItemId = "evicted-terminal-item";
  const oldCredential = "evicted-terminal-credential-012345678901234567890123456789";
  let streamCalls = 0;
  let actionCalls = 0;
  let recoveryCalls = 0;
  let reconciliationCalls = 0;
  const siblingOperationId = "evicted-sibling-operation-01";
  let serveNextItem = false;
  let revealed = false;

  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes("study-stream-v2:")) localStorage.removeItem(key);
    }
  });

  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("assignmentOnly")) return route.continue();
    streamCalls += 1;
    const next = serveNextItem;
    const response: PublicStreamResponse = {
      ok: true,
      assigned: true,
      resumedFeedback: false,
      session: {
        id: sessionId,
        mode: "global",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        revision: next ? 1 : 0,
        expiresAt: next
          ? new Date(Date.now() + 30 * 60_000).toISOString()
          : new Date(Date.now() - 1_000).toISOString(),
      },
      item: next ? {
        streamItemId: "evicted-next-item",
        kind: "LEARNING_CARD",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
        selectionReason: "evicted-terminal-test",
        itemCredential: "evicted-next-credential-012345678901234567890123456789",
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        clientRevision: 1,
        prompt: "banana",
      } : {
        streamItemId,
        kind: "LEARNING_CARD",
        flowVersion: "v2",
        policyVersion: "retrieval-v1",
        qualityPolicyVersion: "retrieval-v1-quality-v1",
        itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
        selectionReason: "evicted-terminal-test",
        itemCredential: oldCredential,
        credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        clientRevision: 0,
        prompt: "apple",
        ...(revealed ? {
          learningCard: {
            term: "apple",
            phonetic: null,
            definition: "蘋果",
            pos: null,
            examples: [],
          },
        } : {}),
      },
    };
    await route.fulfill({ json: response });
  });

  await page.route("**/api/study/actions**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/study/actions/reconcile") {
      reconciliationCalls += 1;
      serveNextItem = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          terminal: true,
          code: "STREAM_ITEM_COMPLETED",
          message: "學習項目已由其他操作完成",
        }),
      });
      return;
    }
    if (pathname === "/api/study/actions/recover") {
      recoveryCalls += 1;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "學習項目憑證無效或已過期", code: "ITEM_CREDENTIAL_INVALID" }),
      });
      return;
    }
    if (pathname !== "/api/study/actions") return route.continue();
    actionCalls += 1;
    const action = route.request().postDataJSON() as StudyStreamActionInput;
    if (action.actionKind === "REVEAL") {
      revealed = true;
      await route.fulfill({
        json: {
          ok: true,
          operationId: action.operationId,
          actionKind: action.actionKind,
          duplicate: false,
          itemStatus: "LEASED",
          clientRevision: 0,
          requiresFeedbackAck: false,
          learningCard: {
            term: "apple",
            phonetic: null,
            definition: "蘋果",
            pos: null,
            examples: [],
          },
          nextItem: null,
        },
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "學習 session 已過期或已撤銷", code: "SESSION_EXPIRED" }),
    });
  });

  await page.goto("/study");
  const hint = page.getByTestId("word-card-hint");
  await expect(hint).toBeVisible();
  const hintBox = (await hint.boundingBox())!;
  await page.mouse.move(hintBox.x + hintBox.width / 2, hintBox.y + hintBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(3_250);
  await page.mouse.up();
  await expect(page.getByTestId("word-card-back-face")).toBeVisible();
  const authPayload = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    return response.json() as Promise<{ user?: { id?: string } }>;
  });
  const userId = authPayload.user?.id;
  expect(userId).toBeTruthy();
  await page.evaluate(({ userId: currentUserId, operationId }) => {
    const action = {
      flowVersion: "v2",
      studySessionId: "evicted-sibling-session",
      streamItemId: "evicted-sibling-item",
      operationId,
      itemCredential: "evicted-sibling-credential-012345678901234567890123456789",
      actionKind: "REVEAL",
      clientKnownRevision: 0,
      payload: {},
    };
    localStorage.setItem(`english:study-stream-v2:outbox:${currentUserId}`, JSON.stringify([{
      action,
      status: "pending",
      attempts: 0,
      lastError: null,
      updatedAt: Date.now(),
    }]));
  }, { userId, operationId: siblingOperationId });
  await page.getByRole("button", { name: "和剛才想的一樣" }).click();

  await expect(page.getByText("banana", { exact: true })).toBeVisible();
  expect(actionCalls).toBe(2);
  expect(recoveryCalls).toBe(1);
  expect(reconciliationCalls).toBe(1);
  expect(streamCalls).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("alert").filter({ hasText: "尚未同步" })).toHaveCount(0);
  const outboxRows = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("english:study-stream-v2:outbox:"))
    .flatMap((key) => JSON.parse(localStorage.getItem(key) ?? "[]")));
  expect(outboxRows).toHaveLength(1);
  expect(outboxRows[0]?.action?.operationId).toBe(siblingOperationId);
});

test("two independent browser contexts reconcile an evicted completed action without dropping another row", async ({ browser }) => {
  const storageState = "test-results/.auth/student-chromium.json";
  const sessionId = "two-device-session-01";
  const streamItemId = "two-device-item-01";
  const oldCredential = "two-device-credential-k0-012345678901234567890123456789";
  const siblingOperationId = "two-device-sibling-operation-01";
  let completed = false;
  let aRevealed = false;
  let aSelfRatingAttempts = 0;
  let bStreamReads = 0;

  const contextA = await browser.newContext({ storageState });
  const contextB = await browser.newContext({ storageState });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const installRoutes = async (page: typeof pageA, device: "A" | "B") => {
    await page.route("**/api/study/stream**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("assignmentOnly")) {
        await route.fulfill({ json: { ok: true, assigned: true, flowVersion: "v2" } });
        return;
      }
      const read = device === "B" ? bStreamReads++ : 0;
      const credential = device === "B"
        ? `two-device-credential-k${Math.min(read, 8)}-012345678901234567890123456789`
        : oldCredential;
      const next = completed;
      const response: PublicStreamResponse = {
        ok: true,
        assigned: true,
        resumedFeedback: false,
        session: {
          id: sessionId,
          mode: "global",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          revision: next ? 1 : 0,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
        item: next ? {
          streamItemId: "two-device-next-item",
          kind: "LEARNING_CARD",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality-v1",
          itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
          selectionReason: "two-device-terminal-test",
          itemCredential: "two-device-next-credential-012345678901234567890123456789",
          credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          clientRevision: 1,
          prompt: "banana",
        } : {
          streamItemId,
          kind: "LEARNING_CARD",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality-v1",
          itemConstructionVersion: "retrieval-v1-mcq-curated-v2",
          selectionReason: "two-device-terminal-test",
          itemCredential: credential,
          credentialExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          clientRevision: 0,
          prompt: "apple",
          ...((device === "A" && aRevealed) || device === "B" ? {
            learningCard: {
              term: "apple",
              phonetic: null,
              definition: "蘋果",
              pos: null,
              examples: [],
            },
          } : {}),
        },
      };
      await route.fulfill({ json: response });
    });

    await page.route("**/api/study/actions**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const action = route.request().postDataJSON() as StudyStreamActionInput;
      if (pathname === "/api/study/actions/reconcile") {
        await route.fulfill({
          json: completed
            ? { ok: true, terminal: true, code: "STREAM_ITEM_COMPLETED", message: "學習項目已由其他操作完成" }
            : { ok: true, terminal: false },
        });
        return;
      }
      if (pathname === "/api/study/actions/recover") {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "學習項目憑證無效或已過期", code: "ITEM_CREDENTIAL_INVALID" }),
        });
        return;
      }
      if (pathname !== "/api/study/actions") return route.continue();
      if (action.actionKind === "REVEAL") {
        if (device === "A") aRevealed = true;
        await route.fulfill({
          json: {
            ok: true,
            operationId: action.operationId,
            actionKind: action.actionKind,
            duplicate: false,
            itemStatus: "LEASED",
            clientRevision: 0,
            requiresFeedbackAck: false,
            learningCard: { term: "apple", phonetic: null, definition: "蘋果", pos: null, examples: [] },
            nextItem: null,
          },
        });
        return;
      }
      if (action.actionKind === "SELF_RATING" && device === "A" && aSelfRatingAttempts === 0) {
        aSelfRatingAttempts += 1;
        await route.abort("failed");
        return;
      }
      if (action.actionKind === "SELF_RATING" && device === "B") {
        completed = true;
        await route.fulfill({
          json: {
            ok: true,
            operationId: action.operationId,
            actionKind: action.actionKind,
            duplicate: false,
            itemStatus: "ACKNOWLEDGED",
            clientRevision: 1,
            requiresFeedbackAck: false,
            nextItem: null,
          },
        });
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "學習項目憑證無效或已過期", code: "ITEM_CREDENTIAL_INVALID" }),
      });
    });
  };

  try {
    await installRoutes(pageA, "A");
    await installRoutes(pageB, "B");
    await pageA.goto("/study");
    const hintA = pageA.getByTestId("word-card-hint");
    await expect(hintA).toBeVisible();
    const hintBoxA = (await hintA.boundingBox())!;
    await pageA.mouse.move(hintBoxA.x + hintBoxA.width / 2, hintBoxA.y + hintBoxA.height / 2);
    await pageA.mouse.down();
    await pageA.waitForTimeout(3_250);
    await pageA.mouse.up();
    await expect(pageA.getByTestId("word-card-back-face")).toBeVisible();
    await pageA.getByRole("button", { name: "和剛才想的一樣" }).click();
    await expect(pageA.getByRole("alert").filter({ hasText: "網絡暫時不可用" })).toBeVisible();

    const authPayload = await pageA.evaluate(async () => {
      const response = await fetch("/api/auth/session", { credentials: "same-origin" });
      return response.json() as Promise<{ user?: { id?: string } }>;
    });
    const userId = authPayload.user?.id;
    expect(userId).toBeTruthy();
    await pageA.evaluate(({ currentUserId, operationId }) => {
      const action = {
        flowVersion: "v2",
        studySessionId: "two-device-sibling-session",
        streamItemId: "two-device-sibling-item",
        operationId,
        itemCredential: "two-device-sibling-credential-012345678901234567890123456789",
        actionKind: "REVEAL",
        clientKnownRevision: 0,
        payload: {},
      };
      const key = `english:study-stream-v2:outbox:${currentUserId}`;
      const rows = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
      rows.push({
        action,
        status: "blocked",
        attempts: 1,
        lastError: "保留作並發測試",
        updatedAt: Date.now(),
      });
      localStorage.setItem(key, JSON.stringify(rows));
    }, { currentUserId: userId, operationId: siblingOperationId });

    for (let read = 0; read < 9; read += 1) {
      await pageB.goto("/study");
      await expect(pageB.getByTestId("word-card-hint")).toBeVisible();
    }
    const hintB = pageB.getByTestId("word-card-hint");
    const hintBoxB = (await hintB.boundingBox())!;
    await pageB.mouse.move(hintBoxB.x + hintBoxB.width / 2, hintBoxB.y + hintBoxB.height / 2);
    await pageB.mouse.down();
    await pageB.waitForTimeout(3_250);
    await pageB.mouse.up();
    await expect(pageB.getByTestId("word-card-back-face")).toBeVisible();
    await pageB.getByRole("button", { name: "和剛才想的一樣" }).click();
    await expect(pageB.getByText("banana", { exact: true })).toBeVisible();

    await pageA.getByRole("button", { name: "重試" }).click();
    await expect(pageA.getByText("banana", { exact: true })).toBeVisible();
    const outboxRows = await pageA.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith("english:study-stream-v2:outbox:"))
      .flatMap((key) => JSON.parse(localStorage.getItem(key) ?? "[]")));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.action?.operationId).toBe(siblingOperationId);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("expired V2 item credential retry uses one bounded recovery request and clears the outbox", async ({ page }) => {
  const sessionId = "recovery-session-01";
  const streamItemId = "recovery-item-01";
  const itemCredential = "recovery-credential-012345678901234567890123456789";
  const actionBodies: Array<Record<string, unknown>> = [];
  const recoveryBodies: Array<Record<string, unknown>> = [];
  let revealed = false;
  let allowRecovery = false;

  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assignmentOnly") === "1") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        assigned: true,
        session: {
          id: sessionId,
          flowVersion: "v2",
          mode: "global",
          policyVersion: "retrieval-v1",
          revision: 0,
          expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
        },
        item: {
          streamItemId,
          kind: "LEARNING_CARD",
          flowVersion: "v2",
          policyVersion: "retrieval-v1",
          qualityPolicyVersion: "retrieval-v1-quality",
          itemConstructionVersion: "retrieval-v1-item",
          selectionReason: "recovery-test",
          itemCredential,
          credentialExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          clientRevision: 0,
          prompt: "resilience",
          ...(revealed ? {
            learningCard: {
              term: "resilience",
              phonetic: "/rɪˈzɪliəns/",
              definition: "恢复力；韧性",
              pos: "n.",
              examples: [{ en: "Resilience helps us recover.", zh: "恢复力帮助我们重新站起来。" }],
            },
          } : {}),
        },
        resumedFeedback: false,
      }),
    });
  });

  await page.route("**/api/study/actions**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/study/actions/recover") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      recoveryBodies.push(body);
      if (!allowRecovery) {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "學習項目憑證無效或已過期", code: "ITEM_CREDENTIAL_INVALID" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          actionKind: body.actionKind,
          duplicate: false,
          itemStatus: "ACKNOWLEDGED",
          clientRevision: 1,
          requiresFeedbackAck: false,
          nextItem: null,
        }),
      });
      return;
    }
    if (pathname !== "/api/study/actions") {
      await route.continue();
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    actionBodies.push(body);
    if (body.actionKind === "REVEAL") {
      revealed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          actionKind: "REVEAL",
          duplicate: false,
          itemStatus: "REVEALED",
          clientRevision: 0,
          requiresFeedbackAck: false,
          learningCard: {
            term: "resilience",
            phonetic: "/rɪˈzɪliəns/",
            definition: "恢复力；韧性",
            pos: "n.",
            examples: [{ en: "Resilience helps us recover.", zh: "恢复力帮助我们重新站起来。" }],
          },
          nextItem: null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "學習項目憑證無效或已過期", code: "ITEM_CREDENTIAL_EXPIRED" }),
    });
  });

  await page.goto("/study");
  const card = page.getByTestId("word-card-drag-layer");
  await expect(card).toBeVisible();
  const hint = page.getByTestId("word-card-hint");
  const hintBox = await hint.boundingBox();
  expect(hintBox).not.toBeNull();
  const holdX = (hintBox?.x ?? 0) + (hintBox?.width ?? 0) / 2;
  const holdY = (hintBox?.y ?? 0) + (hintBox?.height ?? 0) / 2;
  await page.mouse.move(holdX, holdY);
  await page.mouse.down();
  await page.waitForTimeout(3_250);
  await page.mouse.up();
  await expect(page.getByTestId("word-card-back-face")).toBeVisible();

  await page.getByRole("button", { name: "和剛才想的一樣" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "學習項目憑證" });
  await expect(alert).toContainText("學習項目憑證無效或已過期");
  const selfRatingBodies = () => actionBodies.filter((body) => body.actionKind === "SELF_RATING");
  expect(selfRatingBodies()).toHaveLength(1);
  expect(recoveryBodies).toHaveLength(1);
  const selfRatingOperationId = selfRatingBodies()[0]?.operationId;

  allowRecovery = true;
  await alert.getByRole("button", { name: "重試" }).click();
  await expect(alert).toHaveCount(0);
  expect(selfRatingBodies()).toHaveLength(2);
  expect(recoveryBodies).toHaveLength(2);
  expect(recoveryBodies[0]?.operationId).toBe(selfRatingOperationId);
  expect(recoveryBodies[1]?.operationId).toBe(selfRatingOperationId);
  const outboxRows = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.includes("study-stream-v2:outbox"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "[]") : [];
  });
  expect(outboxRows).toEqual([]);
});

test("V2 assignment loading copy follows the selected Chinese locale", async ({ page, context }) => {
  let releaseAssignment!: () => void;
  let assignmentGate: Promise<void> | null = null;
  await page.route("**/api/study/stream**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("assignmentOnly") === "1" && assignmentGate) await assignmentGate;
    await route.continue();
  });

  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    assignmentGate = new Promise<void>((resolve) => {
      releaseAssignment = resolve;
    });
    await context.addCookies([
      { name: "locale", value: locale, url: "http://127.0.0.1:3100/" },
    ]);
    await page.goto("/study");
    await expect(page.getByText(locale === "zh-Hant" ? "載入學習流程..." : "加载学习流程...", { exact: true })).toBeVisible();
    releaseAssignment();
    assignmentGate = null;
    await expect(page.getByText(locale === "zh-Hant" ? "載入學習流程..." : "加载学习流程...", { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-testid="word-card-drag-layer"], [role="radiogroup"]')).toBeVisible();
  }
});

test("student account names follow the selected Chinese locale", async ({ page, context }) => {
  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    await context.addCookies([
      { name: "locale", value: locale, url: "http://127.0.0.1:3100/" },
    ]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const account = page.locator(".account-trigger").first();
    await account.click();
    const heading = page.locator(".account-menu-heading");
    await expect(heading).toBeVisible();
    const headingText = (await heading.textContent()) ?? "";
    if (locale === "zh-Hant") {
      expect(headingText).not.toContain("学生");
    } else {
      expect(headingText).not.toContain("學生");
    }
    await expect(account.locator(".account-avatar")).toHaveText(headingText.slice(0, 1));
  }
});

test("V2 study surface keeps its hierarchy in dark reduced-motion mode", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/study");

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("study-stream-title")).toBeVisible();
  const titleFontSize = await page.getByTestId("study-stream-title").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(titleFontSize).toBeGreaterThanOrEqual(21);

  const surface = page.locator('[data-testid="word-card-drag-layer"], [data-testid="study-stream-probe-card"]').first();
  await expect(surface).toBeVisible();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);

  const probe = page.getByTestId("study-stream-probe-card");
  if (await probe.isVisible().catch(() => false)) {
    await expect(page.getByTestId("study-stream-probe-title")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(4);
    const optionTransition = await page.getByRole("radio").first().locator("xpath=..").evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(optionTransition)).toBe(0);
  } else {
    const visibleFace = page.locator('[data-testid="word-card-front"][aria-hidden="false"], [data-testid="word-card-back-face"][aria-hidden="false"]');
    await expect(visibleFace).toHaveCount(1);
    await expect(visibleFace.getByTestId("word-card-context")).toHaveText("認");
    await expect(visibleFace.getByRole("button", { name: "發音" })).toContainText("發音");
  }
});
