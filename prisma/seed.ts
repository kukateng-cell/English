/**
 * Seed 腳本：匯入 versioned CSV 詞庫及本地帳戶 fixture
 * 執行：npx tsx prisma/seed.ts
 *
 * canonical vocabulary source: outputs/*-word-catalog-reference-v1/*.csv
 */
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { seedCatalog } from "../src/lib/catalog/seed";
import { ROLES } from "../src/lib/roles";
import { passwordPolicyError } from "../src/lib/password-policy";
import { generateTemporaryPassword } from "../src/lib/temporary-password";
import { replacePasswordCredential } from "../src/lib/password-credentials";
import { currentAcademicYearDates } from "../src/lib/roster-domain";

// seed 是獨立腳本（tsx 執行），不會自動讀環境變數，手動載入 .env.local。
dotenv.config({ path: ".env.local" });

// Seed 會寫入大量資料，必須明確使用 Session/direct connection；絕不回退 runtime URL。
if (!process.env.MIGRATE_URL) {
  throw new Error("執行 seed 必須明確設定 MIGRATE_URL。");
}
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATE_URL,
  }),
});

// ── 學生帳號預生成 ──
// 帳號由教師統一發放給學生，不設自助註冊。
// 格式：student01..studentNN，每個帳號獨立臨時密碼（首次登入強制修改）。
const STUDENT_COUNT = 40;
const TEST_STUDENT_NUMBER = 9001;
const WEBKIT_TEST_STUDENT_NUMBER = 9002;
type DatabaseEnvironment = "development" | "test" | "production";

async function requireDatabaseEnvironment(): Promise<DatabaseEnvironment> {
  const declared = process.env.DATABASE_ENVIRONMENT;
  if (
    declared !== "development" &&
    declared !== "test" &&
    declared !== "production"
  ) {
    throw new Error(
      "執行 seed 必須把 DATABASE_ENVIRONMENT 明確設為 development、test 或 production。",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const row = await tx.databaseMetadata.findUnique({
        where: { key: "environment" },
      });
      const persisted = row?.value ?? "unclassified";
      if (persisted === "unclassified") {
        if (process.env.CONFIRM_DATABASE_ENVIRONMENT !== declared) {
          throw new Error(
            `資料庫尚未分類。請確認目標後同時設定 CONFIRM_DATABASE_ENVIRONMENT=${declared}。`,
          );
        }
        const claimed = await tx.databaseMetadata.updateMany({
          where: { key: "environment", value: "unclassified" },
          data: { value: declared },
        });
        if (claimed.count === 1) return declared;
        const winner = await tx.databaseMetadata.findUnique({
          where: { key: "environment" },
        });
        if (winner?.value === declared) return declared;
        throw new Error(
          `資料庫已被另一程序標記為 ${winner?.value ?? "unknown"}；已拒絕 seed。`,
        );
      }
      if (persisted !== declared) {
        throw new Error(
          `資料庫環境標記為 ${persisted}，但 DATABASE_ENVIRONMENT=${declared}；已拒絕 seed。`,
        );
      }
      return declared;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

const SEED_GRADES = [
  "JUNIOR_1",
  "JUNIOR_2",
  "JUNIOR_3",
  "SENIOR_1",
  "SENIOR_2",
  "SENIOR_3",
] as const;

async function ensureSeedCurrentYear() {
  const current = await prisma.academicYear.findFirst({ where: { status: "CURRENT" } });
  if (current) return current;
  const anyYear = await prisma.academicYear.count();
  if (anyYear > 0) throw new Error("Seed 找不到 CURRENT 學年；請先由管理員完成學年啟用或重設 disposable local DB。");
  const input = currentAcademicYearDates();
  return prisma.academicYear.create({ data: { ...input, isCurrent: true, status: "CURRENT" } });
}

async function ensureSeedClasses(academicYearId: string) {
  const result: Array<Record<(typeof SEED_GRADES)[number], string>> = [];
  for (const grade of SEED_GRADES) {
    const schoolClass = await prisma.schoolClass.upsert({
      where: { academicYearId_grade_classCode: { academicYearId, grade, classCode: "A" } },
      create: { academicYearId, grade, classCode: "A", active: true },
      update: { active: true },
    });
    result.push({ [grade]: schoolClass.id } as Record<(typeof SEED_GRADES)[number], string>);
  }
  return result;
}

async function seedStudents() {
  const currentYear = await ensureSeedCurrentYear();
  const classes = await ensureSeedClasses(currentYear.id);
  let created = 0;
  let rotated = 0;
  let existed = 0;
  console.log("一次性學生臨時密碼（請立即安全保存）：");
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    const account = `student${String(i).padStart(2, "0")}`; // student01, student02, ...
    const credentialMarkerKey = `studentTemporaryCredential:${account}`;
    const existing = await prisma.user.findUnique({ where: { accountName: account } });
    const credentialMarker = await prisma.databaseMetadata.findUnique({
      where: { key: credentialMarkerKey },
    });
    if (
      existing &&
      (existing.role !== ROLES.STUDENT ||
        !existing.mustChangePassword ||
        credentialMarker !== null)
    ) {
      if (
        existing.role === ROLES.STUDENT &&
        !existing.mustChangePassword &&
        credentialMarker === null
      ) {
        await prisma.databaseMetadata.create({
          data: { key: credentialMarkerKey, value: "claimed-or-managed" },
        });
      }
      existed++;
      continue;
    }
    const temporaryPassword = generateTemporaryPassword();
    const policyError = passwordPolicyError(temporaryPassword);
    if (policyError) throw new Error(policyError);
    const hash = await bcrypt.hash(temporaryPassword, 12);
    if (existing) {
      await prisma.$transaction(async (tx) => {
        const updated = await replacePasswordCredential(tx, {
          userId: existing.id,
          passwordHash: hash,
          mustChangePassword: true,
          expectedTokenVersion: existing.tokenVersion,
        });
        if (!updated) {
          throw new Error(`${account} 已被並發修改，請重新執行 seed。`);
        }
        await tx.databaseMetadata.upsert({
          where: { key: credentialMarkerKey },
          create: { key: credentialMarkerKey, value: "issued-v1" },
          update: { value: "reissued-after-account-recreation-v1" },
        });
      });
      rotated++;
    } else {
      await prisma.$transaction(async (tx) => {
        const grade = (["JUNIOR_1", "JUNIOR_2", "JUNIOR_3", "SENIOR_1", "SENIOR_2", "SENIOR_3"] as const)[(i - 1) % 6];
        const classId = classes[(i - 1) % classes.length]?.[grade] ?? null;
        await tx.user.create({
          data: {
            accountName: account,
            accountNameCanonical: account,
            passwordHash: hash,
            credentialRevision: 1,
            legacyName: `學生 ${i}`,
            mustChangePassword: true,
            studentProfile: {
              create: {
                legalName: `學生 ${i}`,
                nickname: `學員-${String(i).padStart(2, "0")}`,
                nicknameNormalized: `學員-${String(i).padStart(2, "0")}`,
                enrollments: {
                  create: {
                    academicYearId: currentYear.id,
                    grade,
                    classId,
                    studentNumber: i,
                    isCurrent: true,
                    status: "ACTIVE",
                    origin: "SEED",
                    startedAt: new Date(),
                  },
                },
              },
            },
          },
        });
        await tx.databaseMetadata.upsert({
          where: { key: credentialMarkerKey },
          create: { key: credentialMarkerKey, value: "issued-v1" },
          update: { value: "reissued-after-account-recreation-v1" },
        });
      });
      created++;
    }
    // Emit immediately after this account commits. A later failure cannot
    // leave already-created accounts with passwords that were never shown.
    console.log(`${account}\t${temporaryPassword}`);
  }
  const last = `student${String(STUDENT_COUNT).padStart(2, "0")}`;
  console.log(
    `Students: ${created} created, ${rotated} unclaimed rotated, ${existed} unchanged | ` +
      `account: student01..${last}`,
  );
}

async function assertSeedStudentNumbers() {
  const missing = await prisma.studentEnrollment.count({ where: { origin: "SEED", studentNumber: null, student: { user: { role: ROLES.STUDENT } } } });
  if (missing > 0) throw new Error(`示範學生資料有 ${missing} 筆缺少學號，請修正 seed 後再繼續。`);
}

// ── 本地測試學生 ──
// 與批量 student01..40 的「首次登入預設密碼」分開：測試學生視為已經完成改密，
// mustChangePassword=false，可直接進入學習頁。必須明確 opt-in，正式環境預設不建立。
async function seedTestStudent(
  username: string,
  password: string,
  databaseEnvironment: DatabaseEnvironment,
  studentNumber: number,
) {
  if (databaseEnvironment === "production") {
    throw new Error("正式環境禁止建立本地測試學生帳號。");
  }
  if (!Number.isSafeInteger(studentNumber) || studentNumber <= 0) {
    throw new Error(`測試學生學號無效：${studentNumber}`);
  }
  const policyError = passwordPolicyError(password);
  if (policyError) throw new Error(policyError);
  const hash = await bcrypt.hash(password, 12);
  const currentYear = await ensureSeedCurrentYear();
  const classes = await ensureSeedClasses(currentYear.id);
  const classId = classes[0]?.JUNIOR_1 ?? null;
  const existing = await prisma.user.findUnique({
    where: { accountName: username },
  });
  if (existing) {
    throw new Error(
      `測試學生帳號「${username}」已經存在；seed 不會覆蓋現有帳號或改變其角色。` +
        "請使用新的保留測試帳號，或先由管理員明確刪除該帳號。",
    );
  }
  await prisma.user.create({
    data: {
      accountName: username,
      accountNameCanonical: username,
      passwordHash: hash,
      credentialRevision: 1,
      legacyName: "本地測試學生",
      role: ROLES.STUDENT,
      // 這組獨立測試憑證視為已經完成首次改密，可直接進入學習頁。
      mustChangePassword: false,
      studentProfile: {
        create: {
          legalName: "本地測試學生",
          nickname: "本地測試生",
          nicknameNormalized: "本地測試生",
            enrollments: {
              create: {
                academicYearId: currentYear.id,
                grade: "JUNIOR_1",
                classId,
                studentNumber,
                isCurrent: true,
              status: "ACTIVE",
              origin: "SEED",
              startedAt: new Date(),
            },
          },
        },
      },
    },
  });
  console.log(`測試學生已就緒：${username}（已建立）`);
}

// ── 管理員 / 教師種子帳號 ──
// 透過 CLI seed 建立，取代舊的公開 HTTP 端點 /api/seed-roles（避免無鑑權提權）。
// 初始密碼必須來自環境變數 INITIAL_ADMIN_PASSWORD，嚴禁硬編碼（安全審計要求）。
// 帳號已存在時僅校正角色，絕不覆蓋密碼；角色變更會撤銷舊 JWT。
async function seedRoles(password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new Error(`INITIAL_ADMIN_PASSWORD：${policyError}`);
  const hash = await bcrypt.hash(password, 12);

  const ensureRole = async (
    accountName: string,
    legalName: string,
    role: typeof ROLES.ADMIN | typeof ROLES.TEACHER,
  ) => {
    const existing = await prisma.user.findUnique({ where: { accountName } });
    if (!existing) {
      return prisma.user.create({
        data: {
          accountName,
          accountNameCanonical: accountName,
          passwordHash: hash,
          credentialRevision: 1,
          legacyName: legalName,
          role,
          mustChangePassword: false,
          ...(role === ROLES.TEACHER
            ? { teacherProfile: { create: { legalName, canResetStudentPassword: false } } }
            : {}),
        },
      });
    }
    if (role === ROLES.TEACHER) {
      await prisma.teacherProfile.upsert({
        where: { userId: existing.id },
        create: { userId: existing.id, legalName, accessRevision: 0, canResetStudentPassword: false },
        update: {},
      });
    }
    if (existing.role === role) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { accountNameCanonical: accountName },
      });
    }
    if (existing.role === ROLES.ADMIN && role !== ROLES.ADMIN) {
      console.warn(
        `保留現有管理員帳號 ${accountName}，不會因 seed 的教師角色設定將其降級。`,
      );
      return existing;
    }
    return prisma.user.update({
      where: { id: existing.id },
      data: { role, tokenVersion: { increment: 1 }, accountNameCanonical: accountName },
    });
  };

  const admin = await ensureRole("admin", "管理員", ROLES.ADMIN);
  const teacher = await ensureRole("teacher", "王老師", ROLES.TEACHER);

  console.log(
    `Roles seeded: admin (id=${admin.id}), teacher (id=${teacher.id})`,
  );
}

async function seedTeacherCapabilityFixtures(password: string, databaseEnvironment: DatabaseEnvironment) {
  if (databaseEnvironment === "production") return;
  const currentYear = await ensureSeedCurrentYear();
  const classA = await prisma.schoolClass.upsert({ where: { academicYearId_grade_classCode: { academicYearId: currentYear.id, grade: "JUNIOR_1", classCode: "A" } }, create: { academicYearId: currentYear.id, grade: "JUNIOR_1", classCode: "A" }, update: { active: true } });
  const classB = await prisma.schoolClass.upsert({ where: { academicYearId_grade_classCode: { academicYearId: currentYear.id, grade: "JUNIOR_1", classCode: "B" } }, create: { academicYearId: currentYear.id, grade: "JUNIOR_1", classCode: "B" }, update: { active: true } });
  const hash = await bcrypt.hash(password, 12);
  const accountName = "teacher-reset";
  const teacher = await prisma.user.upsert({
    where: { accountName },
    create: { accountName, accountNameCanonical: accountName, passwordHash: hash, credentialRevision: 1, legacyName: "重設密碼測試老師", role: ROLES.TEACHER, mustChangePassword: false, teacherProfile: { create: { legalName: "重設密碼測試老師", canResetStudentPassword: true } } },
    update: { accountNameCanonical: accountName, role: ROLES.TEACHER, status: "ACTIVE", teacherProfile: { upsert: { create: { legalName: "重設密碼測試老師", canResetStudentPassword: true }, update: { canResetStudentPassword: true } } } },
    select: { id: true },
  });
  await prisma.teacherClassAccess.upsert({ where: { teacherId_classId: { teacherId: teacher.id, classId: classA.id } }, create: { teacherId: teacher.id, classId: classA.id, canViewProgress: true, canResetStudentPassword: true }, update: { canViewProgress: true, canResetStudentPassword: true } });
  await prisma.teacherClassAccess.upsert({ where: { teacherId_classId: { teacherId: teacher.id, classId: classB.id } }, create: { teacherId: teacher.id, classId: classB.id, canViewProgress: true, canResetStudentPassword: true }, update: { canViewProgress: true, canResetStudentPassword: true } });
  console.log(`Teacher fixtures ready: teacher (global reset off), ${accountName} (global reset on, two classes)`);
}

async function main() {
  const databaseEnvironment = await requireDatabaseEnvironment();
  // 初始密碼必須由環境變數提供，嚴禁硬編碼（安全審計要求）。
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const initialPasswordError = passwordPolicyError(initialPassword ?? "");
  if (!initialPassword || initialPasswordError) {
    throw new Error(`INITIAL_ADMIN_PASSWORD：${initialPasswordError}`);
  }

  const catalog = await prisma.$transaction(
    (tx) =>
      seedCatalog(tx, {
        environment: databaseEnvironment,
        actor: "prisma/seed",
        finalize: process.env.CATALOG_FINALIZE !== "0",
      }),
    { isolationLevel: "Serializable", timeout: 120_000 },
  );
  console.log(
    `Catalog ready: ${catalog.rows} rows, ${catalog.validRows} valid, ` +
      `${catalog.validationFailed} failed, ${catalog.active} ACTIVE, ` +
      `${catalog.draft} DRAFT, ${catalog.retired} RETIRED, ` +
      `${catalog.projections} Word compatibility projections | ` +
      `revision=${catalog.catalogRevisionKey}`,
  );

  // 管理員 / 教師帳號（每次 seed 都會 upsert，冪等）。
  await seedRoles(initialPassword);
  await seedTeacherCapabilityFixtures(initialPassword, databaseEnvironment);

  // 學生帳號預設不建立；需要時在 .env 設 SEED_STUDENTS=1 重新跑 seed 即可。
  if (process.env.SEED_STUDENTS === "1") {
    await seedStudents();
    await assertSeedStudentNumbers();
  }
  // 建議新變數；保留舊 SEED_TEST_ACCOUNT / TEST_ACCOUNT_PASSWORD 一個發布週期，
  // 讓已有本地環境升級後不會突然失效。
  if (
    process.env.SEED_TEST_STUDENT === "1" ||
    process.env.SEED_TEST_ACCOUNT === "1"
  ) {
    const testUsername = (
      process.env.TEST_STUDENT_USERNAME ?? "__test_student__local"
    ).trim();
    const webkitTestUsername = (
      process.env.TEST_STUDENT_WEBKIT_USERNAME ??
      `${testUsername.slice(0, 56)}_webkit`
    ).trim();
    const testPassword =
      process.env.TEST_STUDENT_PASSWORD ??
      process.env.TEST_ACCOUNT_PASSWORD ??
      "";
    for (const [name, username] of [
      ["TEST_STUDENT_USERNAME", testUsername],
      ["TEST_STUDENT_WEBKIT_USERNAME", webkitTestUsername],
    ] as const) {
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
        throw new Error(
          `${name} 必須為 3–64 位，只可包含字母、數字、點、底線或連字號。`,
        );
      }
      if (!username.startsWith("__test_student__") && !username.startsWith("student-test")) {
        throw new Error(
          `${name} 必須使用保留前綴 __test_student__，避免誤用現有帳號。`,
        );
      }
    }
    const testPasswordError = passwordPolicyError(testPassword);
    if (testPasswordError) {
      throw new Error(`TEST_STUDENT_PASSWORD：${testPasswordError}`);
    }
    const testStudentFixtures = [
      {
        username: testUsername,
        studentNumber: TEST_STUDENT_NUMBER,
      },
      ...(webkitTestUsername !== testUsername
        ? [
            {
              username: webkitTestUsername,
              studentNumber: WEBKIT_TEST_STUDENT_NUMBER,
            },
          ]
        : []),
    ];
    const studentNumbers = testStudentFixtures.map(
      (fixture) => fixture.studentNumber,
    );
    if (new Set(studentNumbers).size !== studentNumbers.length) {
      throw new Error("測試學生 fixture 使用了重複學號。");
    }
    for (const fixture of testStudentFixtures) {
      await seedTestStudent(
        fixture.username,
        testPassword,
        databaseEnvironment,
        fixture.studentNumber,
      );
    }
    await assertSeedStudentNumbers();
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
