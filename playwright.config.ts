import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "auth-setup-chromium",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "auth-setup-webkit",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "desktop-chromium-motion",
      testMatch: /word-card-release\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop-firefox-synthetic-pointer-motion",
      testMatch: /word-card-release\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "desktop-webkit-motion",
      testMatch: /word-card-release\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium-emulation",
      testMatch: /word-card-release\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-webkit-synthetic-pointer-emulation",
      testMatch: /word-card-release\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "study-integration-chromium",
      testMatch: /study-workflow\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "study-integration-webkit",
      testMatch: /study-workflow\.spec\.ts/,
      dependencies: ["auth-setup-webkit"],
      fullyParallel: true,
      use: {
        ...devices["Desktop Safari"],
        storageState: "test-results/.auth/student-webkit.json",
      },
    },
    {
      name: "study-stream-v2-chromium",
      testMatch: /study-stream-v2\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "student-shell-chromium",
      testMatch: /student-shell\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "student-shell-mobile",
      testMatch: /student-shell\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Pixel 7"],
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "role-redirects",
      testMatch: /role-redirects\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin-roster",
      testMatch: /admin-roster\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "locale-chromium",
      testMatch: /locale\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "locale-student-chromium",
      testMatch: /locale-routes\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "study-navigation-chromium",
      testMatch: /study-navigation\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "study-navigation-mobile",
      testMatch: /study-navigation\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "student-spacing-desktop",
      testMatch: /student-spacing\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "student-spacing-mobile",
      testMatch: /student-spacing\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "study-card-fidelity-chromium",
      testMatch: /study-card-fidelity\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "study-card-fidelity-mobile",
      testMatch: /study-card-fidelity\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "word-card-fidelity-fixtures-320",
      testMatch: /word-card-fidelity-fixtures\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 568 },
      },
    },
    {
      name: "word-card-fidelity-fixtures-390",
      testMatch: /word-card-fidelity-fixtures\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "study-action-fidelity-desktop",
      testMatch: /study-action-fidelity\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "study-action-fidelity-mobile",
      testMatch: /study-action-fidelity\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
    {
      name: "student-final-qa",
      testMatch: /student-ui-final-qa\.spec\.ts/,
      dependencies: ["auth-setup-chromium"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "test-results/.auth/student-chromium.json",
      },
    },
  ],
});
