import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "@playwright/test";

// Bundle the real outbox, not a copy of its storage algorithm. Server-only
// crypto exports in contracts are unreachable from the client action parser.
const bundle = await build({
  stdin: { contents: 'import * as outbox from "./src/lib/study-stream/outbox"; window.auditOutbox = outbox;', resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", platform: "browser",
  plugins: [{ name: "server-crypto", setup(builder) {
    builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "crypto", namespace: "server-only" }));
    builder.onLoad({ filter: /.*/, namespace: "server-only" }, () => ({ contents: 'export function createHash(){throw Error("server only")} export function randomBytes(){throw Error("server only")}' }));
  } }],
});
for (const engine of [chromium, firefox, webkit]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext();
    await context.route("http://outbox.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Outbox regression</title>" }));
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(async page => {
      await page.goto("http://outbox.test/");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
    }));
    for (let iteration = 0; iteration < 10; iteration++) {
      const user = `audit-${iteration}`;
      const enqueue = (page, id) => page.evaluate(async ({ user, id }) => window.auditOutbox.enqueueStudyStreamAction(user, {
        flowVersion: "v2", studySessionId: "session-audit", streamItemId: "item-audit", operationId: id,
        itemCredential: "a".repeat(64), actionKind: "SELF_RATING", clientKnownRevision: 1, payload: { selfRating: "selfForgot" },
      }), { user, id });
      const results = await Promise.all([enqueue(pages[0], "operation-first"), enqueue(pages[1], "operation-second")]);
      assert.ok(results.every(result => result.ok), JSON.stringify(results));
      await Promise.all([
        pages[0].evaluate(user => window.auditOutbox.removeStudyStreamAction(user, "operation-first"), user),
        enqueue(pages[1], "operation-third"),
      ]);
      const ids = await pages[0].evaluate(user => window.auditOutbox.loadStudyStreamOutbox(user).map(row => row.action.operationId).sort(), user);
      assert.deepEqual(ids, ["operation-second", "operation-third"]);
    }
    console.log(`${engine.name()}: 10 concurrent enqueue/enqueue and enqueue/remove rounds passed`);
  } finally { await browser.close(); }
}
