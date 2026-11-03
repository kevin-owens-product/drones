import { expect, test } from "@playwright/test";

// Runs against the demo server (npm run demo), which serves a scripted sortie.
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("operate screen ranks vehicles that need the operator first", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  const first = page.locator("#fleet [data-tail]").first();
  await expect(first).toHaveClass(/health-alert/);
  await expect(page.locator("#fleet")).toContainText("GNSS rejected");
});

test("keyboard and palette select a vehicle and show its flight display", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  // The list can paint before the page's key handler is attached, so retry the key.
  await expect(async () => {
    await page.keyboard.press("j");
    await expect(page.locator(".op-detail h2")).toHaveText(/NX-0\d/, { timeout: 500 });
  }).toPass();
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

test("launch view gives each vehicle on the ground a go or no-go and times power-on to ready", async ({ page }) => {
  // The pad cycles every minute of real time at the default demo speed.
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  await expect(async () => {
    await page.keyboard.press("l");
    await expect(page.getByRole("button", { name: "Launch" })).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  }).toPass();
  // Restricted airframe: never go, whatever else is true.
  await expect(page.locator('#fleet [data-tail="NX-08"]')).toContainText("NO-GO");
  await expect(page.locator('#fleet [data-tail="NX-08"]')).toContainText("Airworthiness: Restricted");
  // Airborne vehicles are not in the launch view.
  await expect(page.locator('#fleet [data-tail="NX-04"]')).toHaveCount(0);
  await page.locator('#fleet [data-tail="NX-08"]').click();
  await expect(page.locator(".ready-verdict")).toHaveText("NO-GO");
  await expect(page.locator(".op-detail")).toContainText("does not send flight commands or arm vehicles");
  // A vehicle seen from power-on through to GO gets a time, and the median shows it.
  await expect(page.getByTestId("ready-median")).toContainText(/median \d+ s/, { timeout: 130_000 });
  await expect(page.locator(".timeline-list")).toContainText(/Ready to launch, \d+ s from power-on/);
});
