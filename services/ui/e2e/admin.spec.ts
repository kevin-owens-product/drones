import { expect, test } from "@playwright/test";

// Runs against the demo sortie (node demo/server.mjs), like operate.spec.ts.
test.skip(!process.env.A2E_DEMO, "needs the demo server");

test("fleet shows each tail's birth record and the lot Attrition flagged", async ({ page }) => {
  await page.goto("/#fleet");
  await page.locator("#fleet tr", { hasText: "NX-12" }).click();
  await expect(page.getByTestId("birth-record")).toContainText("Failed: IMU cal out of range");
  await page.locator("#fleet tr", { hasText: "NX-05" }).click();
  await expect(page.getByTestId("birth-record")).toContainText("Flagged by Attrition");
  await expect(page.getByTestId("quality-holds")).toContainText("ESC lot ESC-2611");
});

test("old admin links land on Access, which shows roles from the policy matrix", async ({ page }) => {
  await page.goto("/#people");
  await expect(page).toHaveURL(/#access$/);
  await expect(page.getByTestId("access")).toContainText("Mission commander");
  await expect(page.getByTestId("access")).toContainText("Demo Maintainer");
});

test("an approved brief lands in the audit log with the chain intact", async ({ page }) => {
  await page.goto("/#brief");
  await page.locator("textarea").fill("Survey the north field with three drones");
  await page.getByRole("button", { name: "Read brief" }).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.goto("/#audit");
  await expect(page.locator(".chain")).toContainText("Plan approved");
  await expect(page.getByTestId("chain-status")).toContainText("Chain intact");
});
