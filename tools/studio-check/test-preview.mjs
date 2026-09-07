// Preview test: measures real pixels of the viewport across view modes and inspects the exported GLB.
// node test-preview.mjs [baseUrl]
import { chromium } from "file:///C:/Users/RuNuc/Desktop/Workspace/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:8080/";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const consoleIssues = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleIssues.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

/** Mean RGB of the central region of the WebGL canvas, via a screenshot decoded in-page. */
async function sample() {
  await page.waitForTimeout(500);
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const w = Math.floor(img.width * 0.3), h = Math.floor(img.height * 0.3);
    const x0 = Math.floor((img.width - w) / 2), y0 = Math.floor((img.height - h) / 2);
    const { data } = ctx.getImageData(x0, y0, w, h);
    let r = 0, g = 0, b = 0, n = 0, lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
    }
    return { r: r / n, g: g / n, b: b / n, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, litFraction: lit / n };
  }, png.toString("base64"));
}
const diff = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
const clickMode = async (mode) => { await page.click(`aside button:text-is("${mode.toLowerCase()}")`); };

const report = { steps: {} };
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.click("li button:has-text('Shipping crate')");
await page.waitForTimeout(800);

const lit = await sample();
await clickMode("Clay");
const clay = await sample();
await clickMode("Lit");
const litAfterClay = await sample();
await clickMode("Wire");
const wire = await sample();
await clickMode("Lit");
const litAfterWire = await sample();
await clickMode("Unlit");
const unlit = await sample();
await clickMode("Lit");
const litAfterUnlit = await sample();
report.steps.samples = { lit, clay, litAfterClay, wire, litAfterWire, unlit, litAfterUnlit };
report.steps.litRestoresAfterClay = diff(lit, litAfterClay) < 6;
report.steps.litRestoresAfterWire = diff(lit, litAfterWire) < 6;
report.steps.litRestoresAfterUnlit = diff(lit, litAfterUnlit) < 6;
report.steps.clayDiffers = diff(lit, clay) > 10;
report.steps.unlitDiffers = diff(lit, unlit) > 6;
report.steps.litNotBlack = lit.lum > 35;

// LOD switching updates the triangle HUD without errors.
const hud = async () => (await page.evaluate(() => document.body.innerText)).match(/([\d,]+) tris · LOD(\d)/);
const lod0 = await hud();
await page.click("aside button:has-text('LOD2')");
await page.waitForTimeout(600);
const lod2 = await hud();
report.steps.lod = { lod0: lod0?.[0], lod2: lod2?.[0] };
report.steps.lodOk = Boolean(lod0 && lod2) && lod2[2] === "2" && Number(lod2[1].replace(/,/g, "")) < Number(lod0[1].replace(/,/g, ""));
await page.click("aside button:has-text('LOD0')");

// Switching assets must not recreate the WebGL context (same canvas element survives).
const canvasId = await page.evaluate(() => { const c = document.querySelector("canvas"); c.dataset.probe = "same"; return c.dataset.probe; });
await page.click("li button:has-text('Oil barrel')");
await page.waitForTimeout(800);
report.steps.canvasSurvivedAssetSwitch = (await page.evaluate(() => document.querySelector("canvas")?.dataset.probe)) === canvasId;

// The exported GLB must not double-apply colour or roughness and must tile both maps the same way.
await page.click("li button:has-text('Shipping crate')");
await page.waitForTimeout(500);
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("button:has-text('Download GLB')")]);
const glbPath = await download.path();
const buf = readFileSync(glbPath);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const mats = gltf.materials ?? [];
const factors = mats.map((m) => ({
  name: m.name,
  baseColorFactor: m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
  hasBaseTex: Boolean(m.pbrMetallicRoughness?.baseColorTexture),
  roughnessFactor: m.pbrMetallicRoughness?.roughnessFactor ?? 1,
  hasMRTex: Boolean(m.pbrMetallicRoughness?.metallicRoughnessTexture),
  baseScale: m.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform?.scale,
  mrScale: m.pbrMetallicRoughness?.metallicRoughnessTexture?.extensions?.KHR_texture_transform?.scale,
}));
report.steps.glb = { file: download.suggestedFilename(), bytes: buf.length, materials: factors };
report.steps.glbOk = factors.length > 0 && factors.every((f) =>
  (!f.hasBaseTex || f.baseColorFactor.slice(0, 3).every((v) => v > 0.999)) &&
  (!f.hasMRTex || f.roughnessFactor > 0.999) &&
  (!f.hasBaseTex || !f.hasMRTex || JSON.stringify(f.baseScale) === JSON.stringify(f.mrScale)));

report.consoleIssues = consoleIssues;
report.pageErrors = pageErrors;
report.noSoftShadowWarning = !consoleIssues.some((c) => c.includes("PCFSoftShadowMap"));
const s = report.steps;
report.ok = s.litRestoresAfterClay && s.litRestoresAfterWire && s.litRestoresAfterUnlit && s.clayDiffers && s.unlitDiffers && s.litNotBlack && s.lodOk && s.canvasSurvivedAssetSwitch && s.glbOk && pageErrors.length === 0 && report.noSoftShadowWarning;
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
