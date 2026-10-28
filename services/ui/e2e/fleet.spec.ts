import { expect, test } from "@playwright/test";

test("banner stays at system high and hides NOFORN from a GBR analyst", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#banner")).toContainText("CUI");
  await page.locator("#username").fill("gwen.analyst");
  await page.locator("#password").fill(process.env.A2E_DEV_LOGIN_PASSWORD ?? "unit-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#who")).toContainText("gwen.analyst");
  await expect(page.locator("#fleet")).toContainText("N-002");
  await expect(page.locator("#fleet")).not.toContainText("N-001");
  await expect(page.locator("#banner")).toContainText("CUI");
});
