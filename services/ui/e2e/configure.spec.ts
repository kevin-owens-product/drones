import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("cold weather moves the recommendation to the bigger pack", async ({ page }) => {
  await page.goto("/#configure");
  const root = page.getByTestId("configure");
  await expect(root.locator(".cf-answer")).toContainText("6S 2200 mAh LiPo");
  await root.getByLabel("Temperature").fill("-20");
  await expect(root.locator(".cf-answer")).toContainText("6S 4000 mAh Li-ion");
  await root.getByLabel("Expected jamming").selectOption("heavy");
  await root.getByLabel("Range, one way").fill("5");
  await expect(root.locator(".cf-answer")).toContainText("hardened radio");
});
