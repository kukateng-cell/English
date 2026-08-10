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
      use: {
        ...devices["Desktop Safari"],
        storageState: "test-results/.auth/student-webkit.json",
      },
    },
  ],
});
