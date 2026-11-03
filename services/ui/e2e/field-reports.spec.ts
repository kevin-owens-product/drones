import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("an operator files a report from Operate and it lands in its theme with telemetry", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  // Let a few polls build history so the report has samples to pin.
  await page.waitForTimeout(4000);
  await page.locator('#fleet [data-tail="NX-02"]').click();
  await expect(page.locator(".op-detail h2")).toHaveText("NX-02");
  await page.getByRole("button", { name: /Report issue/ }).click();
  await page.locator("#op-report-text").fill("Video froze for a second over the river");
  await page.getByRole("button", { name: "File report" }).click();
  await expect(page.locator(".op-report-note")).toContainText(/Filed FR-\d+ with \d+ telemetry samples/);

  await page.goto("/#reports");
  const root = page.getByTestId("field-reports");
  const video = root.locator(".fr-theme", { hasText: "Video feed" });
  await expect(video).toContainText("Look at build 4.6.0");
  await video.click();
  const mine = root.locator(".fr-item", { hasText: "over the river" });
  await expect(mine).toContainText("fw 4.6.0");
  await expect(mine).toContainText("samples pinned");
});
