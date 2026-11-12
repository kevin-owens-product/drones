import { expect, test } from "@playwright/test";

// Runs against the demo sortie (node demo/server.mjs). The local demo signs in
// as a mission commander and maintainer, so it can receive and issue.
test.skip(!process.env.A2E_DEMO, "needs the demo server");

test("a receiving officer rejects the serials that fail their checks and accepts the rest", async ({ page }) => {
  await page.goto("/#receiving");
  await page.getByRole("button", { name: "Open the package" }).click();
  const pkg = page.getByTestId("package");
  await expect(pkg).toContainText("No end-of-line bench record");
  await expect(pkg).toContainText("Firmware 1.15.4-dev is not a released build");
  await pkg.getByRole("button", { name: "Accept 58, reject 2" }).click();
  await expect(page.locator(".ops-note")).toContainText("58 accepted, 2 rejected");
  await expect(page.getByTestId("receiving-history")).toContainText("Bench record missing");
});

test("accountability opens a serial's hash-chained record from an end-of-flight record", async ({ page }) => {
  await page.goto("/#accountability");
  await expect(page.getByTestId("acct-units")).toContainText("Bravo");
  await page.getByTestId("acct-records").locator(".th-link").first().click();
  await expect(page.getByTestId("serial-drawer")).toContainText("Chain verified");
  await expect(page.getByTestId("serial-drawer")).toContainText("born");
  // The drawer sits over the shell and closes from the keyboard.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("serial-drawer")).toBeHidden();
});

test("quality flags the ESC lot from shared field records", async ({ page }) => {
  await page.goto("/#quality");
  await expect(page.getByTestId("quality-lots").locator("tr", { hasText: "ESC-2611" })).toContainText("out of family");
  await expect(page.getByTestId("sampling")).toContainText("Sample 1 in 5");
});

test("compliance shows provenance gaps and a delivery lot's packet", async ({ page }) => {
  await page.goto("/#compliance");
  await expect(page.getByTestId("compliance-lots").locator("tr", { hasText: "CM-0318" })).toContainText("Gap");
  await page.getByRole("button", { name: "DL-2618" }).click();
  await expect(page.getByTestId("packet-drawer")).toContainText("fcc_exemption_ends");
});

test("readiness joins training to sorties and books a refresher", async ({ page }) => {
  await page.goto("/#readiness");
  await expect(page.getByTestId("training-effect")).toContainText("6 of 6 sessions");
  const row = page.getByTestId("readiness-operators").locator("tr", { hasText: "Simulator qualification not passed" }).first();
  await row.getByRole("button", { name: "Book requalification" }).click();
  await expect(page.locator(".ops-note")).toContainText("simulator qualification booked");
});

test("updates halt a re-band release when its canary loses link", async ({ page }) => {
  await page.goto("/#updates");
  const rf = page.getByTestId("releases").locator("li.ops-item", { hasText: "RF-P4" });
  await rf.getByRole("button", { name: "Approve for our fleet" }).click();
  await rf.getByRole("button", { name: "Fly the canary" }).click();
  await expect(page.locator(".ops-note")).toContainText("halted automatically");
  await expect(page.getByTestId("canary-RF-P4")).toContainText("Fail");
});

test("integrations show the CoT the fleet sends and let the customer turn a feed off", async ({ page }) => {
  await page.goto("/#integrations");
  await expect(page.getByTestId("sample")).toContainText('type="a-f-A-M-H-Q"');
  await expect(page.getByTestId("mavlink")).toContainText("GLOBAL_POSITION_INT");
  await page.getByTestId("feeds").locator("tr", { hasText: "TAK Server" }).getByRole("button", { name: "Turn off" }).click();
  await expect(page.locator(".ops-note")).toContainText("TAK Server feed off");
});

test("the program cockpit joins price, completion and delivery", async ({ page }) => {
  await page.goto("/#program");
  await expect(page.getByTestId("ladder")).toContainText("$2,300");
  await expect(page.getByTestId("levers")).toContainText("per completed sortie");
  await expect(page.getByTestId("program-orders")).toContainText("ORD-A1");
});
