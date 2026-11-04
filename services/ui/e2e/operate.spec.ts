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
  await expect(page.locator('#fleet [data-tail="NX-08"]')).toContainText("Airworthiness: Prop strike on recovery");
  // Airborne vehicles are not in the launch view.
  await expect(page.locator('#fleet [data-tail="NX-04"]')).toHaveCount(0);
  await page.locator('#fleet [data-tail="NX-08"]').click();
  await expect(page.locator(".ready-verdict")).toHaveText("NO-GO");
  await expect(page.locator(".op-detail")).toContainText("does not send flight commands or arm vehicles");
  // A vehicle seen from power-on through to GO gets a time, and the median shows it.
  await expect(page.getByTestId("ready-median")).toContainText(/median \d+ s/, { timeout: 130_000 });
  await expect(page.locator(".timeline-list")).toContainText(/Ready to launch, \d+ s from power-on/);
});

test("operating picture draws labeled sim overlays that the operator can switch off", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-legend")).toContainText("SIM");
  await expect(page.locator(".tac-zone-label")).toHaveText("GNSS jamming (sim)");
  await expect(page.locator(".tac-area")).toHaveCount(4);
  await expect(page.locator(".tac-task")).toHaveCount(4);
  await page.getByRole("button", { name: "Coverage" }).click();
  await expect(page.locator(".tac-area")).toHaveCount(0);
  await page.getByRole("button", { name: "Coverage" }).click();
  await expect(page.locator(".tac-area")).toHaveCount(4);
});

test("a vehicle on VIO shows its position error on the map and in the detail", async ({ page }) => {
  await page.goto("/");
  await page.locator('#fleet [data-tail="NX-04"]').click();
  await expect(page.locator(".tac-error-label")).toContainText(/±\d+ m \(95%\)/);
  await expect(page.locator(".op-detail")).toContainText("Position error (95%)");
});

test("dragging the timeline replays what the console received, and Esc returns to live", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  await page.waitForTimeout(4000);
  const strip = page.getByTestId("replay-strip");
  const box = await strip.boundingBox();
  if (!box) throw new Error("no strip");
  await page.mouse.click(box.x + box.width - 25, box.y + box.height / 2);
  await expect(page.getByTestId("replay-banner")).toContainText("REPLAY");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("replay-banner")).toHaveCount(0);
});

test("when a vehicle drops off the link its tasks are re-planned on the map and in the log", async ({ page }) => {
  // NX-07 leaves the network once per sortie loop, about every 100 s.
  test.setTimeout(150_000);
  await page.goto("/");
  await expect(page.locator(".timeline-list")).toContainText(/Re-plan: T\d NX-07 → NX-0\d/, { timeout: 130_000 });
  await expect(page.locator(".tac-task.is-fresh").first()).toBeVisible();
});

test("a large fleet switches to the density view with exceptions drawn individually", async ({ page }) => {
  const origin = process.env.A2E_DEMO_SCALE_ORIGIN;
  test.skip(!origin, "needs a second demo server: A2E_DEMO_FLEET=300 PORT=4174 npm run demo, then A2E_DEMO_SCALE_ORIGIN=http://localhost:4174");
  await page.goto(`${origin}/`);
  await expect(page.getByTestId("density-summary")).toContainText(/\d{3} vehicles/);
  await expect(page.getByRole("button", { name: "Density" })).toHaveAttribute("aria-pressed", "true");
});

test("the 3D view shows the fleet over terrain and switches back to the flat map", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#fleet [data-tail]")).toHaveCount(12);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.getByTestId("map-3d")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".m3-label", { hasText: "NX-04" })).toContainText(/m AGL/, { timeout: 15_000 });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".tac")).toBeVisible();
});
