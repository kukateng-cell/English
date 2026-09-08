/** Synthetic school model. Seeded assumptions for demos, not measured student behaviour. */
import { createHash } from "node:crypto";
import { STUDENT_GRADES } from "./roster-domain";
import { offsetDay, todayKey } from "./streak";
import { aggregateAllLevels } from "./units";
import { updateSM2At, type ReviewState } from "./sm2";
import { selectNextItem } from "./learning-policy/scheduler";
import { admitWork, requiresEvidenceObligation, verificationTimes } from "./learning-policy/admission";
import { mapObjectiveFirstResponse } from "./learning-policy/quality";
import { type CandidateRecord, type WorkRecord, type SelfRating } from "./learning-policy/types";

export const DEMO_VERSION = "school-simulation-v1";
export function demoId(key: string): string {
  return `school-${createHash("sha256").update(`${DEMO_VERSION}:${key}`).digest("hex").slice(0, 32)}`;
}
export function randomFor(key: string): () => number {
  let state = createHash("sha256").update(key).digest().readUInt32LE(0);
  return () => {
    state += 0x6d2b79f5;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const surnames = [
  ..."陳 黃 梁 李 林 張 王 劉 吳 何 鄭 周 馮 蔡 謝 許 葉 曾 潘 楊 趙 蘇 羅 鄧 方 馬 蕭 高".split(" "),
  "余", // 姓氏本字，不能轉成表示剩餘的「餘」。
  ..."胡 郭 朱 譚 鍾 廖 莫 歐陽 司徒".split(" "),
];
const givenNames = "柏謙 芷晴 樂言 嘉欣 子軒 曉彤 浩然 詠恩 俊熙 雅雯 卓賢 穎怡 宇軒 心怡 皓文 思澄 家朗 佩珊 梓晴 文軒 凱晴 以諾 沛霖 詠晴 昕彤 智賢 梓謙 嘉慧 朗熙 善怡 昊天 悅琳 逸軒 若曦 睿謙 芷柔 澤楷 可欣 浩賢 詩晴 承軒 允行 靜宜 明軒 皓晴 雨桐 宥謙 嘉敏 曉嵐 柏希 思穎 俊朗 諾言 芷欣 宇晴 梓樂 偉霖 婉婷 立言 映彤".split(" ");
export type DemoStudent = {
  key: string; name: string; grade: typeof STUDENT_GRADES[number]; code: "A" | "B" | "C";
  number: number; classIndex: number; participation: number; ability: number; minutes: number;
  hour: number; weekend: boolean; trend: number; joinDelay: number;
};
export function schoolRoster(seed: string): DemoStudent[] {
  const result: DemoStudent[] = [];
  const names = new Set<string>();
  for (let classIndex = 0; classIndex < 18; classIndex++) {
    const rng = randomFor(`${seed}:class:${classIndex}`);
    const count = 28 + Math.floor(rng() * 9);
    for (let number = 1; number <= count; number++) {
      const key = `${classIndex}:${number}`;
      const r = randomFor(`${seed}:student:${key}`);
      let name: string;
      do { name = surnames[Math.floor(r() * surnames.length)] + givenNames[Math.floor(r() * givenNames.length)]; } while (names.has(name));
      names.add(name);
      result.push({ key, name, grade: STUDENT_GRADES[Math.floor(classIndex / 3)], code: (["A", "B", "C"] as const)[classIndex % 3], number, classIndex,
        participation: r() < 0.06 ? 0 : 0.2 + r() * 0.68, ability: 0.48 + r() * 0.4,
        minutes: 9 + Math.floor(r() * 19), hour: [7, 16, 19, 20, 21][Math.floor(r() * 5)],
        weekend: r() < 0.25, trend: (r() - 0.45) * 0.003, joinDelay: r() < 0.05 ? 3 + Math.floor(r() * 4) : 0 });
    }
  }
  return result;
}
export type SimulationWord = { id: string; level: string; category: string | null };
export type SimReview = ReviewState & { revision: number };
export type SimWork = WorkRecord & { answeredAt?: number };
export type SimAction = {
  id: string; wordId: string; kind: "LEARNING_CARD" | "OBJECTIVE_PROBE";
  start: number; reveal: number; answer: number; end: number; sessionKey: string;
  selfRating: SelfRating; correct: boolean; purpose?: "DUE_REVIEW" | "EVIDENCE_OBLIGATION";
  reason: string; override?: string; workId?: string; admittedWorkId?: string;
  before?: SimReview; after?: SimReview;
};
export function activitySlots(seed: string, student: DemoStudent, date: string, startDate: string) {
  const day = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
  if (day < student.joinDelay || student.participation === 0) return [];
  const r = randomFor(`${seed}:${student.key}:${date}`);
  const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const classDay = weekday === 1 + student.classIndex % 5;
  const probability = Math.max(0.04, Math.min(0.96, student.participation + student.trend * day + (weekend ? student.weekend ? 0.25 : -0.2 : classDay ? 0.16 : 0)));
  if (r() > probability) return [];
  const sessions = r() < 0.16 ? 2 : 1;
  const slots: Array<{ start: number; end: number; key: string }> = [];
  for (let s = 0; s < sessions; s++) {
    const hour = s ? 22 : classDay && !weekend ? 16 : weekend ? 10 + Math.floor(r() * 10) : student.hour;
    let cursor = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`) + Math.floor(r() * 40) * 60000;
    cursor = Math.max(cursor, (slots.at(-1)?.end ?? 0) + 1);
    const limit = cursor + Math.floor(student.minutes * (0.6 + r() * 0.8)) * 60000;
    const key = `${student.key}:${date}:${s}`;
    while (cursor + 60000 < limit) {
      const end = cursor + 12000 + Math.floor(r() * 48000);
      slots.push({ start: cursor, end, key });
      cursor = end + 2000 + Math.floor(r() * 16000) + (r() < 0.07 ? Math.floor(r() * 180000) : 0);
    }
  }
  return slots;
}

export function simulateStudent(seed: string, student: DemoStudent, words: SimulationWord[], startDate: string, asOf: Date) {
  const reviews = new Map<string, SimReview>();
  const work: SimWork[] = [];
  const actions: SimAction[] = [];
  const contacts = new Map<string, number>();
  let consecutiveProbes = 0, gap = 0, hasPreviousProbe = false;
  const recent: string[] = [];
  const groups = new Map<string, { level: string; category: string | null; total: number }>();
  for (const word of words) {
    const key = `${word.level}::${word.category}`;
    const group = groups.get(key) ?? { level: word.level, category: word.category, total: 0 };
    group.total++; groups.set(key, group);
  }
  const byId = new Map(words.map(w => [w.id, w]));
  const expire = (now: number) => { for (const w of work) if (w.status === "PENDING" && w.expiresAt <= now) w.status = "EXPIRED"; };
  for (let date = startDate; date <= todayKey(asOf); date = offsetDay(date, 1)) {
    for (const slot of activitySlots(seed, student, date, startDate)) {
      if (slot.end > asOf.getTime()) continue;
      const now = slot.start;
      expire(now);
      const active = work.filter(w => w.status === "PENDING");
      const activeWords = new Set(active.map(w => w.wordId));
      const progress = aggregateAllLevels(["A1", "A2", "B1", "B2"], [...groups.values()], [...reviews].map(([id, r]) => ({ ...r, ...byId.get(id)! })), new Date(now));
      const unlocked = new Set(progress.flatMap(l => l.units.filter(u => u.unlocked).map(u => `${l.level}::${u.name}`)));
      const available = words.filter(w => unlocked.has(`${w.level}::${w.category ?? "未分類"}`));
      const candidates: CandidateRecord[] = [];
      for (const w of active) {
        candidates.push({ id: w.id, wordId: w.wordId, kind: w.kind === "REMEDIATION" ? "LEARNING_CARD" : "OBJECTIVE_PROBE", purpose: "EVIDENCE_OBLIGATION", workId: w.id, eligibleAt: w.eligibleAt, expiresAt: w.expiresAt, selectionReason: "evidence-work" });
        if (w.kind === "EVIDENCE_OBLIGATION") candidates.push({ id: `filler:${w.id}`, wordId: w.wordId, kind: "LEARNING_CARD", eligibleAt: w.eligibleAt, expiresAt: w.expiresAt, selectionReason: "evidence-obligation-gap-filler" });
      }
      const ordered = [...available].sort((a,b) => (contacts.get(a.id) ?? 0) - (contacts.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      for (const [i, w] of ordered.entries()) {
        if (activeWords.has(w.id)) continue;
        const review = reviews.get(w.id);
        if (review && review.nextReviewDate.getTime() <= now) candidates.push({ id: `due:${w.id}`, wordId: w.id, kind: "OBJECTIVE_PROBE", purpose: "DUE_REVIEW", eligibleAt: review.nextReviewDate.getTime(), selectionReason: "due-review" });
        candidates.push({ id: `card:${w.id}`, wordId: w.id, kind: "LEARNING_CARD", selectionPriority: i, selectionReason: review ? "ordinary-review" : contacts.has(w.id) ? "contacted-word" : "new-word" });
      }
      const decision = selectNextItem({ mode: "global", now, consecutiveProbes, acknowledgedItemsSinceProbe: gap, hasPreviousProbe, recentWordIds: recent, activeWork: active, candidates });
      const c = decision.candidate;
      if (!c) continue;
      const id = demoId(`${seed}:${student.key}:${slot.start}`);
      const r = randomFor(id);
      const previous = reviews.get(c.wordId);
      const elapsed = previous?.lastReviewedAt ? (now - previous.lastReviewedAt.getTime()) / 86400000 : 0;
      const difficulty = randomFor(`${seed}:difficulty:${c.wordId}`)() * 0.18;
      const chance = Math.max(0.28, Math.min(0.96, student.ability - difficulty + Math.min(0.16, (previous?.repetitions ?? 0) * 0.04) - Math.max(0, elapsed - (previous?.interval ?? 0)) * 0.008));
      const correct = r() < chance;
      const selfRating = r() < Math.min(0.95, chance + 0.12) ? "selfRecalled" : "selfForgot";
      const action: SimAction = { id, wordId: c.wordId, kind: c.kind, start: now, reveal: now + 4000 + Math.floor(r() * 3000), answer: slot.end - 3000, end: slot.end, sessionKey: slot.key, selfRating, correct, reason: c.selectionReason, override: decision.overrideReason, workId: c.workId };
      const served = work.find(w => w.id === c.workId);
      if (served) { served.status = "ANSWERED"; served.answeredAt = action.answer; }
      const admit = (kind: "REMEDIATION" | "EVIDENCE_OBLIGATION") => {
        const admitted = admitWork({ learnerId: student.key, wordId: c.wordId, kind, now: action.answer, eligibleAt: kind === "EVIDENCE_OBLIGATION" ? verificationTimes(action.answer).eligibleAt : action.answer, sourceOperationId: `${id}:answer`, activeWork: active.filter(w => w.status === "PENDING") });
        if (admitted.record) { admitted.record.id = demoId(admitted.record.id); work.push(admitted.record); action.admittedWorkId = admitted.record.id; }
      };
      if (c.kind === "OBJECTIVE_PROBE") {
        action.purpose = c.workId ? "EVIDENCE_OBLIGATION" : "DUE_REVIEW";
        action.before = previous;
        const initial: ReviewState = { easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewDate: new Date(now), lastReviewedAt: null };
        action.after = { ...updateSM2At(previous ?? initial, mapObjectiveFirstResponse(correct ? "correct" : "wrong", action.purpose)!.quality, new Date(action.answer)), revision: (previous?.revision ?? 0) + 1 };
        reviews.set(c.wordId, action.after);
        if (!correct) admit("REMEDIATION");
        gap = 0; consecutiveProbes++; hasPreviousProbe = true;
      } else {
        if (requiresEvidenceObligation({ learnerId: student.key, wordId: c.wordId, selfRating, repetitions: previous?.repetitions ?? 0, hadObjectiveEvidence: Boolean(previous), activeWork: active, now: action.answer, sourceOperationId: `${id}:answer` })) admit("EVIDENCE_OBLIGATION");
        gap++; consecutiveProbes = 0;
      }
      contacts.set(c.wordId, action.end);
      recent.unshift(c.wordId); recent.splice(2);
      actions.push(action);
    }
  }
  expire(asOf.getTime());
  return { actions, reviews, work };
}
