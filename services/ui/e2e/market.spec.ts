import { expect, test } from "@playwright/test";

// Runs against the demo sortie (node demo/server.mjs). The local demo signs in
// as a mission commander and maintainer with every page showing.
test.skip(!process.env.A2E_DEMO, "needs the demo server");

test("a unit configures a kit, sees its sortie cost and date, and requests a quote", async ({ page }) => {
  await page.goto("/#quote");
  await expect(page.getByTestId("quote-lines")).toContainText("Archer 5″, Thermal and FPV");
  await page.getByLabel("Quantity").fill("200");
  await expect(page.getByTestId("quote-lines")).toContainText("200");
  await expect(page.getByTestId("quote-evidence")).toContainText("Accepted on delivery");
  await page.getByRole("button", { name: "Request this quote" }).click();
  await expect(page.locator(".ops-note")).toContainText("sent to Neros");
  await expect(page.getByTestId("quotes")).toContainText("requested");
});

test("all vendors imports a flight log, refuses bad rows with the reason, and explains the missing record", async ({ page }) => {
  await page.goto("/#mixed");
  await expect(page.getByTestId("mixed-units")).toContainText("Delta");
  await page.getByRole("button", { name: "Use the sample export" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".ops-note")).toContainText("2 flights imported; 2 rows refused");
  await expect(page.getByTestId("mixed-tails")).toContainText("PBE-2231");
  await page.getByTestId("mixed-tails").locator("tr", { hasText: "SRQ-101" }).getByRole("button", { name: "Flight log" }).click();
  await expect(page.getByTestId("mixed-why")).toContainText("no birth record");
});

test("configuration refuses a mismatched swap and holds a converted airframe until its parameters load", async ({ page }) => {
  await page.goto("/#config");
  const first = page.getByTestId("config-rows").locator("tbody tr").first();
  await first.getByRole("button", { name: "Change" }).click();
  await first.getByLabel("Part").selectOption("arm");
  await first.getByLabel("Fit").selectOption("ARM-10");
  await first.getByRole("button", { name: "Fit" }).click();
  await expect(page.locator(".ops-note")).toContainText("Refused: 10-inch arms need MOT-L");
  await first.getByRole("button", { name: "8-inch" }).click();
  await expect(page.locator(".ops-note")).toContainText("Held from ready");
  await page.getByTestId("config-rows").getByRole("button", { name: "Load P-8" }).click();
  await expect(page.locator(".ops-note")).toContainText("back to ready");
});
