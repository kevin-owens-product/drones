import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo).
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("the plan's launch checks find the terrain shadow and the cold packs, and a fix re-plans", async ({ page }) => {
  await page.goto("/#missions");
  const root = page.getByTestId("missions");
  await root.getByRole("button", { name: /Dawn survey/ }).click();
  const findings = root.getByTestId("physics-findings");
  await expect(findings.locator(".ph-finding", { hasText: "NX-07 drops out behind terrain at Culvert" })).toBeVisible();
  await expect(findings.locator(".ph-finding", { hasText: "cold pack sags" }).first()).toBeVisible();
  await expect(root.getByTestId("plan-packs")).toBeVisible();
  // The plan map can show the video link over the terrain.
  await root.getByRole("button", { name: "Video link" }).click();
  await expect(root.locator(".ph-profile").first()).toBeVisible();
  await findings.locator(".ph-finding", { hasText: "NX-07 drops out behind terrain" }).getByRole("button", { name: "Apply" }).first().click();
  await expect(root.locator(".ph-outcome")).toContainText("added as a relay");
  await expect(findings.locator(".ph-finding", { hasText: "NX-07 drops out behind terrain" })).toHaveCount(0);
  await expect(root.locator(".objective-list")).toContainText("relay");
  // A warmer night clears the pack findings.
  await root.getByRole("slider", { name: "Air temperature" }).fill("20");
  await expect(findings.locator(".ph-finding", { hasText: "cold pack sags" })).toHaveCount(0);
});

test("the old physics link lands on Missions", async ({ page }) => {
  await page.goto("/#physics");
  await expect(page.getByTestId("missions")).toBeVisible();
});

test("the loadout planner shows packs and thrust in the planner's air", async ({ page }) => {
  await page.goto("/#configure");
  const panel = page.getByTestId("loadout-tonight");
  await expect(panel).toContainText("Not needed");
  await page.getByTestId("configure").getByLabel("Temperature").fill("-10");
  await expect(panel).toContainText("in the warmer");
  await expect(panel.locator(".ph-env-now")).toHaveCount(1);
});

test("an airframe shows what its next sortie needs on the pad", async ({ page }) => {
  await page.goto("/#fleet");
  await page.locator("#fleet tr", { hasText: "NX-06" }).click();
  const next = page.getByTestId("next-sortie");
  await expect(next).toContainText("M-1035");
  await expect(next).toContainText("Preheat");
});

test("operate can shade where the station's control link is thin behind terrain", async ({ page }) => {
  await page.goto("/#operate");
  await page.getByRole("button", { name: "Radio shadow" }).click();
  await expect(page.locator(".tac-shadow").first()).toBeVisible();
});

test("debrief shows where the energy went and the link margin over the terrain", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("a2e-debrief-mission", "M-1029"));
  await page.goto("/#debrief");
  await expect(page.getByTestId("debrief-energy")).toContainText("Fighting the wind");
  await expect(page.getByTestId("debrief-energy")).toContainText("Cold pack");
  await expect(page.getByTestId("debrief-margin")).toContainText("worst control");
});

test("stockpile projects a pack's capacity and what a storage charge buys", async ({ page }) => {
  await page.goto("/#stockpile");
  const fade = page.getByTestId("stock-fade");
  await expect(fade).toContainText("at storage charge");
  const second = page.getByTestId("stock-rows").locator(".sp-pick").nth(1);
  const serial = (await second.textContent()) ?? "";
  await second.click();
  await expect(fade).toContainText(serial);
});
