// Renders docs/security/demo-access-matrix.md from the demo scenario. CI diffs the output against the file.
import { readFile } from "node:fs/promises";
import { createDemo } from "./scenario.mjs";
import { probe, render } from "./access.mjs";

const terrain = JSON.parse(await readFile(new URL("./assets/terrain.json", import.meta.url), "utf8"));
const attrition = JSON.parse(await readFile(new URL("./assets/attrition.json", import.meta.url), "utf8"));
process.stdout.write(render(probe(() => createDemo({ speed: 6, extra: 0, terrain, attrition, readme: "" }))));
