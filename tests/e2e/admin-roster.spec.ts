import { expect, test, type APIResponse, type Page } from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

type ActivationScaleFixture = { sourceAcademicYearId: string; targetAcademicYearId: string; sourceCount: number; adminAccountName: string };
type RosterPerfMeasurement = { elapsedMs: number; peakRssDeltaMiB: number };

async function measureRosterPerformance<T>(operation: () => Promise<T>): Promise<{ value: T } & RosterPerfMeasurement> {
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  sample();
  const startedAt = performance.now();
  const timer = setInterval(sample, 100);
  try {
    const value = await operation();
    sample();
    return { value, elapsedMs: Math.round(performance.now() - startedAt), peakRssDeltaMiB: Number(((peakRss - baselineRss) / 1024 / 1024).toFixed(2)) };
  } finally {
    clearInterval(timer);
  }
}

type MeasuredStudentImport = {
  rows: string[];
  preview: { batchId: string; operationId?: string; rowCount: number; errorCount: number; canCommit: boolean; nextCursor: string | null };
  previewMeasurement: RosterPerfMeasurement & { value: APIResponse };
  commitMeasurement: RosterPerfMeasurement & { value: APIResponse };
  commitResponse: APIResponse;
  transactionMs: number;
};

async function runMeasuredStudentImport(page: Page, headers: Record<string, string>, academicYearId: string, prefix: string, operationPrefix: string): Promise<MeasuredStudentImport> {
  const rows = ["accountName,legalName,nickname,grade,classCode,contactEmail"];
  for (let index = 0; index < 500; index += 1) rows.push(`${prefix}${index},规模测试学生${index},规模昵称${index},JUNIOR_1,,`);
  const csv = Buffer.from(rows.join("\n"));
  const previewMeasurement = await measureRosterPerformance(() => page.request.post("/api/admin/roster/import/preview", {
    headers,
    multipart: {
      file: { name: `${operationPrefix}-500.csv`, mimeType: "text/csv", buffer: csv },
      entityType: "STUDENT",
      academicYearId,
      mode: "CREATE_ONLY",
      operationId: `${operationPrefix}-preview-${Date.now()}`,
    },
  }));
  const previewResponse = previewMeasurement.value;
  expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
  const preview = await previewResponse.json() as MeasuredStudentImport["preview"];
  expect(preview.rowCount).toBe(500);
  expect(preview.errorCount).toBe(0);
  expect(preview.canCommit).toBeTruthy();
  const commitMeasurement = await measureRosterPerformance(() => page.request.post(`/api/admin/roster/import/${preview.batchId}/commit`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { operationId: preview.operationId },
  }));
  const commitResponse = commitMeasurement.value;
  const transactionMatch = /dur=([\d.]+)/.exec(commitResponse.headers()["server-timing"] ?? "");
  expect(transactionMatch, "commit response must expose local transaction timing").toBeTruthy();
  const transactionMs = Number(transactionMatch?.[1]);
  expect(commitResponse.ok(), await commitResponse.text()).toBeTruthy();
  const committed = await commitResponse.json() as { summary?: { createdCount?: number; rowCount?: number }; credentials?: Array<{ accountName: string; temporaryPassword: string }> };
  expect(committed.summary?.createdCount).toBe(500);
  expect(committed.summary?.rowCount).toBe(500);
  expect(committed.credentials).toHaveLength(500);
  return { rows, preview, previewMeasurement, commitMeasurement, commitResponse, transactionMs };
}

function insertRows(rows: unknown[][]) {
  const values: unknown[] = [];
  const placeholders = rows.map((row) => {
    const columns = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${columns.join(",")})`;
  });
  return { placeholders: placeholders.join(","), values };
}

async function seedActivationScaleFixture(count: number): Promise<ActivationScaleFixture> {
  const connectionString = process.env.MIGRATE_URL;
  if (!connectionString) throw new Error("MIGRATE_URL is required for the activation scale fixture");
  const client = new Client({ connectionString });
  await client.connect();
  const fixtureKey = randomUUID().replaceAll("-", "");
  try {
    await client.query("BEGIN");
    const sourceResult = await client.query<{ id: string; endsOn: string }>(`SELECT "id", "endsOn"::text AS "endsOn" FROM "AcademicYear" WHERE "status" = 'CURRENT'::"AcademicYearStatus" FOR UPDATE`);
    if (sourceResult.rows.length !== 1) throw new Error("activation scale requires one current academic year");
    const source = sourceResult.rows[0]!;
    const currentResult = await client.query<{ id: string; studentId: string; grade: string }>(`
      SELECT e."id", e."studentId", e."grade"::text AS "grade"
      FROM "StudentEnrollment" e
      JOIN "StudentProfile" p ON p."userId" = e."studentId"
      JOIN "User" u ON u."id" = p."userId"
      WHERE e."academicYearId" = $1 AND e."status" = 'ACTIVE'::"EnrollmentStatus" AND u."role" = 'STUDENT'::"Role"
      ORDER BY e."studentId"
    `, [source.id]);
    if (currentResult.rows.length > count) throw new Error("activation scale fixture is smaller than the seeded current roster");
    const admin = await client.query<{ id: string; passwordHash: string }>(`SELECT "id", "passwordHash" FROM "User" WHERE "email" = 'admin' AND "role" = 'ADMIN'::"Role" LIMIT 1`);
    if (!admin.rows[0]) throw new Error("seeded admin is required for activation scale fixture");
    const scaleAdminAccountName = `scale-admin-${fixtureKey}`;
    await client.query(`INSERT INTO "User" ("id", "email", "accountNameCanonical", "passwordHash", "name", "role", "status", "mustChangePassword") VALUES ($1, $2, $2, $3, $4, 'ADMIN'::"Role", 'ACTIVE'::"AccountStatus", false)`, [`scale-admin-${fixtureKey}`, scaleAdminAccountName, admin.rows[0].passwordHash, "activation-scale-admin"]);
    const extraCount = count - currentResult.rows.length;
    const extraUsers = Array.from({ length: extraCount }, (_, index) => {
      const suffix = `${fixtureKey}-${index}`;
      return { id: `scale-user-${suffix}`, accountName: `scale${suffix}`, legalName: `scale-user-${index}`, nickname: `scale-nickname-${index}` };
    });
    for (let offset = 0; offset < extraUsers.length; offset += 500) {
      const chunk = extraUsers.slice(offset, offset + 500);
      const chunkTimestamp = new Date();
      const users = insertRows(chunk.map((user) => [user.id, user.accountName, user.accountName, admin.rows[0]!.passwordHash, user.legalName, "STUDENT", "ACTIVE", false]));
      await client.query(`INSERT INTO "User" ("id", "email", "accountNameCanonical", "passwordHash", "name", "role", "status", "mustChangePassword") VALUES ${users.placeholders}`, users.values);
      const profiles = insertRows(chunk.map((user) => [user.id, user.legalName, user.nickname, user.nickname.toLowerCase(), chunkTimestamp, chunkTimestamp]));
      await client.query(`INSERT INTO "StudentProfile" ("userId", "legalName", "nickname", "nicknameNormalized", "createdAt", "updatedAt") VALUES ${profiles.placeholders}`, profiles.values);
      const enrollments = insertRows(chunk.map((user) => [`scale-source-${user.id}`, user.id, source.id, "JUNIOR_1", null, true, "ACTIVE", "IMPORT", chunkTimestamp, null, chunkTimestamp, chunkTimestamp]));
      await client.query(`INSERT INTO "StudentEnrollment" ("id", "studentId", "academicYearId", "grade", "classId", "isCurrent", "status", "origin", "startedAt", "endedAt", "createdAt", "updatedAt") VALUES ${enrollments.placeholders}`, enrollments.values);
      currentResult.rows.push(...chunk.map((user) => ({ id: `scale-source-${user.id}`, studentId: user.id, grade: "JUNIOR_1" })));
    }

    const targetAcademicYearId = `scale-year-${fixtureKey}`;
    const yearTimestamp = new Date();
    const labelStartYear = 4000 + Number.parseInt(fixtureKey.slice(0, 4), 16) % 1_000;
    await client.query(`INSERT INTO "AcademicYear" ("id", "label", "startsOn", "endsOn", "isCurrent", "status", "createdAt", "updatedAt") SELECT $1, $2, ("endsOn" + 1), ("endsOn" + 365), false, 'PLANNED'::"AcademicYearStatus", $3, $3 FROM "AcademicYear" WHERE "id" = $4`, [targetAcademicYearId, `${labelStartYear}-${labelStartYear + 1}`, yearTimestamp, source.id]);

    const targetRows: Array<{ id: string; studentId: string; grade: string; disposition: "PROMOTE" | "HOLD_UNASSIGNED"; sourceEnrollmentId: string }> = [];
    for (const sourceEnrollment of currentResult.rows) {
      const targetGrade = sourceEnrollment.grade === "SENIOR_3" ? "SENIOR_3" : ({ JUNIOR_1: "JUNIOR_2", JUNIOR_2: "JUNIOR_3", JUNIOR_3: "SENIOR_1", SENIOR_1: "SENIOR_2", SENIOR_2: "SENIOR_3" } as Record<string, string>)[sourceEnrollment.grade]!;
      targetRows.push({ id: `scale-target-${sourceEnrollment.id}`, studentId: sourceEnrollment.studentId, grade: targetGrade, disposition: sourceEnrollment.grade === "SENIOR_3" ? "HOLD_UNASSIGNED" : "PROMOTE", sourceEnrollmentId: sourceEnrollment.id });
    }
    for (let offset = 0; offset < targetRows.length; offset += 500) {
      const chunk = targetRows.slice(offset, offset + 500);
      const chunkTimestamp = new Date();
      const enrollments = insertRows(chunk.map((row) => [row.id, row.studentId, targetAcademicYearId, row.grade, null, false, "PLANNED", "PROMOTION", chunkTimestamp, chunkTimestamp]));
      await client.query(`INSERT INTO "StudentEnrollment" ("id", "studentId", "academicYearId", "grade", "classId", "isCurrent", "status", "origin", "createdAt", "updatedAt") VALUES ${enrollments.placeholders}`, enrollments.values);
      const transitions = insertRows(chunk.map((row) => [`scale-transition-${row.sourceEnrollmentId}`, row.studentId, row.sourceEnrollmentId, source.id, targetAcademicYearId, row.disposition, row.id, admin.rows[0]!.id, "actor-v1:activation-scale", "e2e-v1", chunkTimestamp, chunkTimestamp]));
      await client.query(`INSERT INTO "StudentYearTransition" ("id", "studentId", "sourceEnrollmentId", "sourceAcademicYearId", "targetAcademicYearId", "disposition", "targetEnrollmentId", "actorUserId", "actorPseudonym", "hmacKeyVersion", "createdAt", "updatedAt") VALUES ${transitions.placeholders}`, transitions.values);
    }
    await client.query("COMMIT");
    return { sourceAcademicYearId: source.id, targetAcademicYearId, sourceCount: currentResult.rows.length, adminAccountName: scaleAdminAccountName };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

test("admin roster shell and one-row import remain atomic and disposable", async ({ page }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the admin roster smoke.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill("admin");
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  await page.goto("/admin/roster");
  await expect(page.getByRole("heading", { name: /班级、学生与教师|班級、學生與教師/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /学生名册|學生名冊/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /汇入|匯入/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /汇出|匯出/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article").first()).toBeVisible();
  await expect(page.locator("table").first()).toBeHidden();
  await page.addScriptTag({ content: axe.source });
  const a11yViolations = await page.evaluate(async () => {
    const axeApi = (window as Window & { axe?: { run: (context: Document, options: { runOnly: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }> }> } }).axe;
    if (!axeApi) throw new Error("axe failed to load");
    const result = await axeApi.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
    return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map((node) => node.target) }));
  });
  expect(a11yViolations, "admin roster serious/critical axe violations").toEqual([]);

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken! };
  const reauthResponse = await page.request.post("/api/auth/reauth", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { password },
  });
  expect(reauthResponse.ok()).toBeTruthy();

  const yearsResponse = await page.request.get("/api/admin/academic-years");
  expect(yearsResponse.ok()).toBeTruthy();
  const years = await yearsResponse.json() as Array<{ id: string; status: string }>;
  const current = years.find((year) => year.status === "CURRENT");
  expect(current).toBeTruthy();

  const accountName = `e2e${Date.now().toString(36)}`;
  const csv = [
    "accountName,legalName,nickname,grade,classCode,contactEmail",
    `${accountName},E2E Disposable Student,测试同学,JUNIOR_1,A,`,
  ].join("\n");
  const previewResponse = await page.request.post("/api/admin/roster/import/preview", {
    headers,
    multipart: {
      file: { name: "student-roster.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
      entityType: "STUDENT",
      academicYearId: current!.id,
      mode: "CREATE_ONLY",
      operationId: `e2e-import-${Date.now()}`,
    },
  });
  expect(previewResponse.ok()).toBeTruthy();
  const preview = await previewResponse.json() as { batchId: string; operationId?: string; canCommit: boolean; errorCount: number };
  expect(preview.canCommit).toBeTruthy();
  expect(preview.errorCount).toBe(0);

  const commitResponse = await page.request.post(`/api/admin/roster/import/${preview.batchId}/commit`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { operationId: preview.operationId },
  });
  expect(commitResponse.ok()).toBeTruthy();
  const committed = await commitResponse.json() as { credentials?: Array<{ accountName: string; temporaryPassword: string }> };
  expect(committed.credentials?.some((item) => item.accountName === accountName)).toBeTruthy();

  const rosterResponse = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(current!.id)}&search=${encodeURIComponent(accountName)}`);
  expect(rosterResponse.ok()).toBeTruthy();
  const roster = await rosterResponse.json() as { items?: Array<{ id: string; accountName: string }> };
  const created = roster.items?.find((item) => item.accountName === accountName);
  expect(created).toBeTruthy();

  // The roster status control must be a real action, not just a status label.
  // Exercise the same mobile card that administrators use on a narrow screen,
  // then verify both the visible state and the persisted server state.
  await page.getByPlaceholder(/搜寻账号|搜尋賬號/u).fill(accountName);
  const statusToggle = page.locator('[data-testid="roster-status-toggle"]:visible');
  await expect(statusToggle).toHaveText(/停权|停權/u);
  await statusToggle.click();
  await expect(page.getByRole("status")).toContainText(/账号已停权|賬號已停權/u);
  await expect(statusToggle).toHaveText(/恢复|恢復/u);
  const suspendedRosterResponse = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(current!.id)}&search=${encodeURIComponent(accountName)}`);
  expect(suspendedRosterResponse.ok()).toBeTruthy();
  const suspendedRoster = await suspendedRosterResponse.json() as { items?: Array<{ accountName: string; status: string }> };
  expect(suspendedRoster.items?.find((item) => item.accountName === accountName)?.status).toBe("SUSPENDED");

  await statusToggle.click();
  await expect(page.getByRole("status")).toContainText(/账号已恢复|賬號已恢復/u);
  await expect(statusToggle).toHaveText(/停权|停權/u);
  const restoredRosterResponse = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(current!.id)}&search=${encodeURIComponent(accountName)}`);
  expect(restoredRosterResponse.ok()).toBeTruthy();
  const restoredRoster = await restoredRosterResponse.json() as { items?: Array<{ accountName: string; status: string }> };
  expect(restoredRoster.items?.find((item) => item.accountName === accountName)?.status).toBe("ACTIVE");

  const deleteResponse = await page.request.delete(`/api/admin/users/${created!.id}`, {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { confirmation: accountName },
  });
  expect(deleteResponse.ok()).toBeTruthy();
});

test("admin roster completes the year rollover workflow on a disposable fixture", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the admin roster workflow.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill("admin");
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken!, "Content-Type": "application/json" };
  const reauthResponse = await page.request.post("/api/auth/reauth", { headers, data: { password } });
  expect(reauthResponse.ok()).toBeTruthy();

  const yearsResponse = await page.request.get("/api/admin/academic-years");
  expect(yearsResponse.ok()).toBeTruthy();
  const years = await yearsResponse.json() as Array<{ id: string; label: string; startsOn: string; status: string; revision: number }>;
  const source = years.find((year) => year.status === "CURRENT");
  expect(source).toBeTruthy();

  const createdUsers: Array<{ id: string; accountName: string }> = [];
  let teacherPassword = "";
  let teacherContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let studentContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let forcedStudentContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    // Reuse the canonical immediate successor when the standard seed already
    // provides one. Creating a far-future year would correctly be rejected by
    // the server's immediate-successor invariant.
    let targetYear = years
      .filter((year) => year.status === "PLANNED" && new Date(year.startsOn).getTime() > new Date(source!.startsOn).getTime())
      .sort((left, right) => new Date(left.startsOn).getTime() - new Date(right.startsOn).getTime())[0] as { id: string; status: string } | undefined;
    if (!targetYear) {
      const sourceEndYear = Number(source!.label.slice(5, 9));
      const targetYearResponse = await page.request.post("/api/admin/academic-years", { headers, data: { label: `${sourceEndYear}-${sourceEndYear + 1}` } });
      expect(targetYearResponse.status()).toBe(201);
      targetYear = await targetYearResponse.json() as { id: string; status: string };
    }
    expect(targetYear.status).toBe("PLANNED");

    const targetGrades = ["JUNIOR_2", "JUNIOR_3", "SENIOR_1", "SENIOR_2", "SENIOR_3"] as const;
    const targetClasses: Array<{ id: string; grade: string; classCode: string }> = [];
    for (const grade of targetGrades) {
      const existing = await page.request.get(`/api/admin/classes?academicYearId=${encodeURIComponent(targetYear.id)}`);
      expect(existing.ok(), await existing.text()).toBeTruthy();
      const existingClasses = await existing.json() as Array<{ id: string; grade: string; classCode: string }>;
      const match = existingClasses.find((schoolClass) => schoolClass.grade === grade && schoolClass.classCode === "A");
      if (match) {
        targetClasses.push(match);
      } else {
        const response = await page.request.post("/api/admin/classes", { headers, data: { academicYearId: targetYear.id, grade, classCode: "A" } });
        expect(response.status()).toBe(201);
        targetClasses.push(await response.json() as { id: string; grade: string; classCode: string });
      }
    }
    const currentClassesResponse = await page.request.get(`/api/admin/classes?academicYearId=${encodeURIComponent(source!.id)}`);
    expect(currentClassesResponse.ok()).toBeTruthy();
    const currentClasses = await currentClassesResponse.json() as Array<{ id: string; grade: string; classCode: string; active: boolean }>;
    const currentJuniorOneA = currentClasses.find((schoolClass) => schoolClass.grade === "JUNIOR_1" && schoolClass.classCode === "A" && schoolClass.active);
    expect(currentJuniorOneA).toBeTruthy();
    let currentJuniorOneB = currentClasses.find((schoolClass) => schoolClass.grade === "JUNIOR_1" && schoolClass.classCode === "B" && schoolClass.active);
    if (!currentJuniorOneB) {
      const response = await page.request.post("/api/admin/classes", { headers, data: { academicYearId: source!.id, grade: "JUNIOR_1", classCode: "B" } });
      expect(response.status()).toBe(201);
      currentJuniorOneB = await response.json() as { id: string; grade: string; classCode: string; active: boolean };
    }

    // The lightweight standard seed may not contain an active student in
    // every grade. Fill only missing source grades so this workflow exercises
    // the six-grade rollover contract without depending on incidental seed
    // distribution. All created rows are tracked for the disposable cleanup.
    const promotionGrades = ["JUNIOR_1", "JUNIOR_2", "JUNIOR_3", "SENIOR_1", "SENIOR_2", "SENIOR_3"] as const;
    const missingSourceGrades: typeof promotionGrades[number][] = [];
    for (const grade of promotionGrades) {
      const response = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(source!.id)}&role=STUDENT&grade=${grade}&limit=1`);
      expect(response.ok(), await response.text()).toBeTruthy();
      const payload = await response.json() as { items?: Array<{ id: string }> };
      if (!payload.items?.length) {
        missingSourceGrades.push(grade);
        if (!currentClasses.some((schoolClass) => schoolClass.grade === grade && schoolClass.classCode === "A" && schoolClass.active)) {
          const classResponse = await page.request.post("/api/admin/classes", { headers, data: { academicYearId: source!.id, grade, classCode: "A" } });
          expect(classResponse.status()).toBe(201);
          currentClasses.push(await classResponse.json() as { id: string; grade: string; classCode: string; active: boolean });
        }
      }
    }

    const teacherAccount = `flowteacher${Date.now().toString(36)}`;
    const teacherResponse = await page.request.post("/api/admin/users", { headers, data: { role: "TEACHER", accountName: teacherAccount, legalName: "流程測試老師" } });
    expect(teacherResponse.status()).toBe(201);
    const teacher = await teacherResponse.json() as { id: string; temporaryPassword?: string };
    teacherPassword = teacher.temporaryPassword ?? "";
    expect(teacherPassword).toBeTruthy();
    createdUsers.push({ id: teacher.id, accountName: teacherAccount });
    const teacherStateResponse = await page.request.get(`/api/admin/roster/teachers/${teacher.id}/access-settings?academicYearId=${encodeURIComponent(targetYear.id)}`);
    expect(teacherStateResponse.ok(), await teacherStateResponse.text()).toBeTruthy();
    const teacherState = await teacherStateResponse.json() as { accessRevision: number };
    const teacherAccessResponse = await page.request.put(`/api/admin/roster/teachers/${teacher.id}/access-settings`, { headers, data: { accessRevision: teacherState.accessRevision, globalCapabilities: { canResetStudentPassword: true, acknowledgeImmediateEffect: true }, classAccess: { academicYearId: targetYear.id, classIds: [targetClasses[0].id] } } });
    expect(teacherAccessResponse.ok(), await teacherAccessResponse.text()).toBeTruthy();

    const accountName = `flowstudent${Date.now().toString(36)}`;
    const csv = [
      "accountName,legalName,nickname,grade,classCode,contactEmail",
      `${accountName},流程測試學生,流程暱稱,JUNIOR_1,B,`,
    ].join("\n");
    const importPreviewResponse = await page.request.post("/api/admin/roster/import/preview", {
      headers: { Origin: headers.Origin, "x-csrf-token": headers["x-csrf-token"] },
      multipart: { file: { name: "student-roster.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }, entityType: "STUDENT", academicYearId: source!.id, mode: "CREATE_ONLY", operationId: `flow-import-${Date.now()}` },
    });
    expect(importPreviewResponse.ok()).toBeTruthy();
    const importPreview = await importPreviewResponse.json() as { batchId: string; operationId?: string; canCommit: boolean; errorCount: number };
    expect(importPreview.canCommit).toBeTruthy();
    expect(importPreview.errorCount).toBe(0);
    const importCommitResponse = await page.request.post(`/api/admin/roster/import/${importPreview.batchId}/commit`, { headers, data: { operationId: importPreview.operationId } });
    expect(importCommitResponse.ok()).toBeTruthy();
    const importCommit = await importCommitResponse.json() as { credentials?: Array<{ accountName: string; temporaryPassword: string }> };
    const importedCredential = importCommit.credentials?.find((credential) => credential.accountName === accountName);
    expect(importedCredential).toBeTruthy();

    const rotationPreviewResponse = await page.request.post(`/api/admin/roster/import/${importPreview.batchId}/rotate-credentials/preview`, { headers, data: { operationId: `flow-rotation-preview-${Date.now()}` } });
    expect(rotationPreviewResponse.ok()).toBeTruthy();
    const rotationPreview = await rotationPreviewResponse.json() as { batchId: string; operationId: string; eligible: Array<{ accountName: string }> };
    expect(rotationPreview.eligible.some((credential) => credential.accountName === accountName)).toBeTruthy();
    const rotationCommitResponse = await page.request.post(`/api/admin/roster/import/${rotationPreview.batchId}/rotate-credentials/commit`, { headers, data: { operationId: rotationPreview.operationId } });
    expect(rotationCommitResponse.ok()).toBeTruthy();
    const rotationCommit = await rotationCommitResponse.json() as { credentials?: Array<{ accountName: string; temporaryPassword: string }> };
    const rotatedCredential = rotationCommit.credentials?.find((credential) => credential.accountName === accountName);
    expect(rotatedCredential).toBeTruthy();

    const rosterResponse = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(source!.id)}&role=STUDENT&search=${encodeURIComponent(accountName)}`);
    expect(rosterResponse.ok()).toBeTruthy();
    const roster = await rosterResponse.json() as { items?: Array<{ id: string; accountName: string; revision: number }> };
    const importedStudent = roster.items?.find((item) => item.accountName === accountName);
    expect(importedStudent).toBeTruthy();
    createdUsers.push({ id: importedStudent!.id, accountName });

    if (missingSourceGrades.length) {
      const suffix = Date.now().toString(36);
      const missingRows = [
        "accountName,legalName,nickname,grade,classCode,contactEmail",
        ...missingSourceGrades.map((grade) => `flowseed${grade.toLowerCase()}${suffix},流程${grade}學生${suffix},流程${grade}暱稱${suffix},${grade},A,`),
      ].join("\n");
      const missingPreviewResponse = await page.request.post("/api/admin/roster/import/preview", {
        headers: { Origin: headers.Origin, "x-csrf-token": headers["x-csrf-token"] },
        multipart: { file: { name: "rollover-missing-grades.csv", mimeType: "text/csv", buffer: Buffer.from(missingRows) }, entityType: "STUDENT", academicYearId: source!.id, mode: "CREATE_ONLY", operationId: `flow-missing-grades-${suffix}` },
      });
      expect(missingPreviewResponse.ok(), await missingPreviewResponse.text()).toBeTruthy();
      const missingPreview = await missingPreviewResponse.json() as { batchId: string; operationId?: string; errorCount: number };
      expect(missingPreview.errorCount).toBe(0);
      const missingCommitResponse = await page.request.post(`/api/admin/roster/import/${missingPreview.batchId}/commit`, { headers, data: { operationId: missingPreview.operationId } });
      expect(missingCommitResponse.ok(), await missingCommitResponse.text()).toBeTruthy();
      for (const grade of missingSourceGrades) {
        const account = `flowseed${grade.toLowerCase()}${suffix}`;
        const response = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(source!.id)}&role=STUDENT&search=${encodeURIComponent(account)}&limit=1`);
        expect(response.ok(), await response.text()).toBeTruthy();
        const payload = await response.json() as { items?: Array<{ id: string; accountName: string }> };
        const created = payload.items?.find((item) => item.accountName === account);
        expect(created).toBeTruthy();
        createdUsers.push({ id: created!.id, accountName: account });
      }
    }

    // Student profile/nickname CAS, moderation and account suspension must be
    // enforced by the server, not only by the profile UI.
    studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto("/login");
    await studentPage.getByLabel(/账号|賬號/).fill(accountName);
    await studentPage.getByLabel(/密码|密碼/).fill(rotatedCredential!.temporaryPassword);
    await studentPage.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await studentPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    const studentNewPassword = "FlowStudentNew!2026";
    await expect(studentPage).toHaveURL(/\/reset-password/u);
    await studentPage.getByLabel(/^(当前密码|當前密碼)$/u).fill(rotatedCredential!.temporaryPassword);
    await studentPage.getByLabel(/^(新密码|新密碼)$/u).fill(studentNewPassword);
    await studentPage.getByLabel(/^(确认新密码|確認新密碼)$/u).fill(studentNewPassword);
    await studentPage.locator("button[type=submit]").click({ timeout: 5_000 });
    await expect.poll(() => new URL(studentPage.url()).pathname, { timeout: 10_000 }).toBe("/");
    const studentCsrfResponse = await studentPage.request.get("/api/auth/csrf");
    expect(studentCsrfResponse.ok()).toBeTruthy();
    const studentCsrf = (await studentCsrfResponse.json() as { csrfToken?: string }).csrfToken;
    expect(studentCsrf).toBeTruthy();
    let studentHeaders = { Origin: "http://127.0.0.1:3100", "x-csrf-token": studentCsrf!, "Content-Type": "application/json" };
    const activeStudentCsrfResponse = await studentPage.request.get("/api/auth/csrf");
    expect(activeStudentCsrfResponse.ok()).toBeTruthy();
    const activeStudentCsrf = (await activeStudentCsrfResponse.json() as { csrfToken?: string }).csrfToken;
    expect(activeStudentCsrf).toBeTruthy();
    studentHeaders = { Origin: "http://127.0.0.1:3100", "x-csrf-token": activeStudentCsrf!, "Content-Type": "application/json" };
    const v2AssignmentResponse = await studentPage.request.get("/api/study/stream?assignmentOnly=1");
    expect(v2AssignmentResponse.ok()).toBeTruthy();
    expect(await v2AssignmentResponse.json()).toMatchObject({ ok: true, assigned: true, flowVersion: "v2" });
    const activeV2StreamResponse = await studentPage.request.get("/api/study/stream");
    expect(activeV2StreamResponse.ok(), await activeV2StreamResponse.text()).toBeTruthy();
    const profileResponse = await studentPage.request.get("/api/student/profile");
    expect(profileResponse.ok()).toBeTruthy();
    const profile = await profileResponse.json() as { legalName: string; nickname: string; profileRevision: number };
    expect(profile.legalName).toBe("流程測試學生");
    const invalidAccountNickname = await studentPage.request.patch("/api/student/profile", { headers: studentHeaders, data: { nickname: accountName, profileRevision: profile.profileRevision } });
    expect(invalidAccountNickname.status()).toBe(422);
    const invalidLegalNameNickname = await studentPage.request.patch("/api/student/profile", { headers: studentHeaders, data: { nickname: profile.legalName, profileRevision: profile.profileRevision } });
    expect(invalidLegalNameNickname.status()).toBe(422);
    const nicknameUpdate = await studentPage.request.patch("/api/student/profile", { headers: studentHeaders, data: { nickname: "流程新暱稱", profileRevision: profile.profileRevision } });
    expect(nicknameUpdate.ok()).toBeTruthy();
    const updatedProfile = await nicknameUpdate.json() as { nickname: string; profileRevision: number };
    expect(updatedProfile.nickname).toBe("流程新暱稱");
    const staleNicknameUpdate = await studentPage.request.patch("/api/student/profile", { headers: studentHeaders, data: { nickname: "流程舊版本", profileRevision: profile.profileRevision } });
    expect(staleNicknameUpdate.status()).toBe(409);

    // Keep representative V1/V2 browser state in the account namespace, then
    // prove the active study page clears it when the server revokes the
    // session. The restore path must not replay that state.
    await studentPage.goto("/study");
    await expect(studentPage.getByTestId("study-stream-title")).toBeVisible();
    await studentPage.evaluate((userId) => {
      const encoded = encodeURIComponent(userId);
      localStorage.setItem(`english:study-stream-v2:outbox:${userId}`, "[]");
      localStorage.setItem(`english:study-stream-v2:checkpoint:${userId}:global`, "{}");
      localStorage.setItem(`study:checkpoint:${encoded}:global`, "{}");
      localStorage.setItem(`study:review-queue:${encoded}`, "{}");
    }, importedStudent!.id);
    const suspendStudentResponse = await page.request.patch(`/api/admin/users/${importedStudent!.id}`, { headers, data: { operation: "CHANGE_STATUS", status: "SUSPENDED", expectedUserRevision: importedStudent!.revision } });
    expect(suspendStudentResponse.ok()).toBeTruthy();
    const suspendedStudent = await suspendStudentResponse.json() as { revision: number };
    await studentPage.reload();
    await expect.poll(() => studentPage.url()).toMatch(/\/login/u);
    await expect.poll(
      () => studentPage.evaluate((userId) => Object.keys(localStorage).filter((key) => key.includes(userId) || key.includes(encodeURIComponent(userId))), importedStudent!.id),
      { timeout: 5000 },
    ).toEqual([]);
    const suspendedProfileResponse = await studentPage.request.get("/api/student/profile");
    expect([401, 403, 503].includes(suspendedProfileResponse.status())).toBeTruthy();
    const suspendedV2StreamResponse = await studentPage.request.get("/api/study/stream");
    expect([401, 403, 503].includes(suspendedV2StreamResponse.status())).toBeTruthy();
    const restoreStudentResponse = await page.request.patch(`/api/admin/users/${importedStudent!.id}`, { headers, data: { operation: "CHANGE_STATUS", status: "ACTIVE", expectedUserRevision: suspendedStudent.revision } });
    expect(restoreStudentResponse.ok()).toBeTruthy();
    await studentContext.clearCookies();
    await studentPage.goto("/login");
    await studentPage.getByLabel(/账号|賬號/).fill(accountName);
    await studentPage.getByLabel(/密码|密碼/).fill(studentNewPassword);
    await studentPage.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await studentPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    await studentPage.goto("/study");
    await expect(studentPage.getByTestId("study-stream-title")).toBeVisible();
    const restoredStudyState = await studentPage.evaluate((userId) => {
      const keys = Object.keys(localStorage).filter((key) => key.includes(userId) || key.includes(encodeURIComponent(userId)));
      return {
        keys,
        v1Keys: keys.filter((key) => key.startsWith(`study:`)),
        v2Outbox: localStorage.getItem(`english:study-stream-v2:outbox:${userId}`),
      };
    }, importedStudent!.id);
    expect(restoredStudyState.v1Keys).toEqual([]);
    expect(restoredStudyState.v2Outbox).toBeNull();
    expect(restoredStudyState.keys.every((key) => key.startsWith(`english:study-stream-v2:checkpoint:${importedStudent!.id}:`))).toBeTruthy();

    const bulkPreviewResponse = await page.request.post("/api/admin/roster/students/bulk-class/preview", { headers, data: { academicYearId: source!.id, mode: "allMatching", filters: { grade: "JUNIOR_1", classCode: "B" }, classCode: "A", excludedIds: [], operationId: `flow-bulk-${Date.now()}` } });
    expect(bulkPreviewResponse.ok()).toBeTruthy();
    const bulkPreview = await bulkPreviewResponse.json() as { batchId: string; operationId?: string };
    const bulkCommitResponse = await page.request.post("/api/admin/roster/students/bulk-class/commit", { headers, data: { selectionBatchId: bulkPreview.batchId, operationId: bulkPreview.operationId } });
    expect(bulkCommitResponse.ok()).toBeTruthy();

    const classMapping = { A: "A", B: "A" };
    for (const sourceGrade of promotionGrades) {
      const promotionPreviewResponse = await page.request.post("/api/admin/roster/students/promote/preview", { headers, data: { sourceAcademicYearId: source!.id, targetAcademicYearId: targetYear.id, sourceGrade, excludedStudentIds: [], classMapping, operationId: `flow-promotion-${sourceGrade}-${Date.now()}` } });
      expect(promotionPreviewResponse.ok(), `${sourceGrade}: ${await promotionPreviewResponse.text()}`).toBeTruthy();
      const promotionPreview = await promotionPreviewResponse.json() as { batchId: string; operationId?: string; count: number };
      expect(promotionPreview.count).toBeGreaterThan(0);
      const promotionBatchResponse = await page.request.get(`/api/admin/mutation-batches/${promotionPreview.batchId}`);
      expect(promotionBatchResponse.ok()).toBeTruthy();
      const promotionBatch = await promotionBatchResponse.json() as { payload?: unknown };
      expect(JSON.stringify(promotionBatch.payload ?? {})).not.toMatch(/accountName|legalName|contactEmail|nickname/u);
      const promotionCommitResponse = await page.request.post("/api/admin/roster/students/promote/commit", { headers, data: { batchId: promotionPreview.batchId, operationId: promotionPreview.operationId } });
      expect(promotionCommitResponse.ok()).toBeTruthy();
    }

    const activationPreviewResponse = await page.request.post(`/api/admin/academic-years/${source!.id}/activation/preview`, { headers, data: { targetAcademicYearId: targetYear.id, acknowledgedClassIds: targetClasses.map((schoolClass) => schoolClass.id), operationId: `flow-activation-${Date.now()}` } });
    expect(activationPreviewResponse.ok()).toBeTruthy();
    const activationPreview = await activationPreviewResponse.json() as { batchId?: string; operationId?: string; pendingAcknowledgement?: boolean; sourceCount: number; targetCount: number };
    expect(activationPreview.pendingAcknowledgement).not.toBe(true);
    expect(activationPreview.batchId).toBeTruthy();
    expect(activationPreview.sourceCount).toBeGreaterThan(0);
    expect(activationPreview.targetCount).toBeGreaterThan(0);
    const activationBatchResponse = await page.request.get(`/api/admin/mutation-batches/${activationPreview.batchId}`);
    expect(activationBatchResponse.ok()).toBeTruthy();
    const activationBatch = await activationBatchResponse.json() as { payload?: unknown };
    expect(JSON.stringify(activationBatch.payload ?? {})).not.toMatch(/accountName|legalName|contactEmail|nickname/u);
    const activationCommitResponse = await page.request.post(`/api/admin/academic-years/${source!.id}/activation/commit`, { headers, data: { batchId: activationPreview.batchId, operationId: activationPreview.operationId } });
    expect(activationCommitResponse.ok(), await activationCommitResponse.text()).toBeTruthy();

    const exportBody = { entityType: "STUDENT", academicYearId: targetYear.id, format: "CSV", fields: ["accountName", "nickname", "grade", "classCode", "status"], filters: {} };
    const exportPreviewResponse = await page.request.post("/api/admin/roster/export/preview", { headers, data: exportBody });
    expect(exportPreviewResponse.ok()).toBeTruthy();
    const exportPreview = await exportPreviewResponse.json() as { count: number };
    expect(exportPreview.count).toBeGreaterThan(0);
    const exportResponse = await page.request.post("/api/admin/roster/export", { headers, data: exportBody });
    expect(exportResponse.ok()).toBeTruthy();
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    expect(await exportResponse.text()).toContain("accountName");

    // A teacher receives only the target-year class that the admin granted;
    // direct reset requests must fail closed after an IDOR or access revoke.
    teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto("/login");
    await teacherPage.getByLabel(/账号|賬號/).fill(teacherAccount);
    await teacherPage.getByLabel(/密码|密碼/).fill(teacherPassword);
    await teacherPage.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await teacherPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    const initialTeacherCsrfResponse = await teacherPage.request.get("/api/auth/csrf");
    expect(initialTeacherCsrfResponse.ok()).toBeTruthy();
    const initialTeacherCsrf = (await initialTeacherCsrfResponse.json() as { csrfToken?: string }).csrfToken;
    expect(initialTeacherCsrf).toBeTruthy();
    const teacherNewPassword = "FlowTeacherNew!2026";
    const changeTeacherPasswordResponse = await teacherPage.request.post("/api/reset-password", { headers: { Origin: "http://127.0.0.1:3100", "x-csrf-token": initialTeacherCsrf!, "Content-Type": "application/json" }, data: { currentPassword: teacherPassword, newPassword: teacherNewPassword } });
    expect(changeTeacherPasswordResponse.ok(), await changeTeacherPasswordResponse.text()).toBeTruthy();
    await teacherContext.clearCookies();
    await teacherPage.goto("/login");
    await teacherPage.getByLabel(/账号|賬號/).fill(teacherAccount);
    await teacherPage.getByLabel(/密码|密碼/).fill(teacherNewPassword);
    await teacherPage.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await teacherPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    const teacherCsrfResponse = await teacherPage.request.get("/api/auth/csrf");
    expect(teacherCsrfResponse.ok()).toBeTruthy();
    const teacherCsrf = (await teacherCsrfResponse.json() as { csrfToken?: string }).csrfToken;
    expect(teacherCsrf).toBeTruthy();
    const teacherHeaders = { Origin: "http://127.0.0.1:3100", "x-csrf-token": teacherCsrf!, "Content-Type": "application/json" };
    const teacherStudentsResponse = await teacherPage.request.post("/api/teacher/roster/query", { headers: teacherHeaders, data: { limit: 50 } });
    expect(teacherStudentsResponse.ok(), await teacherStudentsResponse.text()).toBeTruthy();
    const teacherStudents = (await teacherStudentsResponse.json() as { items: Array<{ id: string; accountName: string; grade: string | null; classCode: string | null; canResetStudentPassword: boolean; resetPrecondition: string | null }> }).items;
    expect(teacherStudents.length).toBeGreaterThan(0);
    expect(teacherStudents.every((student) => student.grade === "JUNIOR_2" && student.classCode === "A")).toBeTruthy();
    expect(teacherStudents.every((student) => student.canResetStudentPassword)).toBeTruthy();
    const authorizedStudentId = teacherStudents[0]!.id;
    const authorizedStudentAccountName = teacherStudents[0]!.accountName;
    const targetRosterResponse = await page.request.get(`/api/admin/users?academicYearId=${encodeURIComponent(targetYear.id)}&role=STUDENT&limit=100`);
    expect(targetRosterResponse.ok()).toBeTruthy();
    const targetRoster = await targetRosterResponse.json() as { items?: Array<{ id: string; grade: string | null; classCode: string | null }> };
    const unauthorizedStudentId = targetRoster.items?.find((student) => student.id !== authorizedStudentId && (student.grade !== "JUNIOR_2" || student.classCode !== "A"))?.id;
    expect(unauthorizedStudentId).toBeTruthy();
    const authorizedReset = await teacherPage.request.post(`/api/teacher/students/${authorizedStudentId}/reset-password`, { headers: teacherHeaders, data: { resetPrecondition: teacherStudents[0]!.resetPrecondition } });
    expect(authorizedReset.ok()).toBeTruthy();
    const authorizedResetPayload = await authorizedReset.json() as { temporaryPassword?: string };
    expect(authorizedResetPayload.temporaryPassword).toBeTruthy();
    forcedStudentContext = await browser.newContext();
    const forcedStudentPage = await forcedStudentContext.newPage();
    await forcedStudentPage.goto("/login");
    await forcedStudentPage.getByLabel(/账号|賬號/).fill(authorizedStudentAccountName);
    await forcedStudentPage.getByLabel(/密码|密碼/).fill(authorizedResetPayload.temporaryPassword!);
    await forcedStudentPage.getByRole("button", { name: /登录|登入|登錄/ }).click();
    await expect.poll(() => forcedStudentPage.url()).toMatch(/\/reset-password/u);
    const unauthorizedReset = await teacherPage.request.post(`/api/teacher/students/${unauthorizedStudentId}/reset-password`, { headers: teacherHeaders, data: { resetPrecondition: teacherStudents[0]!.resetPrecondition } });
    // The precondition is target-bound, so reusing another student's token is
    // rejected before any credential write and must not become an IDOR.
    expect(unauthorizedReset.status()).toBe(422);
    const unauthorizedDetail = await teacherPage.request.get(`/api/teacher/students/${unauthorizedStudentId}`);
    expect(unauthorizedDetail.status()).toBe(404);

    const teacherAccessStateResponse = await page.request.get(`/api/admin/roster/teachers/${teacher.id}/access-settings?academicYearId=${encodeURIComponent(targetYear.id)}`);
    expect(teacherAccessStateResponse.ok()).toBeTruthy();
    const teacherAccessState = await teacherAccessStateResponse.json() as { accessRevision: number };
    const removeResetAccessResponse = await page.request.put(`/api/admin/roster/teachers/${teacher.id}/access-settings`, { headers, data: { accessRevision: teacherAccessState.accessRevision, globalCapabilities: { canResetStudentPassword: false, acknowledgeImmediateEffect: true }, classAccess: { academicYearId: targetYear.id, classIds: [targetClasses[0].id] } } });
    expect(removeResetAccessResponse.ok()).toBeTruthy();
    const noResetStudentsResponse = await teacherPage.request.post("/api/teacher/roster/query", { headers: teacherHeaders, data: { limit: 50 } });
    expect(noResetStudentsResponse.ok()).toBeTruthy();
    const noResetStudents = (await noResetStudentsResponse.json() as { items: Array<{ id: string; accountName: string; canResetStudentPassword: boolean }> }).items;
    const noResetStudent = noResetStudents.find((student) => student.id === authorizedStudentId);
    expect(noResetStudent?.canResetStudentPassword).toBe(false);
    await teacherPage.goto("/teacher/students");
    await expect(teacherPage.getByRole("heading", { name: /学生进度|學生進度/ })).toBeVisible();
    const studentRow = teacherPage.locator("tr").filter({ hasText: authorizedStudentAccountName }).first();
    await expect(studentRow).toBeVisible();
    await studentRow.getByRole("link", { name: /查看/u }).click();
    await expect(teacherPage.getByText(authorizedStudentAccountName, { exact: true })).toBeVisible();
    await expect(teacherPage.getByRole("button", { name: /重置密码|重設密碼/ })).toHaveCount(0);

    const revokeStateResponse = await page.request.get(`/api/admin/roster/teachers/${teacher.id}/access-settings?academicYearId=${encodeURIComponent(targetYear.id)}`);
    expect(revokeStateResponse.ok()).toBeTruthy();
    const revokeState = await revokeStateResponse.json() as { accessRevision: number };
    const revokeAccessResponse = await page.request.put(`/api/admin/roster/teachers/${teacher.id}/access-settings`, { headers, data: { accessRevision: revokeState.accessRevision, globalCapabilities: { canResetStudentPassword: false }, classAccess: { academicYearId: targetYear.id, classIds: [] } } });
    expect(revokeAccessResponse.ok()).toBeTruthy();
    const afterRevokeStudents = await teacherPage.request.post("/api/teacher/roster/query", { headers: teacherHeaders, data: { limit: 50 } });
    expect((await afterRevokeStudents.json() as { items: unknown[] }).items).toEqual([]);
    const afterRevokeReset = await teacherPage.request.post(`/api/teacher/students/${authorizedStudentId}/reset-password`, { headers: teacherHeaders, data: { resetPrecondition: teacherStudents[0]!.resetPrecondition } });
    expect(afterRevokeReset.status()).toBe(404);
  } finally {
    await studentContext?.close();
    await teacherContext?.close();
    await forcedStudentContext?.close();
    for (const user of createdUsers.reverse()) {
      await page.request.delete(`/api/admin/users/${user.id}`, { headers, data: { confirmation: user.accountName } }).catch(() => undefined);
    }
  }
});

test("admin roster persists explicit rollover dispositions and activates incoming students", async ({ page }) => {
  test.setTimeout(180_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the rollover disposition smoke.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill("admin");
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken!, "Content-Type": "application/json" };
  const reauthResponse = await page.request.post("/api/auth/reauth", { headers, data: { password } });
  expect(reauthResponse.ok(), await reauthResponse.text()).toBeTruthy();

  const yearsResponse = await page.request.get("/api/admin/academic-years");
  expect(yearsResponse.ok()).toBeTruthy();
  const years = await yearsResponse.json() as Array<{ id: string; label: string; startsOn: string; status: string }>;
  const source = years.find((year) => year.status === "CURRENT");
  expect(source).toBeTruthy();
  let target = years
    .filter((year) => year.status === "PLANNED" && new Date(year.startsOn).getTime() > new Date(source!.startsOn).getTime())
    .sort((left, right) => new Date(left.startsOn).getTime() - new Date(right.startsOn).getTime())[0] as { id: string; status: string } | undefined;
  if (!target) {
    const sourceEndYear = Number(source!.label.slice(5, 9));
    const targetResponse = await page.request.post("/api/admin/academic-years", { headers, data: { label: `${sourceEndYear}-${sourceEndYear + 1}` } });
    expect(targetResponse.status(), await targetResponse.text()).toBe(201);
    target = await targetResponse.json() as { id: string; status: string };
  }
  expect(target.status).toBe("PLANNED");

  // The previous rollover smoke intentionally creates only J2–S3 classes.
  // Make the source J1 class and all six target grade classes explicit so this
  // fixture proves the complete six-grade mapping, including REPEAT.
  const currentClassesResponse = await page.request.get(`/api/admin/classes?academicYearId=${encodeURIComponent(source!.id)}`);
  expect(currentClassesResponse.ok()).toBeTruthy();
  const currentClasses = await currentClassesResponse.json() as Array<{ grade: string; classCode: string; active: boolean }>;
  if (!currentClasses.some((schoolClass) => schoolClass.grade === "JUNIOR_1" && schoolClass.classCode === "A" && schoolClass.active)) {
    const response = await page.request.post("/api/admin/classes", { headers, data: { academicYearId: source!.id, grade: "JUNIOR_1", classCode: "A" } });
    expect(response.status()).toBe(201);
  }
  const targetClasses: Array<{ id: string; grade: string; classCode: string }> = [];
  for (const grade of ["JUNIOR_1", "JUNIOR_2", "JUNIOR_3", "SENIOR_1", "SENIOR_2", "SENIOR_3"] as const) {
    const existing = await page.request.get(`/api/admin/classes?academicYearId=${encodeURIComponent(target.id)}`);
    expect(existing.ok(), await existing.text()).toBeTruthy();
    const existingClasses = await existing.json() as Array<{ id: string; grade: string; classCode: string }>;
    const match = existingClasses.find((schoolClass) => schoolClass.grade === grade && schoolClass.classCode === "A");
    if (match) {
      targetClasses.push(match);
    } else {
      const response = await page.request.post("/api/admin/classes", { headers, data: { academicYearId: target.id, grade, classCode: "A" } });
      expect(response.status(), `${grade}: ${await response.text()}`).toBe(201);
      targetClasses.push(await response.json() as { id: string; grade: string; classCode: string });
    }
  }

  const suffix = Date.now().toString(36);
  const variantAccounts = {
    repeat: `rollrepeat${suffix}`,
    hold: `rollhold${suffix}`,
    graduate: `rollgraduate${suffix}`,
    leave: `rollleave${suffix}`,
    suspended: `rollsuspended${suffix}`,
    incoming: `rollincoming${suffix}`,
  };
  const sourceRows = [
    "accountName,legalName,nickname,grade,classCode,contactEmail",
    `${variantAccounts.repeat},升班重讀學生${suffix},重讀暱稱${suffix},JUNIOR_1,A,`,
    `${variantAccounts.hold},升班待分班學生${suffix},待分班暱稱${suffix},JUNIOR_2,A,`,
    `${variantAccounts.graduate},畢業學生${suffix},畢業暱稱${suffix},SENIOR_3,A,`,
    `${variantAccounts.leave},離校學生${suffix},離校暱稱${suffix},SENIOR_3,A,`,
    `${variantAccounts.suspended},停權學生${suffix},停權暱稱${suffix},JUNIOR_3,A,`,
  ].join("\n");
  const sourceImportPreviewResponse = await page.request.post("/api/admin/roster/import/preview", {
    headers: { Origin: headers.Origin, "x-csrf-token": headers["x-csrf-token"] },
    multipart: { file: { name: "rollover-dispositions.csv", mimeType: "text/csv", buffer: Buffer.from(sourceRows) }, entityType: "STUDENT", academicYearId: source!.id, mode: "CREATE_ONLY", operationId: `rollover-dispositions-${suffix}` },
  });
  expect(sourceImportPreviewResponse.ok(), await sourceImportPreviewResponse.text()).toBeTruthy();
  const sourceImportPreview = await sourceImportPreviewResponse.json() as { batchId: string; operationId?: string; errorCount: number };
  expect(sourceImportPreview.errorCount).toBe(0);
  const sourceImportCommitResponse = await page.request.post(`/api/admin/roster/import/${sourceImportPreview.batchId}/commit`, { headers, data: { operationId: sourceImportPreview.operationId } });
  expect(sourceImportCommitResponse.ok(), await sourceImportCommitResponse.text()).toBeTruthy();

  const incomingCsv = [
    "accountName,legalName,nickname,grade,classCode,contactEmail",
    `${variantAccounts.incoming},插班學生${suffix},插班暱稱${suffix},JUNIOR_1,,`,
  ].join("\n");
  const incomingPreviewResponse = await page.request.post("/api/admin/roster/import/preview", {
    headers: { Origin: headers.Origin, "x-csrf-token": headers["x-csrf-token"] },
    multipart: { file: { name: "rollover-incoming.csv", mimeType: "text/csv", buffer: Buffer.from(incomingCsv) }, entityType: "STUDENT", academicYearId: target.id, mode: "CREATE_ONLY", operationId: `rollover-incoming-${suffix}` },
  });
  expect(incomingPreviewResponse.ok(), await incomingPreviewResponse.text()).toBeTruthy();
  const incomingPreview = await incomingPreviewResponse.json() as { batchId: string; operationId?: string; errorCount: number };
  expect(incomingPreview.errorCount).toBe(0);
  const incomingCommitResponse = await page.request.post(`/api/admin/roster/import/${incomingPreview.batchId}/commit`, { headers, data: { operationId: incomingPreview.operationId } });
  expect(incomingCommitResponse.ok(), await incomingCommitResponse.text()).toBeTruthy();

  async function findStudentId(accountName: string, academicYearId?: string) {
    const query = new URLSearchParams({ role: "STUDENT", search: accountName, limit: "10" });
    if (academicYearId) query.set("academicYearId", academicYearId);
    const response = await page.request.get(`/api/admin/users?${query.toString()}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const payload = await response.json() as { items?: Array<{ id: string; accountName: string; revision: number }> };
    const student = payload.items?.find((item) => item.accountName === accountName);
    expect(student, `student ${accountName} should exist`).toBeTruthy();
    return student!;
  }

  const repeatStudent = await findStudentId(variantAccounts.repeat, source!.id);
  const holdStudent = await findStudentId(variantAccounts.hold, source!.id);
  const graduateStudent = await findStudentId(variantAccounts.graduate, source!.id);
  const leaveStudent = await findStudentId(variantAccounts.leave, source!.id);
  const suspendedStudent = await findStudentId(variantAccounts.suspended, source!.id);
  const incomingStudent = await findStudentId(variantAccounts.incoming, target.id);
  const repeatId = repeatStudent.id;
  const holdId = holdStudent.id;
  const graduateId = graduateStudent.id;
  const leaveId = leaveStudent.id;
  const suspendedId = suspendedStudent.id;
  const incomingId = incomingStudent.id;
  const suspendResponse = await page.request.patch(`/api/admin/users/${suspendedId}`, { headers, data: { operation: "CHANGE_STATUS", status: "SUSPENDED", expectedUserRevision: suspendedStudent.revision } });
  expect(suspendResponse.ok(), await suspendResponse.text()).toBeTruthy();

  const promotionGrades = ["JUNIOR_1", "JUNIOR_2", "JUNIOR_3", "SENIOR_1", "SENIOR_2", "SENIOR_3"] as const;
  for (const sourceGrade of promotionGrades) {
    const dispositions: Record<string, "REPEAT" | "HOLD_UNASSIGNED" | "LEAVE"> = {};
    if (sourceGrade === "JUNIOR_1") dispositions[repeatId] = "REPEAT";
    if (sourceGrade === "JUNIOR_2") dispositions[holdId] = "HOLD_UNASSIGNED";
    if (sourceGrade === "SENIOR_3") dispositions[leaveId] = "LEAVE";
    const promotionPreviewResponse = await page.request.post("/api/admin/roster/students/promote/preview", { headers, data: { sourceAcademicYearId: source!.id, targetAcademicYearId: target.id, sourceGrade, excludedStudentIds: [], classMapping: { A: "A" }, dispositions, operationId: `rollover-${sourceGrade}-${suffix}` } });
    expect(promotionPreviewResponse.ok(), `${sourceGrade}: ${await promotionPreviewResponse.text()}`).toBeTruthy();
    const promotionPreview = await promotionPreviewResponse.json() as { batchId: string; operationId?: string; count: number };
    expect(promotionPreview.count).toBeGreaterThan(0);
    const promotionCommitResponse = await page.request.post("/api/admin/roster/students/promote/commit", { headers, data: { batchId: promotionPreview.batchId, operationId: promotionPreview.operationId } });
    expect(promotionCommitResponse.ok(), `${sourceGrade}: ${await promotionCommitResponse.text()}`).toBeTruthy();
  }

  const activationPreviewResponse = await page.request.post(`/api/admin/academic-years/${source!.id}/activation/preview`, { headers, data: { targetAcademicYearId: target.id, acknowledgedClassIds: targetClasses.map((schoolClass) => schoolClass.id), operationId: `rollover-activation-${suffix}` } });
  expect(activationPreviewResponse.ok(), await activationPreviewResponse.text()).toBeTruthy();
  const activationPreview = await activationPreviewResponse.json() as { batchId?: string; operationId?: string; sourceCount: number; targetCount: number; transitions?: Array<{ studentId: string; disposition: string; targetEnrollmentId: string | null }> };
  expect(activationPreview.batchId).toBeTruthy();
  expect(activationPreview.sourceCount).toBeGreaterThanOrEqual(5);
  expect(activationPreview.targetCount).toBeGreaterThanOrEqual(1);
  const transitionByStudent = new Map((activationPreview.transitions ?? []).map((transition) => [transition.studentId, transition]));
  expect(transitionByStudent.get(repeatId)?.disposition).toBe("REPEAT");
  expect(transitionByStudent.get(holdId)?.disposition).toBe("HOLD_UNASSIGNED");
  expect(transitionByStudent.get(graduateId)?.disposition).toBe("GRADUATE");
  expect(transitionByStudent.get(leaveId)?.disposition).toBe("LEAVE");
  expect(transitionByStudent.get(suspendedId)?.disposition).toBe("PROMOTE");
  expect(transitionByStudent.has(incomingId)).toBe(false);
  expect(transitionByStudent.get(repeatId)?.targetEnrollmentId).toBeTruthy();
  expect(transitionByStudent.get(holdId)?.targetEnrollmentId).toBeTruthy();
  expect(transitionByStudent.get(graduateId)?.targetEnrollmentId).toBeNull();
  expect(transitionByStudent.get(leaveId)?.targetEnrollmentId).toBeNull();

  const activationCommitResponse = await page.request.post(`/api/admin/academic-years/${source!.id}/activation/commit`, { headers, data: { batchId: activationPreview.batchId, operationId: activationPreview.operationId } });
  expect(activationCommitResponse.ok(), await activationCommitResponse.text()).toBeTruthy();
  const result = await activationCommitResponse.json() as { terminalCount?: number; activatedTargetCount?: number };
  expect(result.terminalCount).toBeGreaterThanOrEqual(2);
  expect(result.activatedTargetCount).toBeGreaterThanOrEqual(1);

  async function readRoster(accountName: string) {
    const response = await page.request.get(`/api/admin/users?${new URLSearchParams({ role: "STUDENT", academicYearId: target!.id, search: accountName, limit: "10" }).toString()}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const payload = await response.json() as { items?: Array<{ id: string; accountName: string; grade: string | null; classCode: string | null; status: string; enrollmentStatus: string | null }> };
    return payload.items?.find((item) => item.accountName === accountName) ?? null;
  }
  expect(await readRoster(variantAccounts.repeat)).toMatchObject({ grade: "JUNIOR_1", classCode: "A", status: "ACTIVE", enrollmentStatus: "ACTIVE" });
  expect(await readRoster(variantAccounts.hold)).toMatchObject({ grade: "JUNIOR_2", classCode: null, status: "ACTIVE", enrollmentStatus: "ACTIVE" });
  expect(await readRoster(variantAccounts.suspended)).toMatchObject({ grade: "SENIOR_1", classCode: "A", status: "SUSPENDED", enrollmentStatus: "ACTIVE" });
  expect(await readRoster(variantAccounts.incoming)).toMatchObject({ grade: "JUNIOR_1", status: "ACTIVE", enrollmentStatus: "ACTIVE" });
  expect(await readRoster(variantAccounts.graduate)).toBeNull();
  expect(await readRoster(variantAccounts.leave)).toBeNull();

  for (const accountName of Object.values(variantAccounts)) {
    const user = await findStudentId(accountName);
    const deleteResponse = await page.request.delete(`/api/admin/users/${user.id}`, { headers, data: { confirmation: accountName } });
    expect(deleteResponse.ok(), `${accountName}: ${await deleteResponse.text()}`).toBeTruthy();
  }
});

test("admin roster promotion accepts 500 and rejects 501 before staging", async ({ page }) => {
  test.setTimeout(240_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the promotion scale smoke.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill("admin");
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken!, "Content-Type": "application/json" };
  const reauthResponse = await page.request.post("/api/auth/reauth", { headers, data: { password } });
  expect(reauthResponse.ok()).toBeTruthy();

  const yearsResponse = await page.request.get("/api/admin/academic-years");
  expect(yearsResponse.ok()).toBeTruthy();
  const years = await yearsResponse.json() as Array<{ id: string; label: string; status: string }>;
  const source = years.find((year) => year.status === "CURRENT");
  expect(source).toBeTruthy();
  const sourceLabel = source!.label.match(/^(\d{4})-(\d{4})$/u);
  expect(sourceLabel).toBeTruthy();
  const usedLabels = new Set(years.map((year) => year.label));
  let targetLabel = `${Number(sourceLabel![2])}-${Number(sourceLabel![2]) + 1}`;
  while (usedLabels.has(targetLabel)) {
    const nextStart = Number(targetLabel.slice(0, 4)) + 1;
    targetLabel = `${nextStart}-${nextStart + 1}`;
  }
  const targetResponse = await page.request.post("/api/admin/academic-years", { headers, data: { label: targetLabel } });
  expect(targetResponse.status()).toBe(201);
  const target = await targetResponse.json() as { id: string; status: string };
  expect(target.status).toBe("PLANNED");
  const targetClassResponse = await page.request.post("/api/admin/classes", { headers, data: { academicYearId: target.id, grade: "JUNIOR_2", classCode: "A" } });
  expect(targetClassResponse.status()).toBe(201);

  async function countCurrentGrade() {
    let cursor: string | null = null;
    let count = 0;
    do {
      const query = new URLSearchParams({ academicYearId: source!.id, role: "STUDENT", grade: "JUNIOR_1", limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const response = await page.request.get(`/api/admin/users?${query.toString()}`);
      expect(response.ok()).toBeTruthy();
      const payload = await response.json() as { items?: unknown[]; nextCursor?: string | null };
      count += payload.items?.length ?? 0;
      cursor = payload.nextCursor ?? null;
    } while (cursor);
    return count;
  }

  const existingCount = await countCurrentGrade();
  const createCount = 500 - existingCount;
  expect(createCount).toBeGreaterThan(0);
  expect(createCount).toBeLessThanOrEqual(500);
  const prefix = `promoscale${Date.now().toString(36)}`;
  const rows = ["accountName,legalName,nickname,grade,classCode,contactEmail"];
  for (let index = 0; index < createCount; index += 1) rows.push(`${prefix}${index},升级规模学生${index},升级规模昵称${index},JUNIOR_1,,`);
  const importPreviewResponse = await page.request.post("/api/admin/roster/import/preview", {
    headers: { Origin: headers.Origin, "x-csrf-token": headers["x-csrf-token"] },
    multipart: { file: { name: "promotion-scale.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) }, entityType: "STUDENT", academicYearId: source!.id, mode: "CREATE_ONLY", operationId: `promotion-import-${Date.now()}` },
  });
  expect(importPreviewResponse.ok(), await importPreviewResponse.text()).toBeTruthy();
  const importPreview = await importPreviewResponse.json() as { batchId: string; operationId?: string; rowCount: number; errorCount: number };
  expect(importPreview.rowCount).toBe(createCount);
  expect(importPreview.errorCount).toBe(0);
  const importCommitResponse = await page.request.post(`/api/admin/roster/import/${importPreview.batchId}/commit`, { headers, data: { operationId: importPreview.operationId } });
  expect(importCommitResponse.ok(), await importCommitResponse.text()).toBeTruthy();

  const promotionPreviewResponse = await page.request.post("/api/admin/roster/students/promote/preview", { headers, data: { sourceAcademicYearId: source!.id, targetAcademicYearId: target.id, sourceGrade: "JUNIOR_1", excludedStudentIds: [], classMapping: {}, operationId: `promotion-scale-${Date.now()}` } });
  expect(promotionPreviewResponse.ok(), await promotionPreviewResponse.text()).toBeTruthy();
  const promotionPreview = await promotionPreviewResponse.json() as { batchId: string; operationId?: string; count: number };
  expect(promotionPreview.count).toBe(500);
  const batchResponse = await page.request.get(`/api/admin/mutation-batches/${promotionPreview.batchId}`);
  expect(batchResponse.ok()).toBeTruthy();
  const batch = await batchResponse.json() as { payload?: unknown };
  expect(JSON.stringify(batch.payload ?? {})).not.toMatch(/accountName|legalName|contactEmail|nickname/u);
  const promotionCommitStartedAt = Date.now();
  const promotionCommitResponse = await page.request.post("/api/admin/roster/students/promote/commit", { headers, data: { batchId: promotionPreview.batchId, operationId: promotionPreview.operationId } });
  const promotionCommitElapsedMs = Date.now() - promotionCommitStartedAt;
  expect(promotionCommitResponse.ok(), await promotionCommitResponse.text()).toBeTruthy();

  const extraRows = [...rows, `${prefix}${createCount},升级规模额外学生,升级规模额外昵称,JUNIOR_1,,`];
  const extraPreviewResponse = await page.request.post("/api/admin/roster/import/preview", {
    headers: { Origin: headers.Origin, "x-csrf-token": headers["x-csrf-token"] },
    multipart: { file: { name: "promotion-scale-extra.csv", mimeType: "text/csv", buffer: Buffer.from(["accountName,legalName,nickname,grade,classCode,contactEmail", extraRows.at(-1)].join("\n")) }, entityType: "STUDENT", academicYearId: source!.id, mode: "CREATE_ONLY", operationId: `promotion-extra-${Date.now()}` },
  });
  expect(extraPreviewResponse.ok()).toBeTruthy();
  const extraPreview = await extraPreviewResponse.json() as { batchId: string; operationId?: string };
  const extraCommitResponse = await page.request.post(`/api/admin/roster/import/${extraPreview.batchId}/commit`, { headers, data: { operationId: extraPreview.operationId } });
  expect(extraCommitResponse.ok(), await extraCommitResponse.text()).toBeTruthy();
  const oversizedPromotionResponse = await page.request.post("/api/admin/roster/students/promote/preview", { headers, data: { sourceAcademicYearId: source!.id, targetAcademicYearId: target.id, sourceGrade: "JUNIOR_1", excludedStudentIds: [], classMapping: {}, operationId: `promotion-scale-oversized-${Date.now()}` } });
  expect(oversizedPromotionResponse.status()).toBe(422);
  await expect(oversizedPromotionResponse.json()).resolves.toMatchObject({ code: "SELECTION_CAP" });
  console.log(`roster-promotion-scale selected=500 commitMs=${promotionCommitElapsedMs}`);
});

test("admin roster is keyboard navigable across responsive locale and theme states", async ({ page }) => {
  test.setTimeout(120_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the admin accessibility matrix.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill("admin");
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  for (const locale of ["zh-Hant", "zh-Hans"] as const) {
    await page.context().addCookies([{ name: "locale", value: locale, url: "http://127.0.0.1:3100" }]);
    await page.evaluate((nextLocale) => localStorage.setItem("locale", nextLocale), locale);
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => localStorage.setItem("theme", nextTheme), theme);
      for (const viewport of [{ width: 320, height: 568 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto("/admin/roster");
        await expect(page.getByRole("heading", { name: /班级、学生与教师|班級、學生與教師/ })).toBeVisible();
        await expect(page.locator("main#workspace-main")).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(locale);
        await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

        await page.addScriptTag({ content: axe.source });
        const violations = await page.evaluate(async () => {
          const axeApi = (window as Window & { axe?: { run: (context: Document, options: { runOnly: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe;
          if (!axeApi) throw new Error("axe failed to load");
          const result = await axeApi.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
          return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
        });
        expect(violations, `${locale}/${theme}/${viewport.width} serious or critical axe violations`).toEqual([]);
      }
    }
  }

  await page.goto("/admin/roster");
  const selectedTab = page.getByRole("tab", { selected: true });
  await selectedTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /教师名册|教師名冊/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /学生名册|學生名冊/ })).toHaveAttribute("aria-selected", "true");

  const accountTrigger = page.locator('button[aria-label*="账户菜单"]:visible, button[aria-label*="賬戶菜單"]:visible').first();
  await accountTrigger.click();
  const accountMenu = page.getByRole("menu").last();
  await expect(accountMenu).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(accountMenu).toBeHidden();
  await expect(accountTrigger).toBeFocused();

  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/admin/roster");
  for (const tabName of [/学生名册|學生名冊/u, /教师名册|教師名冊/u, /学年及班级|學年及班級/u, /汇入|匯入/u, /升级|升級/u, /汇出|匯出/u]) {
    await page.getByRole("tab", { name: tabName }).click();
    await expect(page.locator("[data-roster-page] section")).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    const tabViolations = await page.evaluate(async () => {
      const axeApi = (window as Window & { axe?: { run: (context: Document, options: { runOnly: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe;
      if (!axeApi) throw new Error("axe failed to load");
      const result = await axeApi.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
      return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    });
    expect(tabViolations, `${String(tabName)} serious or critical axe violations`).toEqual([]);
  }
  await page.getByRole("tab", { name: /学年及班级|學年及班級/u }).click();
  const yearTabSelects = page.locator("[data-roster-page] section select");
  await expect(yearTabSelects.nth(0).locator("option")).toHaveCount(6);
  await expect(yearTabSelects.nth(1).locator("option")).toHaveCount(8);

  // The shared admin modal is part of the roster management workflow too:
  // exercise its 200% reflow equivalent, labelled controls, live error and
  // focus trap/return without creating a fixture user.
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/admin/users");
  await expect(page.getByRole("button", { name: /新建|新增/u })).toBeVisible();
  const createTrigger = page.getByRole("button", { name: /新建|新增/u }).first();
  await createTrigger.focus();
  await createTrigger.click();
  const userDialog = page.getByRole("dialog");
  await expect(userDialog).toBeVisible();
  await expect(userDialog.getByLabel(/账号|賬號/u)).toBeVisible();
  await expect(userDialog.getByLabel(/真实姓名|真實姓名/u)).toBeVisible();
  await expect(userDialog.getByRole("heading")).toBeVisible();
  const dialogAriaSnapshot = await userDialog.ariaSnapshot();
  expect(dialogAriaSnapshot).toMatch(/dialog/iu);
  expect(dialogAriaSnapshot).toMatch(/账号|賬號/iu);
  await userDialog.getByRole("button", { name: /创建用户|建立用戶|建立用户/u }).click();
  await expect(userDialog.getByRole("alert")).toBeVisible();
  const errorAriaSnapshot = await userDialog.ariaSnapshot();
  expect(errorAriaSnapshot).toMatch(/alert/iu);
  const firstDialogControl = userDialog.getByLabel(/账号|賬號/u);
  await firstDialogControl.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(userDialog.locator(":focus")).toHaveCount(1);
  expect(await userDialog.locator(":focus").evaluate((element) => element.id)).not.toBe("user-form-account");
  await page.keyboard.press("Escape");
  await expect(userDialog).toBeHidden();
  await expect(createTrigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});

test("admin roster imports 500 rows and rejects the 501st before staging", async ({ page }) => {
  test.setTimeout(240_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the roster scale smoke.");

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill("admin");
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken! };
  const reauthResponse = await page.request.post("/api/auth/reauth", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: { password },
  });
  expect(reauthResponse.ok()).toBeTruthy();

  const yearsResponse = await page.request.get("/api/admin/academic-years");
  expect(yearsResponse.ok()).toBeTruthy();
  const years = await yearsResponse.json() as Array<{ id: string; status: string }>;
  const current = years.find((year) => year.status === "CURRENT");
  expect(current).toBeTruthy();

  const imports: MeasuredStudentImport[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const measured = await runMeasuredStudentImport(page, headers, current!.id, `scale${Date.now().toString(36)}${attempt}`, `scale-${attempt}`);
    if (attempt === 0) expect(measured.preview.nextCursor).toBe("50");
    expect(measured.previewMeasurement.peakRssDeltaMiB).toBeLessThanOrEqual(256);
    expect(measured.commitMeasurement.elapsedMs).toBeLessThanOrEqual(90_000);
    expect(measured.transactionMs).toBeLessThanOrEqual(10_000);
    expect(measured.commitMeasurement.peakRssDeltaMiB).toBeLessThanOrEqual(256);
    imports.push(measured);
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    return (sorted[1]! + sorted[2]!) / 2;
  };
  const previewTimes = imports.map((measured) => measured.previewMeasurement.elapsedMs);
  const commitTimes = imports.map((measured) => measured.commitMeasurement.elapsedMs);
  const transactionTimes = imports.map((measured) => measured.transactionMs);
  const firstImport = imports[0]!;
  const oversizedRows = [...firstImport.rows, `${firstImport.rows[1]!.split(",")[0]}500,规模测试学生500,规模昵称500,JUNIOR_1,,`];
  const oversizedResponse = await page.request.post("/api/admin/roster/import/preview", {
    headers,
    multipart: {
      file: { name: "scale-501.csv", mimeType: "text/csv", buffer: Buffer.from(oversizedRows.join("\n")) },
      entityType: "STUDENT",
      academicYearId: current!.id,
      mode: "CREATE_ONLY",
      operationId: `scale-oversized-${Date.now()}`,
    },
  });
  expect(oversizedResponse.status()).toBe(422);
  expect(await oversizedResponse.json()).toMatchObject({ code: "ROSTER_FILE_INVALID" });
  console.log(`roster-scale rows=500 coldPreviewMs=${previewTimes[0]} warmPreviewMs=${previewTimes.slice(1).join(",")} medianPreviewMs=${median(previewTimes)} coldCommitMs=${commitTimes[0]} warmCommitMs=${commitTimes.slice(1).join(",")} medianCommitMs=${median(commitTimes)} medianTransactionMs=${median(transactionTimes)} rssDeltaMiB=${imports.map((measured) => measured.commitMeasurement.peakRssDeltaMiB).join(",")}`);
});

test("admin roster activation completes 5,000 students atomically", async ({ page }) => {
  test.setTimeout(300_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the activation scale smoke.");
  const fixture = await seedActivationScaleFixture(5_000);

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill(fixture.adminAccountName);
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken!, "Content-Type": "application/json" };
  const reauthResponse = await page.request.post("/api/auth/reauth", { headers, data: { password } });
  expect(reauthResponse.ok(), await reauthResponse.text()).toBeTruthy();

  const previewResponse = await page.request.post(`/api/admin/academic-years/${fixture.sourceAcademicYearId}/activation/preview`, {
    headers,
    data: { targetAcademicYearId: fixture.targetAcademicYearId, acknowledgedClassIds: [], operationId: `activation-scale-${Date.now()}` },
  });
  expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
  const preview = await previewResponse.json() as { batchId?: string; operationId?: string; sourceCount?: number; pendingAcknowledgement?: boolean };
  expect(preview.pendingAcknowledgement).not.toBe(true);
  expect(preview.sourceCount).toBe(5_000);
  expect(preview.batchId).toBeTruthy();

  const commitMeasurement = await measureRosterPerformance(() => page.request.post(`/api/admin/academic-years/${fixture.sourceAcademicYearId}/activation/commit`, {
    headers,
    data: { batchId: preview.batchId, operationId: preview.operationId },
  }));
  const commitResponse = commitMeasurement.value;
  const commitElapsedMs = commitMeasurement.elapsedMs;
  const transactionMatch = /dur=([\d.]+)/.exec(commitResponse.headers()["server-timing"] ?? "");
  expect(transactionMatch, "activation commit response must expose local transaction timing").toBeTruthy();
  const transactionElapsedMs = Number(transactionMatch?.[1]);
  expect(commitResponse.ok(), await commitResponse.text()).toBeTruthy();
  expect(commitElapsedMs).toBeLessThanOrEqual(10_000);
  expect(transactionElapsedMs).toBeLessThanOrEqual(10_000);
  expect(commitMeasurement.peakRssDeltaMiB).toBeLessThanOrEqual(256);
  const summary = await commitResponse.json() as { endedSourceCount?: number; activatedTargetCount?: number };
  expect(summary.endedSourceCount).toBe(5_000);
  expect(summary.activatedTargetCount).toBe(5_000);
  const exportBody = { entityType: "STUDENT", academicYearId: fixture.targetAcademicYearId, format: "CSV", fields: ["accountName", "nickname", "grade", "classCode", "status"], filters: {} };
  const exportPreviewStartedAt = Date.now();
  const exportPreviewResponse = await page.request.post("/api/admin/roster/export/preview", { headers, data: exportBody });
  const exportPreviewElapsedMs = Date.now() - exportPreviewStartedAt;
  expect(exportPreviewResponse.ok(), await exportPreviewResponse.text()).toBeTruthy();
  expect((await exportPreviewResponse.json() as { count?: number }).count).toBe(5_000);
  const exportMeasurements: Array<RosterPerfMeasurement & { transactionMs: number }> = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const exportMeasurement = await measureRosterPerformance(() => page.request.post("/api/admin/roster/export", { headers, data: exportBody }));
    const exportResponse = exportMeasurement.value;
    const timing = /dur=([\d.]+)/.exec(exportResponse.headers()["server-timing"] ?? "");
    expect(timing, "export response must expose local transaction timing").toBeTruthy();
    exportMeasurements.push({ ...exportMeasurement, transactionMs: Number(timing?.[1]) });
    expect(exportResponse.ok(), await exportResponse.text()).toBeTruthy();
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    expect((await exportResponse.body()).byteLength).toBeGreaterThan(100_000);
  }
  expect(Math.max(...exportMeasurements.map((measurement) => measurement.elapsedMs))).toBeLessThanOrEqual(10_000);
  expect(Math.max(...exportMeasurements.map((measurement) => measurement.transactionMs))).toBeLessThanOrEqual(10_000);
  expect(Math.max(...exportMeasurements.map((measurement) => measurement.peakRssDeltaMiB))).toBeLessThanOrEqual(256);
  console.log(`roster-activation-scale source=5000 commitMs=${commitElapsedMs} transactionMs=${transactionElapsedMs} commitRssDeltaMiB=${commitMeasurement.peakRssDeltaMiB}`);
  console.log(`roster-export-scale rows=5000 previewMs=${exportPreviewElapsedMs} totalMs=${exportMeasurements.map((measurement) => measurement.elapsedMs).join(",")} transactionMs=${exportMeasurements.map((measurement) => measurement.transactionMs).join(",")} rssDeltaMiB=${exportMeasurements.map((measurement) => measurement.peakRssDeltaMiB).join(",")}`);
});

test("admin roster activation rejects 5,001 students before staging", async ({ page }) => {
  test.setTimeout(300_000);
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  test.skip(!password, "INITIAL_ADMIN_PASSWORD is required for the activation cap smoke.");
  const fixture = await seedActivationScaleFixture(5_001);

  await page.goto("/login");
  await page.getByLabel(/账号|賬號/).fill(fixture.adminAccountName);
  await page.getByLabel(/密码|密碼/).fill(password!);
  await page.getByRole("button", { name: /登录|登入|登錄/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin");

  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfToken = (await csrfResponse.json() as { csrfToken?: string }).csrfToken;
  expect(csrfToken).toBeTruthy();
  const headers = { Origin: "http://127.0.0.1:3100", "x-csrf-token": csrfToken!, "Content-Type": "application/json" };
  const reauthResponse = await page.request.post("/api/auth/reauth", { headers, data: { password } });
  expect(reauthResponse.ok(), await reauthResponse.text()).toBeTruthy();

  const previewResponse = await page.request.post(`/api/admin/academic-years/${fixture.sourceAcademicYearId}/activation/preview`, {
    headers,
    data: { targetAcademicYearId: fixture.targetAcademicYearId, acknowledgedClassIds: [], operationId: `activation-cap-${Date.now()}` },
  });
  expect(previewResponse.status()).toBe(422);
  await expect(previewResponse.json()).resolves.toMatchObject({ code: "ACTIVATION_SELECTION_CAP" });
});
