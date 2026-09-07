import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

// Exercise the real React panel with deterministic transport fixtures; no DB or login required.
const bundle = await build({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import Panel from "./src/components/analytics/LearningRewardPanel"; createRoot(document.getElementById("root")).render(<Panel role="TEACHER" onBack={() => {}} />);', resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  plugins: [{ name: "panel-boundaries", setup(builder) {
    builder.onResolve({ filter: /(?:LocaleProvider|RecentAuthDialog|roster-client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: process.cwd(), contents: args.path.endsWith("LocaleProvider")
      ? 'import { useEffect, useState } from "react"; let currentLocale = "zh-Hant"; const listeners = new Set(); globalThis.__setPanelLocale = next => { currentLocale = next; for (const listener of listeners) listener(); }; export const useLocale = () => { const [, setVersion] = useState(0); useEffect(() => { const listener = () => setVersion(value => value + 1); listeners.add(listener); return () => listeners.delete(listener); }, []); const tc = value => currentLocale === "zh-Hans" ? value : value; return { tc }; };'
        : args.path.endsWith("roster-client") ? 'export const rosterFetch = (...args) => fetch(...args);'
        : 'export default function Dialog() { return null; }' }));
  } }],
});
const localDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const today = localDateKey();
const classesPayload = {
  viewMode: "TEACHER",
  academicYear: { id: "year-1", label: "2026–2027", startsOn: "2026-08-01", endsOn: "2027-07-31", revision: 3, status: "CURRENT" },
  items: [{ id: "class-a", grade: "JUNIOR_1", classCode: "A", revision: 4, label: "JUNIOR_1:A" }],
  unassignedStudentCount: 0,
  accessRevision: 2,
  rosterRevision: 9,
  generatedAt: "2026-09-07T00:00:00.000Z",
};
const counts = { candidateCount: 0, outsideEligibility: 0, policyExcluded: 0, unsupportedVersion: 0, missingIdentityOrProvenance: 0, nonWinningOrInvalidOutcome: 0, included: 0 };
const coverage = { sources: { encounters: counts, reviews: counts }, validationGapCount: 0, policyExcludedCount: 0, validationStatus: "CHECKED", historyCoverage: "NOT_GUARANTEED", warningCodes: [] };
const students = ["A", "B"].map(studentId => ({ studentId, nickname: "Student " + studentId, studentNumber: null, classLabel: "Test class", eligibleDayCount: 1, activeDayCount: 0, effortActivityCount: 0, creditedEffortActivityCount: 0, firstCorrectSenseDayCount: 0, creditedFirstCorrectSenseDayCount: 0, objectiveAttemptCount: 0, objectiveCorrectCount: 0, objectiveAccuracyPercent: null, accuracyStatus: "NO_DATA", effortCapDays: 0, outcomeCapDays: 0, effortCapDayPercent: 0, outcomeCapDayPercent: 0, coverage, levelCounts: Object.fromEntries(["A1", "A2", "B1", "B2"].map(level => [level, { attempts: 0, correct: 0 }])) }));
const report = { items: students, totalStudentCount: 2, nextCursor: null, asOf: "2026-09-07T00:00:00Z", scopeToken: "fixture", effectiveRange: { from: "2026-09-07", to: "2026-09-07" }, policy: { weights: { effort: 50, outcome: 50 } }, coverageSummary: { combined: coverage } };
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  for (const failure of ["http", "network", "wrong-student"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://reward.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
      if (path === "/api/teacher/classes") return route.fulfill({ json: classesPayload });
      if (path.endsWith("/rewards/query")) return route.fulfill({ json: report });
      if (path.includes("/students/A/")) return route.fulfill({ json: { ...report, student: students[0], days: [] } });
      if (path.includes("/students/B/")) {
        if (failure === "network") return route.abort("failed");
        if (failure === "wrong-student") return route.fulfill({ json: { ...report, student: students[0], days: [] } });
        return route.fulfill({ status: 500, json: { error: "EXPORT_FAILED" } });
      }
      return route.abort();
    });
    await page.goto("http://reward.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    if (failure === "http") {
      await expect(page.getByLabel("開始日期")).toHaveValue("2026-08-01");
      await expect(page.getByLabel("結束日期")).toHaveValue(today);
      await page.getByLabel("開始日期").fill("2026-08-15");
      await page.getByLabel("結束日期").fill("2026-09-01");
      await page.evaluate(() => globalThis.__setPanelLocale("zh-Hans"));
      await expect(page.getByLabel("開始日期")).toHaveValue("2026-08-15");
      await expect(page.getByLabel("結束日期")).toHaveValue("2026-09-01");
    }
    await page.getByRole("button", { name: "計算累積分", exact: true }).click();
    await page.getByRole("button", { name: /Student A/ }).click();
    const region = page.getByRole("region", { name: "學生每日明細" });
    await expect(region).toContainText("Student A");
    await page.getByRole("button", { name: /Student B/ }).click();
    await expect(region).toContainText("未有每日明細。");
    await expect(region).not.toContainText("Student A");
    await expect(page.getByRole("button", { name: /Student B/ })).toHaveAttribute("aria-expanded", "true");
    expect(errors).toEqual([]);
    await page.close();
    console.log(`PASS: A success then B ${failure} never renders A under B`);
  }
} finally { await browser.close(); }
