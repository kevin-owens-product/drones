import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo), which serves a scripted sortie.
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("operate screen ranks vehicles that need the operator first", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(9);
  const first = page.locator("#fleet [data-tail]").first();
  await expect(first).toHaveClass(/health-alert/);
  await expect(page.locator("#fleet")).toContainText("GNSS rejected");
});

test("keyboard and palette select a vehicle and show its flight display", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(9);
  await page.keyboard.press("j");
  await expect(page.locator(".op-detail h2")).toHaveText(/NX-0\d/);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("NX-04");
  await page.keyboard.press("Enter");
  await expect(page.locator(".op-detail h2")).toHaveText("NX-04");
  await expect(page.locator(".op-detail")).toContainText("VIO");
  await expect(page.locator(".tac-hint")).toHaveText("Following");
});

test("filter narrows the list to GNSS-denied vehicles", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "GNSS denied" }).click();
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(1);
  await expect(page.locator("#fleet")).toContainText("NX-04");
});
