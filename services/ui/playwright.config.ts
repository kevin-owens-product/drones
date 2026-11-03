import { defineConfig } from "@playwright/test";

const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.A2E_UI_ORIGIN ?? "http://localhost:8000",
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
});
