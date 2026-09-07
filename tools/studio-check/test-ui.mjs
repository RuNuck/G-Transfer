// UI checks: mobile log tab, tap targets, contrast, library section, accessible brief. node test-ui.mjs [baseUrl]
import { chromium } from "file:///C:/Users/RuNuc/Desktop/Workspace/node_modules/playwright/index.mjs";
const BASE = process.argv[2] ?? "http://localhost:8080/";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const problems = [];
const expect = (cond, what) => { if (!cond) problems.push(what); };
const pageErrors = [];

// Mobile.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
mobile.on("pageerror", (e) => pageErrors.push("mobile: " + String(e).slice(0, 160)));
await mobile.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await mobile.evaluate(() => localStorage.clear());
await mobile.reload({ waitUntil: "networkidle" });
const navLabels = await mobile.evaluate(() => [...document.querySelectorAll("nav button")].map((b) => b.textContent.trim()));
expect(navLabels.includes("Log"), `mobile nav lacks Log: ${navLabels}`);
await mobile.click("nav button:has-text('Log')");
await mobile.waitForTimeout(300);
const sheet = (await mobile.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
expect(/resources\/list/.test(sheet) && /initialize/.test(sheet), "mobile log sheet does not show the MCP log");
await mobile.click('button:text-is("Close")');
const heights = await mobile.evaluate(() => ({
  engine: [...document.querySelectorAll("header button")].map((b) => b.getBoundingClientRect().height),
  strip: [...document.querySelectorAll("main > div.flex.shrink-0 button")].map((b) => b.getBoundingClientRect().height),
  nav: [...document.querySelectorAll("nav button")].map((b) => b.getBoundingClientRect().height),
}));
expect(heights.engine.every((h) => h >= 44), `engine buttons ${heights.engine}`);
expect(heights.strip.length > 0 && heights.strip.every((h) => h >= 44), `catalog strip buttons ${heights.strip.slice(0, 4)}`);
expect(heights.nav.every((h) => h >= 44), `nav buttons ${heights.nav}`);
await mobile.click("nav button:has-text('Inspect')");
await mobile.waitForTimeout(300);
const inspectHeights = await mobile.evaluate(() => [...document.querySelectorAll("aside button, div.absolute button")].filter((b) => /^(lit|clay|wire|unlit)$/.test(b.textContent.trim())).map((b) => b.getBoundingClientRect().height).filter((h) => h > 0));
expect(inspectHeights.length === 4 && inspectHeights.every((h) => h >= 40), `mode buttons on mobile ${inspectHeights}`);
const subtle = await mobile.evaluate(() => getComputedStyle(document.querySelector(".text-subtle")).color);
expect(subtle === "rgb(128, 126, 121)", `subtle colour ${subtle}`);
const briefLabel = await mobile.evaluate(() => document.querySelector("input[placeholder^='Sci-fi crate']")?.getAttribute("aria-label"));
expect(briefLabel === "Brief", `brief aria-label ${briefLabel}`);
await mobile.close();

// Desktop: library section behaviour.
const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
desk.on("pageerror", (e) => pageErrors.push("desktop: " + String(e).slice(0, 160)));
await desk.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await desk.evaluate(() => localStorage.clear());
await desk.reload({ waitUntil: "networkidle" });
const libraryEntries = () => desk.evaluate(() => [...document.querySelectorAll("[data-testid=library] li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()));
const currentMesh = () => desk.evaluate(() => document.querySelector("aside h2")?.textContent?.trim());
await desk.click("li button:has-text('Oil barrel')");
await desk.click("li button:has-text('Relic chest')");
await desk.waitForTimeout(200);
const chestMesh = await currentMesh();  // whatever the current engine names it, so this reads the same on any default
const afterTwo = await libraryEntries();
expect(afterTwo.length === 3 && /Relic chest/.test(afterTwo[0]), `library after two picks: ${JSON.stringify(afterTwo)}`);
await desk.click("li button:has-text('Oil barrel')");
await desk.waitForTimeout(200);
const afterRepick = await libraryEntries();
expect(afterRepick.length === 3 && /Oil barrel/.test(afterRepick[0]), `re-pick duplicated: ${JSON.stringify(afterRepick)}`);
await desk.click("[data-testid=library] li button:has-text('Relic chest')");
await desk.waitForTimeout(200);
const meshAfterLoad = await currentMesh();
expect(meshAfterLoad === chestMesh, `load from library -> ${meshAfterLoad}, expected ${chestMesh}`);
await desk.click("[data-testid=library] button[aria-label^='Remove Relic chest']");
await desk.waitForTimeout(200);
const afterRemove = await libraryEntries();
const meshAfterRemove = await currentMesh();
expect(afterRemove.length === 2 && !afterRemove.some((e) => /Relic chest/.test(e)), `remove: ${JSON.stringify(afterRemove)}`);
expect(meshAfterRemove !== chestMesh, `current asset after removing it: ${meshAfterRemove}`);
await desk.close();
await browser.close();

console.log(JSON.stringify({ ok: problems.length === 0 && pageErrors.length === 0, problems, pageErrors }, null, 2));
process.exit(problems.length || pageErrors.length ? 1 : 0);
