import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.A2E_UI_ORIGIN ?? "http://localhost:8000" },
});
