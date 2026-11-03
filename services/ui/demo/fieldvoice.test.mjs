import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, FLEET_SHARE, fileReport, seedReports, triage } from "./fieldvoice.mjs";

test("classify uses word boundaries and falls back to other", () => {
  assert.deepEqual(classify("Video froze at the tree line"), ["video"]);
  assert.deepEqual(classify("Video stuttered when the radio link was weak"), ["video", "link"]);
  assert.deepEqual(classify("Prop chipped on landing"), ["airframe"]);
  assert.deepEqual(classify("all good today"), ["other"]);
  // "map" is a console word, "mapping" is not a whole-word match for "jam".
  assert.deepEqual(classify("pajamas"), ["other"]);
});

test("triage points at the build that carries a theme", () => {
  const groups = triage(seedReports(Date.UTC(2026, 10, 3, 18)), FLEET_SHARE);
  const video = groups.find((g) => g.theme === "video");
  assert.equal(video.count, 6);
  assert.equal(video.top_build, "4.6.0");
  assert.equal(video.top_build_count, 6);
  assert.equal(video.concentrated, true);
  assert.equal(groups[0].theme, "video", "concentrated themes sort first");
  const airframe = groups.find((g) => g.theme === "airframe");
  assert.equal(airframe.concentrated, false);
  // Two of four link reports on one build is not enough to point at it.
  assert.equal(groups.find((g) => g.theme === "link").concentrated, false);
});

test("fileReport validates, keeps 30 s of samples and the build", () => {
  const store = [];
  const now = 1_000_000;
  assert.ok(fileReport(store, { tail: "NX-02", text: "" }, now).error);
  assert.ok(fileReport(store, { tail: "", text: "x" }, now).error);
  const r = fileReport(store, { tail: "NX-02", text: "video froze", samples: [{ t: now - 40_000 }, { t: now - 10_000, alt: 100 }] }, now);
  assert.equal(r.firmware, "4.6.0");
  assert.deepEqual(r.themes, ["video"]);
  assert.equal(r.samples.length, 1);
  assert.equal(store.length, 1);
});
