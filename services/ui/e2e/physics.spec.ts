import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("the physics check finds the terrain shadow and the cold packs, and a fix re-plans", async ({ page }) => {
  await page.goto("/#physics");
  const root = page.getByTestId("physics-check");
  await expect(root.locator(".page-title")).toHaveText("Physics check");
  await expect(root.locator(".ph-finding", { hasText: "NX-07 drops out behind terrain at Culvert" })).toBeVisible();
  await expect(root.locator(".ph-finding", { hasText: "cold pack sags" }).first()).toBeVisible();
  const relay = root.locator(".ph-finding", { hasText: "NX-07 drops out behind terrain" }).getByRole("button", { name: "Apply" }).first();
  await relay.click();
  await expect(root.locator(".ph-outcome")).toContainText("added as a relay");
  await expect(root.locator(".ph-finding", { hasText: "NX-07 drops out behind terrain" })).toHaveCount(0);
  // A warmer night clears the pack findings.
  await root.getByRole("slider", { name: "Air temperature" }).fill("20");
  await expect(root.locator(".ph-finding", { hasText: "cold pack sags" })).toHaveCount(0);
});
