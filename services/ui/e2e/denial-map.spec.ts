import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("scout passes map the unbriefed spoofing zone and the route leaves it", async ({ page }) => {
  await page.goto("/#denial");
  const root = page.getByTestId("denial-map");
  await expect(root.locator(".page-title")).toHaveText("GNSS denial map");
  const exposure = root.locator(".stat").first().locator(".stat-value");
  await expect(exposure).not.toHaveText("0 m");
  await root.locator("#dm-passes").fill("4");
  await expect(exposure).toHaveText("0 m");
  await expect(root.locator(".dm-cell").first()).toBeVisible();
});
