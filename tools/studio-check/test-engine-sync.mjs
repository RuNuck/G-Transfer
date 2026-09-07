// The header engine switch must re-target the current asset (Inspector naming, folder) and persist consistently.
import { chromium } from "file:///C:/Users/RuNuc/Desktop/Workspace/node_modules/playwright/index.mjs";
const BASE = process.argv[2] ?? "http://localhost:8080/";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
const state = async () => page.evaluate(() => ({
  active: [...document.querySelectorAll("header button")].find((b) => b.className.includes("bg-accent"))?.textContent?.trim(),
  mesh: document.querySelector("aside h2")?.textContent?.trim(),
  folder: document.querySelector("aside h2 + p")?.textContent?.trim(),
  qcBadges: [...document.querySelectorAll("aside li span")].map((s) => s.textContent.trim()).filter((t) => ["PASS", "FLAG", "NOTE"].includes(t)),
}));
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.click("li button:has-text('Supply crate')");
await page.waitForTimeout(400);
const fresh = await state();  // a fresh session opens on the default engine (Godot)
await page.click("header button:has-text('Unity')");
await page.waitForTimeout(400);
const unity = await state();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const afterReload = await state();
await page.click("header button:has-text('Godot')");
await page.click("li button:has-text('Hero mannequin')");
await page.waitForTimeout(400);
const godotPick = await state();
const report = { fresh, unity, afterReload, godotPick, pageErrors };
report.ok =
  fresh.active === "Godot" && fresh.mesh === "supply_crate" && fresh.folder.startsWith("res://") &&
  unity.active === "Unity" && unity.mesh === "Supply_crate" && unity.folder.startsWith("Assets/") &&
  afterReload.active === "Unity" && afterReload.mesh === "Supply_crate" &&
  godotPick.active === "Godot" && godotPick.mesh === "hero_mannequin" && godotPick.folder.startsWith("res://") &&
  fresh.qcBadges.filter((b) => b === "NOTE").length === 2 && !fresh.qcBadges.includes("FLAG") && !godotPick.qcBadges.includes("FLAG") &&
  pageErrors.length === 0;
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
