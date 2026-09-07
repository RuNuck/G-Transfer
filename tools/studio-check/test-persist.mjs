// Persistence test: state set in one page load must be identical after a reload; corrupt storage must not crash.
import { chromium } from "file:///C:/Users/RuNuc/Desktop/Workspace/node_modules/playwright/index.mjs";

const URL = "http://localhost:8080/";
const KEY = "anvil-forge-v1";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

const snapshot = async () => page.evaluate(() => {
  const active = [...document.querySelectorAll("header button")].find((b) => b.className.includes("bg-accent"))?.textContent?.trim();
  const mesh = document.querySelector("aside h2")?.textContent?.trim();
  const brief = document.querySelector("input[placeholder^='Sci-fi crate']")?.value;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("anvil-forge-v1")); } catch { stored = null; }
  return { active, mesh, brief, storedEngine: stored?.state?.engine, storedKind: stored?.state?.spec?.kind, storedName: stored?.state?.spec?.name, libraryLength: stored?.state?.library?.length, version: stored?.version };
});

const report = { steps: {} };

// 1. Fresh session: change engine, pick a prototype, forge a brief, then reload.
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.click("header button:has-text('Godot')");
await page.click("li button:has-text('Oil barrel')");
await page.fill("input[placeholder^='Sci-fi crate']", "Iron longsword, 1.1 m, weathered");
await page.click("button:has-text('Forge')");
await page.waitForTimeout(800);
const before = await snapshot();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const after = await snapshot();
report.steps.roundTrip = { before, after };
const same = ["active", "mesh", "brief", "storedEngine", "storedKind", "storedName", "libraryLength"].every((k) => before[k] === after[k]);
report.steps.roundTripOk = same && before.active === "Godot" && before.storedKind === "sword" && before.libraryLength === 3;

// 2. Corrupt storage from an older or broken build must fall back, not crash, and be rewritten sane.
await page.evaluate((key) => {
  localStorage.setItem(key, JSON.stringify({ state: { engine: "unreal5", brief: "", spec: { kind: "dragon", engine: "unreal" }, library: [{ kind: "dragon" }, 42, null], artDirect: true }, version: 0 }));
}, KEY);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const corruptLoad = await snapshot();
await page.click("li button:has-text('Relic chest')");
await page.waitForTimeout(300);
const afterPick = await snapshot();
report.steps.corrupt = { corruptLoad, afterPick };
report.steps.corruptOk = corruptLoad.active === "Godot" && corruptLoad.mesh === "supply_crate" && afterPick.storedKind === "chest" && afterPick.version === 1 && afterPick.libraryLength === 2;

// 3. A persisted spec with a missing field is repaired from the catalog rather than crashing the render.
await page.evaluate((key) => {
  const s = JSON.parse(localStorage.getItem(key));
  delete s.state.spec.triangleBudget;
  s.state.spec.texelDensity = "lots";
  s.state.engine = "unity";
  localStorage.setItem(key, JSON.stringify(s));
}, KEY);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const repaired = await snapshot();
report.steps.repaired = repaired;
report.steps.repairedOk = repaired.active === "Unity" && repaired.storedKind === "chest" && pageErrors.length === 0;

report.consoleErrors = consoleErrors;
report.pageErrors = pageErrors;
report.ok = report.steps.roundTripOk && report.steps.corruptOk && report.steps.repairedOk && pageErrors.length === 0;
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
