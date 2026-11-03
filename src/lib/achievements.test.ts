import assert from "node:assert/strict";
import test from "node:test";
import {
  ACHIEVEMENTS,
  achievementProgressValue,
  checkAchievements,
  type AchievementDb,
  type AchievementProgress,
} from "./achievements";

function def(key: string) {
  const found = ACHIEVEMENTS.find((a) => a.key === key);
  assert.ok(found, `缺少成就定義：${key}`);
  return found;
}

const EMPTY_PROGRESS: AchievementProgress = {
  reviews: 0,
  encounters: 0,
  streak: 0,
  studyDays: 0,
};

interface FakeState {
  reviews?: number;
  encounters?: number;
  studyDays?: number;
  unlockedKeys?: string[];
}

function fakeDb(state: FakeState = {}) {
  const created: Array<{ userId: string; key: string }> = [];
  const calls = {
    encounters: 0,
    createMany: 0,
  };
  const db = {
    review: {
      count: async () => state.reviews ?? 0,
    },
    studyEncounter: {
      count: async () => {
        calls.encounters += 1;
        return state.encounters ?? 0;
      },
    },
    studyDay: {
      count: async () => state.studyDays ?? 0,
      findFirst: async () => null,
      findMany: async () => [] as Array<{ date: string }>,
    },
    userAchievement: {
      findMany: async () => (state.unlockedKeys ?? []).map((key) => ({ key })),
      createManyAndReturn: async (args: {
        data: Array<{ userId: string; key: string }>;
        skipDuplicates: boolean;
        select: { key: true };
      }) => {
        calls.createMany += 1;
        created.push(...args.data);
        return args.data.map((row) => ({ key: row.key }));
      },
    },
  };
  return { db: db as unknown as AchievementDb, created, calls };
}

test("正式成就定義以 canonical 繁體文案宣告，且初次學習改用學習紀錄判定", () => {
  const keys = ACHIEVEMENTS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, "成就 key 必須唯一");

  for (const achievement of ACHIEVEMENTS) {
    assert.ok(achievement.target > 0, `${achievement.key} 的 target 必須為正數`);
    assert.ok(achievement.title.length > 0, `${achievement.key} 缺少標題`);
    assert.ok(achievement.description.length > 0, `${achievement.key} 缺少描述`);
    assert.ok(achievement.icon.length > 0, `${achievement.key} 缺少圖示`);
  }

  const firstStudy = def("first_study");
  assert.equal(firstStudy.title, "初次學習");
  assert.equal(firstStudy.description, "完成第一次學習");
  // Review 只在客觀認讀題後才建立；初次學習改用「任何學習紀錄」來源，
  // 才符合「完成第一次學習」的描述。
  assert.equal(firstStudy.type, "firstStudy");
  assert.equal(firstStudy.target, 1);

  // 其餘複習成就維持以 Review 詞數計算，避免本次修正改變既有語義。
  for (const key of ["review_10", "review_50", "review_100"]) {
    const achievement = def(key);
    assert.equal(achievement.type, "reviews");
    assert.match(achievement.description, /累計複習 \d+ 個詞/u);
  }
});

test("初次學習只要存在字卡 encounter 或認讀題 Review 就算達成", () => {
  const firstStudy = def("first_study");
  assert.equal(achievementProgressValue(firstStudy, EMPTY_PROGRESS), 0);
  assert.equal(achievementProgressValue(firstStudy, { ...EMPTY_PROGRESS, encounters: 1 }), 1);
  assert.equal(achievementProgressValue(firstStudy, { ...EMPTY_PROGRESS, reviews: 1 }), 1);

  // 其他來源仍按原本的計數回傳進度。
  assert.equal(achievementProgressValue(def("review_10"), { ...EMPTY_PROGRESS, reviews: 9 }), 9);
  assert.equal(achievementProgressValue(def("streak_3"), { ...EMPTY_PROGRESS, streak: 2 }), 2);
  assert.equal(achievementProgressValue(def("study_7"), { ...EMPTY_PROGRESS, studyDays: 6 }), 6);
});

test("只完成字卡的學生會解鎖初次學習，不再停在 0 / 1", async () => {
  const { db, created, calls } = fakeDb({ encounters: 1, studyDays: 1 });

  const newlyUnlocked = await checkAchievements("student-card-only", db);

  assert.deepEqual(newlyUnlocked.map((a) => a.key), ["first_study"]);
  assert.deepEqual(created, [{ userId: "student-card-only", key: "first_study" }]);
  assert.equal(calls.encounters, 1, "初次學習必須查詢 StudyEncounter 進度");
});

test("已作答客觀認讀題的學生仍會解鎖初次學習（維持舊有行為）", async () => {
  const { db } = fakeDb({ reviews: 1, studyDays: 1 });

  const newlyUnlocked = await checkAchievements("student-probe-only", db);

  assert.deepEqual(newlyUnlocked.map((a) => a.key), ["first_study"]);
});

test("未有任何學習紀錄的學生不會解鎖初次學習", async () => {
  const { db, created, calls } = fakeDb();

  const newlyUnlocked = await checkAchievements("student-new", db);

  assert.deepEqual(newlyUnlocked, []);
  assert.deepEqual(created, []);
  assert.equal(calls.createMany, 0);
});

test("已解鎖的成就由冪等檢查略過，不會重複寫入", async () => {
  const { db, created } = fakeDb({ encounters: 1, studyDays: 1, unlockedKeys: ["first_study"] });

  const newlyUnlocked = await checkAchievements("student-unlocked", db);

  assert.deepEqual(newlyUnlocked, []);
  assert.deepEqual(created, []);
});

test("複習類成就仍以 Review 詞數解鎖", async () => {
  const { db, created } = fakeDb({ reviews: 10, studyDays: 1 });

  const newlyUnlocked = await checkAchievements("student-review", db);

  assert.deepEqual(newlyUnlocked.map((a) => a.key), ["first_study", "review_10"]);
  assert.deepEqual(created.map((row) => row.key), ["first_study", "review_10"]);
});
