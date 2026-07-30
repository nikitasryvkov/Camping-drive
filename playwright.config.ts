import { defineConfig, devices } from "@playwright/test";

import { applyStage9Environment, stage9Environment } from "./e2e/test-environment";

applyStage9Environment();

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:5181",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: "admin.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: "mobile.spec.ts",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: [
    {
      name: "backend",
      command: "npx tsx server/src/index.ts",
      url: "http://127.0.0.1:3010/api/health/ready",
      env: { ...process.env, ...stage9Environment },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "frontend",
      command: "npx vite --host 127.0.0.1 --port 5181 --strictPort",
      url: "http://127.0.0.1:5181",
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: "http://127.0.0.1:3010",
        VITE_SITE_URL: "http://127.0.0.1:5181",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
