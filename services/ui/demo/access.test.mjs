import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { check, probe, render } from "./access.mjs";
import { createDemo } from "./scenario.mjs";

const terrain = JSON.parse(await readFile(new URL("./assets/terrain.json", import.meta.url), "utf8"));
const attrition = JSON.parse(await readFile(new URL("./assets/attrition.json", import.meta.url), "utf8"));
const make = () => createDemo({ speed: 6, extra: 0, terrain, attrition, readme: "" });

test("the demo keeps its access rules: workspace, role, audit, tenant accounts, releasability, no inbound commands", () => {
  assert.deepEqual(check(probe(make)), []);
});

test("docs/security/demo-access-matrix.md is what the code produces today", async () => {
  const doc = await readFile(new URL("../../../docs/security/demo-access-matrix.md", import.meta.url), "utf8");
  assert.equal(doc, render(probe(make)), "run `node demo/access-matrix.mjs > ../../docs/security/demo-access-matrix.md` and commit it");
});
