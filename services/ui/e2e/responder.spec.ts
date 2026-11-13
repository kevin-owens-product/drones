import { expect, test } from "@playwright/test";

// Runs against the demo server (node demo/server.mjs). The local demo has no sign-in, so the console
// holds both seats: supervisor and pilot. demo/access.test.mjs holds each real login to its own seat.
test.skip(!process.env.A2E_DEMO, "needs the demo server: A2E_DEMO=1 A2E_UI_ORIGIN=http://localhost:4173");

test("a call is approved, launched, ended by the pilot for gusts, and its record is filed and sealed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#respond");
  await expect(page.getByTestId("discrepancies")).toContainText("Dock 3 charger slow");
  const queue = page.getByTestId("call-queue");
  const rescue = queue.locator("[data-call]", { hasText: "Water rescue" });
  await expect(rescue).toContainText("Nearest ready: Dock 1");
  await rescue.getByRole("button", { name: "Approve launch" }).click();
  await expect(rescue.getByTestId("preflight")).toContainText("Dock 1: West basin powered and communicating");
  await expect(rescue.getByTestId("preflight")).toContainText("Route crosses Crane row B");
  await rescue.getByRole("button", { name: /^Launch Dock 1/ }).click();

  const flight = page.getByTestId("flights").locator("[data-flight]").first();
  await expect(flight).toContainText("DFR-01");
  await expect(flight.getByRole("alert")).toContainText("over the 12 m/s waiver limit", { timeout: 60_000 });
  await flight.getByRole("button", { name: "Terminate as RPIC" }).click();
  await flight.getByRole("button", { name: "End flight now" }).click();
  await expect(flight).toContainText("Terminated by RPIC: Gusts 13.4 m/s");

  // The record that was waiting from earlier in the shift: prefilled, written once, then corrected beside the original.
  await page.goto("/#records");
  const form = page.getByTestId("record-form");
  await expect(form).toContainText("Approving authority");
  await expect(form).toContainText("Sgt. M. Ortega");
  await form.locator("textarea").fill("Gate camera showed a gull on the beam sensor. No person found; units cleared the gate.");
  await form.getByRole("button", { name: "File the record" }).click();
  await expect(page.getByTestId("versions")).toContainText("Version 1");
  await page.getByTestId("record-form").getByRole("button", { name: "Correct" }).click();
  await page.getByPlaceholder("Required: kept beside the original").fill("Added the sensor id");
  await page.getByTestId("record-form").getByRole("button", { name: "File the correction" }).click();
  await expect(page.getByTestId("versions")).toContainText("Version 2");
  await expect(page.getByTestId("declined")).toContainText("TFR over the cruise terminal");
});

test("the program manager fills the empty day and signs the onboarding pilot off for solo shifts", async ({ page }) => {
  await page.goto("/#crew");
  const roster = page.getByTestId("roster");
  const gap = roster.locator("tr", { hasText: "Unstaffed" });
  await expect(gap).toHaveCount(1);
  const day = await gap.getAttribute("data-day");
  await page.getByLabel(`Pilot on ${day}`).selectOption("P-02");
  await expect(roster.locator(`tr[data-day="${day}"]`)).toContainText("Covered");
  // An expired TWIC keeps a pilot off the roster entirely.
  const reyes = page.getByTestId("pilot-files").locator('[data-pilot="P-01"]');
  await expect(reyes).toContainText("Cannot be rostered");
  const nguyen = page.getByTestId("pilot-files").locator('[data-pilot="P-04"]');
  await nguyen.getByRole("button", { name: "Sign off for solo shifts" }).click();
  await expect(nguyen).toContainText("Cleared for solo");
});
