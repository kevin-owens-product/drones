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

test("the plan map shows the wind over the terrain and what it costs each tail", async ({ page }) => {
  await page.goto("/#missions");
  const root = page.getByTestId("missions");
  await root.getByRole("button", { name: /Road junction overwatch/ }).click();
  await root.getByRole("slider", { name: "Wind speed" }).fill("12");
  await root.getByLabel("Wind direction").selectOption({ label: "E" });
  await expect(root.getByTestId("physics-findings").locator(".ph-finding", { hasText: "sinking air" }).first()).toBeVisible();
  await root.getByRole("button", { name: "Wind", exact: true }).click();
  await expect(root.locator(".ph-wind-sink").first()).toBeVisible();
  await expect(root.getByTestId("plan-wind")).toContainText("Road junction");
});

test("a brief shows what each camera sees by height, and the height can be set before approval", async ({ page }) => {
  await page.goto("/#brief");
  const brief = page.getByTestId("brief");
  await brief.getByRole("button", { name: /Brief: Observe gate 3/ }).click();
  await expect(brief.getByTestId("ladder-NX-10")).toContainText("cannot recognise a person");
  const eo = brief.getByTestId("ladder-NX-07");
  await expect(eo.locator(".br-rung.is-set")).toContainText("150");
  await eo.getByRole("button", { name: /NX-07 at 100 m/ }).click();
  await expect(eo.locator(".br-rung.is-set")).toContainText("100");
  await expect(eo).toContainText("Set to 100 m");
});

test("an airframe shows its wear by flight load and the maintainer's call", async ({ page }) => {
  await page.goto("/#fleet");
  await expect(page.locator("#fleet tr", { hasText: "NX-01" }).getByTestId("wear-flag")).toContainText("M3 bearing");
  await page.locator("#fleet tr", { hasText: "NX-01" }).click();
  const wear = page.getByTestId("wear");
  await expect(wear).toContainText("spin-check");
  await expect(wear.getByTestId("wear-chart")).toBeVisible();
  await expect(wear.getByRole("button", { name: /Ground NX-01 for a motor check/ })).toBeVisible();
});
