/**
 * 2026-11-02 揀詞分析的可重跑證據；不是新版 scheduler 或完整 DB 驗收。
 * 從 repository root 執行：node --import tsx scripts/audit-study-selection.mjs
 * 使用真實候選／排程函數與限定記憶體 fixture；不讀取 .env、不執行 SQL。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import Module, { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const loadModule = createRequire(path.join(root, "package.json"));
// 防止未來 import 副作用意外接觸任何真實資料庫。
const { Pool } = loadModule("pg");
Pool.prototype.connect = function () { throw new Error("此分析禁止資料庫連線"); };
Pool.prototype.query = function () { throw new Error("此分析禁止資料庫查詢"); };

const filename = path.join(root, "src/lib/study-stream/server.ts");
const source = execFileSync("git", ["show", "0dc8427:src/lib/study-stream/server.ts"], { encoding: "utf8" }) + "\nexport { buildCandidates as auditBuildCandidates };\n";
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
// 只在此 process 的 module copy 暴露內部函數，磁碟原始碼保持不變。
const runtime = new Module(filename);
runtime.filename = filename;
runtime.paths = Module._nodeModulePaths(path.dirname(filename));
runtime._compile(compiled, filename);
const { auditBuildCandidates } = runtime.exports;
const { selectNextItem } = loadModule("./src/lib/learning-policy/scheduler.ts");
const { recentStreamShape } = loadModule("./src/lib/study-stream/history.ts");
const { admitWork, verificationTimes, requiresEvidenceObligation } = loadModule("./src/lib/learning-policy/admission.ts");
const base = Date.parse("2026-11-02T01:00:00Z");
const words = Array.from({ length: 20 }, (_, i) => ({
  id: `word-${String(i + 1).padStart(2, "0")}`,
  term: `term-${String(i + 1).padStart(2, "0")}`,
  senseId: `sense-${i}`,
}));

async function runBaseline(reviewed) {
  const encounters = [];
  const work = [];
  const trace = [];
  const reviews = reviewed ? words.map((w, i) => ({
    id: `review-${w.id}`, wordId: w.id, senseId: w.senseId,
    lastReviewedAt: new Date(base - 86400000 + i),
    nextReviewDate: new Date(base + 86400000),
  })) : [];
  const tx = {
    evidenceObligation: {
      findMany: async (q) => q.where.expiresAt?.lte
        ? work.filter((w) => w.expiresAt <= q.where.expiresAt.lte)
        : work.filter((w) => w.eligibleAt <= q.where.eligibleAt.lte && w.expiresAt > q.where.expiresAt.gt)
          .map((w) => ({ ...w, userId: w.learnerId, admittedAt: new Date(w.admittedAt),
            eligibleAt: new Date(w.eligibleAt), expiresAt: new Date(w.expiresAt), updatedAt: new Date(w.admittedAt) })),
    },
    studyEncounter: {
      findMany: async (q) => [...encounters].sort((a, b) => q.orderBy[0].acknowledgedAt === "desc"
        ? b.acknowledgedAt - a.acknowledgedAt : a.acknowledgedAt - b.acknowledgedAt).slice(0, q.take),
    },
    studyStreamItem: { findMany: async () => [] },
    objectiveEvidenceTarget: { findMany: async () => [] },
    word: {
      findMany: async (q) => reviewed ? [] : words.filter((w) => q.where.AND[1].studyEncounters.none
        ? !encounters.some((e) => e.wordId === w.id) : encounters.some((e) => e.wordId === w.id)),
    },
    review: {
      findMany: async (q) => reviews.filter((r) => q.where.nextReviewDate.lte
        ? r.nextReviewDate <= q.where.nextReviewDate.lte : r.nextReviewDate > q.where.nextReviewDate.gt),
    },
  };
  for (let step = 0; step < 35; step++) {
    const now = base + step * 12000;
    const built = await auditBuildCandidates(tx, "audit", { id: "session" }, { mode: "global", where: {} }, new Date(now));
    const decision = selectNextItem({ mode: "global", now, ...recentStreamShape(built.history.acknowledged),
      recentWordIds: built.history.recentWordIds, activeWork: built.active, candidates: built.candidates });
    assert.ok(decision.candidate, "目前基線應持續產生卡片");
    const wordId = decision.candidate.wordId;
    let disposition = "not-required";
    if (requiresEvidenceObligation({ learnerId: "audit", wordId, selfRating: "selfRecalled",
      repetitions: reviewed ? 1 : 0, hadObjectiveEvidence: reviewed, activeWork: work, now, sourceOperationId: `step-${step}` })) {
      const admission = admitWork({ learnerId: "audit", wordId, kind: "EVIDENCE_OBLIGATION", now,
        eligibleAt: verificationTimes(now).eligibleAt, activeWork: work, sourceOperationId: `step-${step}` });
      disposition = admission.reason;
      if (admission.record) work.push(admission.record);
    }
    encounters.push({ id: `encounter-${step}`, wordId, acknowledgedAt: new Date(now) });
    trace.push({ wordId, reason: decision.candidate.selectionReason, disposition });
  }
  assert.equal(new Set(trace.slice(20).map((r) => r.wordId)).size, 3);
  if (!reviewed) {
    assert.equal(new Set(trace.slice(0, 20).map((r) => r.wordId)).size, 20);
    assert.equal(work.length, 5);
    assert.equal(trace.slice(0, 20).filter((r) => r.disposition === "debt-cap").length, 15);
  }
  return {
    scenario: reviewed ? "20 個已客觀答題、全部未到期詞" : "20 新詞、每卡 12 秒、全部 selfRecalled",
    last15Words: trace.slice(20).map((r) => r.wordId),
    reasons: [...new Set(trace.slice(20).map((r) => r.reason))],
    admittedWork: work.length,
    first20DebtCap: trace.slice(0, 20).filter((r) => r.disposition === "debt-cap").length,
  };
}

// 只比較同級、持續合資格候選的輪換；不冒充整套新版政策。
function compareRotation(windowSize, useLastContact) {
  const history = [];
  const lastContact = new Map();
  for (let step = 0; step < 40; step++) {
    const recent = new Set(history.slice(-windowSize));
    const eligible = words.filter((w) => !recent.has(w.id));
    if (useLastContact) eligible.sort((a, b) => (lastContact.get(a.id) ?? -1) - (lastContact.get(b.id) ?? -1) || a.id.localeCompare(b.id));
    const wordId = eligible[0].id;
    history.push(wordId);
    lastContact.set(wordId, step);
  }
  return { windowSize, useLastContact, distinctWords: new Set(history).size,
    counts: Object.fromEntries(words.map((w) => [w.id, history.filter((id) => id === w.id).length])) };
}

const baseline = [await runBaseline(false), await runBaseline(true)];
const widerWindow = compareRotation(10, false);
const fairRotation = compareRotation(2, true);
assert.equal(widerWindow.distinctWords, 11);
assert.equal(fairRotation.distinctWords, 20);
assert.ok(Object.values(fairRotation.counts).every((count) => count === 2));
console.log(JSON.stringify({ baseline, comparisonOnly: { widerWindow, fairRotation },
  limits: "記憶體 fixture；未驗證 DB、UI、併發或整套提案。這些斷言確認缺陷仍存在，並非產品驗收 PASS。" }, null, 2));
