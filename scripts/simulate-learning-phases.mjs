// 三階段提案的概念模型：不連 DB，不接 production scheduler，不代替整合驗收。
// 每項假設十二秒；wordId 亦代表不同拼寫；合法 scope 固定，不模擬單元解鎖。
import assert from "node:assert/strict";
import { createInitialState, updateSM2At } from "../src/lib/sm2.ts";

import { selectNextItem } from "../src/lib/learning-policy/scheduler.ts";
import { initialCheckReady, nextPhaseCursor } from "../src/lib/learning-policy/phases.ts";
import { RETRIEVAL_V3_POLICY } from "../src/lib/learning-policy/types.ts";
const START = Date.parse("2026-11-02T01:00:00Z");
const ITEM_MS = 12_000;
const CAP = 5;
const GAP = 2;
const LANES = ["initial", "due", "due", "new"];

function model({ newWords = 100, dueWords = 0, correct = () => true, selfRating = "selfRecalled" } = {}) {
  return {
    now: START,
    cursor: 3,
    unseen: Array.from({ length: newWords }, (_, i) => `new-${String(i).padStart(4, "0")}`),
    pending: new Map(),
    reviews: new Map(Array.from({ length: dueWords }, (_, i) => [
      `old-${String(i).padStart(4, "0")}`,
      { ...createInitialState(), interval: 6, repetitions: 2, nextReviewDate: new Date(START - (dueWords - i) * 1000) },
    ])),
    log: [], correct, selfRating,
    maxPending: 0,
    bypasses: new Map(),
    maxEligibleInitialBypasses: 0,
  };
}

function otherTerms(state, word, pending) {
  return new Set(state.log.slice(pending.exposureIndex + 1).filter(e => e.word !== word).map(e => e.word)).size;
}

function eligibleInitials(state) {
  return [...state.pending].filter(([word, pending]) =>
    initialCheckReady(state.now, pending.exposedAt, state.log.slice(pending.exposureIndex + 1).map(e => e.word), word));
}

function choose(state) {
  const ready = new Set(eligibleInitials(state).map(([word]) => word));
  const candidates = [...state.pending].map(([word], i) => ({ id:word, wordId:word, workId:word,
    kind:"OBJECTIVE_PROBE",purpose:"EVIDENCE_OBLIGATION",selectionReason:"initial-check",policyVersion:"retrieval-v3",
    selectionPriority:i,initialGapPending:!ready.has(word) }));
  for(const [word,review] of state.reviews) if(review.nextReviewDate.getTime() <= state.now) candidates.push({
    id:word,wordId:word,kind:"OBJECTIVE_PROBE",purpose:"DUE_REVIEW",selectionReason:"due-review",policyVersion:"retrieval-v3",eligibleAt:review.nextReviewDate.getTime() });
  if(state.pending.size < CAP && state.unseen.length) candidates.push({ id:state.unseen[0],wordId:state.unseen[0],
    kind:"LEARNING_CARD",selectionReason:"new-word",policyVersion:"retrieval-v3" });
  const selected=selectNextItem({mode:"global",now:state.now,phaseCursor:state.cursor,allowSmallPoolInitial:true,
    consecutiveProbes:0,acknowledgedItemsSinceProbe:0,hasPreviousProbe:false,activeWork:[],candidates},RETRIEVAL_V3_POLICY);
  const c=selected.candidate;
  return c ? {kind:c.kind === "LEARNING_CARD" ? "new" : c.workId ? "initial" : "due",word:c.wordId,
    nextCursor:nextPhaseCursor(selected.overrideReason),override:selected.overrideReason?.includes("small-pool") ? "small-pool-initial-check" : null} : null;
}

function step(state) {
  const item = choose(state);
  if (!item) return false;
  const eligible = eligibleInitials(state);
  const startedAt = state.now;
  const pending = state.pending.get(item.word);
  const gap = pending ? otherTerms(state, item.word, pending) : null;
  state.now += ITEM_MS;
  let quality = null;
  if (item.kind === "new") {
    assert.equal(state.unseen.shift(), item.word, "新詞來源次序一致");
    state.pending.set(item.word, { exposedAt: state.now, exposureIndex: state.log.length });
  } else {
    const previous = state.reviews.get(item.word);
    if (item.kind === "initial") {
      assert.ok(!previous, "本模型的初驗不能誤用已有 Review 的詞");
      assert.ok(pending, "初驗必須有未完成需求");
      assert.ok(gap >= GAP || startedAt - pending.exposedAt >= 600_000 || item.override,
        "初驗符合間隔或有明確細詞集原因");
      state.pending.delete(item.word);
    } else {
      assert.ok(previous.nextReviewDate.getTime() <= startedAt, "未到期不能計分複習");
    }
    quality = state.correct(item.word, state.log.length) ? 4 : 2;
    state.reviews.set(item.word, updateSM2At(previous ?? createInitialState(), quality, new Date(state.now)));
  }
  state.cursor = item.nextCursor;
  state.log.push({ ...item, startedAt, completedAt: state.now, gap, quality,
    selfRating: item.kind === "new" ? state.selfRating : null });
  state.maxPending = Math.max(state.maxPending, state.pending.size);
  assert.ok(state.pending.size <= CAP, "未試答窗口不能超過五詞");
  for (const [word] of eligible) {
    const count = word === item.word ? 0 : (state.bypasses.get(word) ?? 0) + 1;
    state.bypasses.set(word, count);
    state.maxEligibleInitialBypasses = Math.max(state.maxEligibleInitialBypasses, count);
    assert.ok(count <= CAP * LANES.length - 1, "穩定可用候選的初驗不能長期飢餓");
  }
  return true;
}

function run(state, items) {
  for (let i = 0; i < items; i += 1) if (!step(state)) break;
  return state;
}

function summary(name, state) {
  return { name, items: state.log.length,
    newWords: state.log.filter(e => e.kind === "new").length,
    initialChecks: state.log.filter(e => e.kind === "initial").length,
    dueReviews: state.log.filter(e => e.kind === "due").length,
    maxPending: state.maxPending,
    firstInitialCompletedSeconds: state.log.find(e => e.kind === "initial")
      ? (state.log.find(e => e.kind === "initial").completedAt - START) / 1000 : null,
    smallPoolChecks: state.log.filter(e => e.override).length,
    maxEligibleInitialBypasses: state.maxEligibleInitialBypasses };
}

const results = [];
for (const [name, correct, selfRating] of [
  ["全新／全對", () => true, "selfRecalled"],
  ["全新／全忘及全錯", () => false, "selfForgot"],
  ["全新／部分錯", word => Number(word.slice(4)) % 3 !== 0, "selfRecalled"],
]) {
  const state = run(model({ correct, selfRating }), 50);
  assert.equal(state.log.length, 50, "十分鐘內每步均有可前進內容");
  assert.equal(state.unseen.length, 74, "五十項應引入二十六詞");
  assert.equal(state.reviews.size, 24, "其餘二十四詞已完成首次試答");
  const visits = new Map();
  for (const item of state.log) visits.set(item.word, (visits.get(item.word) ?? 0) + 1);
  assert.ok([...visits.values()].every(count => count <= 2), "到期前每詞最多接觸卡及初驗各一次");
  for (const [word, review] of state.reviews) {
    assert.equal(review.interval, 1, "初次試答不能直接推進長間隔");
    assert.equal(review.repetitions, correct(word) ? 1 : 0, "錯誤不能算認字成功");
    assert.ok(review.nextReviewDate.getTime() > state.now, "錯題仍有日後排程");
  }
  results.push(summary(name, state));
}

const backlog = run(model({ dueWords: 100 }), 100);
assert.ok(backlog.log.filter(e => e.kind === "due").length >= 45, "積壓複習有穩定服務量");
assert.ok(backlog.log.filter(e => e.kind === "new").length >= 20, "積壓不能永久餓死新詞");
results.push(summary("一百到期詞＋新詞", backlog));

// 模擬並發操作已留下五個合法接觸；本例只驗收排程，不聲稱驗證真實 reservation race。
const full = model({ correct: () => false });
for (let i = 0; i < CAP; i += 1) {
  const word = full.unseen.shift();
  full.now += ITEM_MS;
  full.pending.set(word, { exposedAt: full.now, exposureIndex: full.log.length });
  full.log.push({ kind: "new", word, completedAt: full.now, override: null });
}
full.maxPending = CAP;
assert.equal(choose(full).kind, "initial", "滿窗口應服務初驗，不等待十分鐘");
step(full);
assert.equal(full.pending.size, CAP - 1, "答錯仍釋放一個初學名額");
assert.equal(choose(full).kind, "new", "答錯後輪到新詞時可以引入第六詞");
run(full, 30);
results.push(summary("五詞已滿／首次答錯", full));

const dueOnly = run(model({ newWords: 0, dueWords: 30 }), 50);
assert.equal(dueOnly.log.length, 30, "只剩複習時不在第二題後強制休息");
assert.ok(dueOnly.log.every(e => e.kind === "due"), "不製造認讀補位卡");
results.push(summary("只有三十到期詞", dueOnly));

for (const size of [1, 2, 3]) {
  const state = run(model({ newWords: size, correct: () => false, selfRating: "selfForgot" }), 30);
  assert.equal(state.log.length, size * 2, "有限詞集每詞卡及初驗各一次後停止");
  assert.equal(state.pending.size, 0, "細詞集不應卡住初驗");
  assert.equal(choose(state), null, "初驗全錯仍不可無限重複");
  results.push(summary(`${size} 詞單元／全錯`, state));
}

for (const minutes of [5, 11]) {
  const state = run(model(), 1);
  state.now += minutes * 60_000;
  const before = JSON.stringify([state.cursor, [...state.pending], state.log]);
  const choice = choose(state);
  assert.equal(JSON.stringify([state.cursor, [...state.pending], state.log]), before, "唯讀選取不推進 cursor 或工作");
  assert.equal(choice.kind, minutes === 5 ? "new" : "initial", "返回時可穿插新詞，滿後備時間可直接初驗");
}

const spaced = run(model({ newWords: 1 }), 2);
const intervals = [spaced.reviews.get("new-0000").interval];
for (let i = 0; i < 3; i += 1) {
  assert.equal(choose(spaced), null, "未到期不能再答一次推進 SM-2");
  spaced.now = spaced.reviews.get("new-0000").nextReviewDate.getTime();
  assert.ok(step(spaced), "到期必須有合法複習");
  assert.equal(spaced.log.at(-1).kind, "due", "到期直接驗證，不能先顯示答案卡");
  intervals.push(spaced.reviews.get("new-0000").interval);
}
assert.deepEqual(intervals, [1, 6, 15, 38], "沿用現有 SM-2 間隔序列");
spaced.now = spaced.reviews.get("new-0000").nextReviewDate.getTime();
spaced.correct = () => false;
step(spaced);
assert.equal(spaced.reviews.get("new-0000").interval, 1, "成熟詞答錯回一天間隔");
assert.equal(spaced.reviews.get("new-0000").repetitions, 0, "成熟詞答錯重置連續成功");
assert.equal(spaced.pending.size, 0, "成熟詞答錯不塞回初學五詞窗口");

const long = run(model({ newWords: 600, dueWords: 600, correct: (_, index) => index % 2 === 0 }), 1000);
assert.equal(long.log.length, 1000, "一千項混合正誤序列不能停滯");
results.push(summary("一千項混合序列", long));

console.log(JSON.stringify({ modelOnly: true, itemSeconds: ITEM_MS / 1000, intervals, results }, null, 2));
console.log("三階段概念模型通過；未驗證 runtime、DB 並發、解鎖、lease 或部署。");
