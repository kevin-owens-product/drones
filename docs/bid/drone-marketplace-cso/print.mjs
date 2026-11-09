// Print the brief HTML to PDF with Chromium and report the page count.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [, , html, out] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href);
const legend = "Use or disclosure of data contained on this sheet is subject to the restriction on the title page of this proposal.";
await page.pdf({
  path: out, format: "Letter", printBackground: true,
  margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:8pt;font-family:serif;text-align:center;padding:0 0.5in">${legend}<br/>Product Exec, Co. · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
});
await browser.close();
const pages = (readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`${out}: ${pages} pages (limit 7: title + 5 body + IP statement)`);
if (pages > 7) process.exitCode = 1;
