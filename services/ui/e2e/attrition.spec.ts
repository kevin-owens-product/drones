import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo), which serves the baked attrition report.
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("attrition page shows cost per effective sortie, the autopsy alert and the build order", async ({ page }) => {
  await page.goto("/#attrition");
  const root = page.getByTestId("attrition");
  await expect(root.locator(".page-title")).toHaveText("Attrition");
  await expect(root).toContainText("Simulated");
  await expect(root).toContainText("Cost per effective sortie");
  await expect(root.locator(".ins-alert").first()).toContainText("ESC lot");
  await expect(root).toContainText("Build next");
  const hold = root.locator(".ins-alert").first().getByRole("button");
  await hold.click();
  await expect(root.locator(".ins-held").first()).toContainText("nothing was sent to a vehicle");
  await expect(hold).toBeDisabled();
});
