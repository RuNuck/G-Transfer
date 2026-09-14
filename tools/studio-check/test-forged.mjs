// The viewport must show what Blender forged when a GLB for the asset exists, and fall back to the
// spec blockout when it does not. Also checks the /api/forged endpoint's listing, byte serving and
// its refusal to serve anything outside the exports folder.
import { chromium } from "file:///C:/Users/RuNuc/Desktop/Workspace/node_modules/playwright/index.mjs";

const BASE = process.argv[2] ?? "http://localhost:8080/";
const problems = [];
const expect = (ok, message) => { if (!ok) problems.push(message); };

// --- the endpoint -------------------------------------------------------------------------------
const listing = await (await fetch(new URL("/api/forged", BASE))).json();
expect(listing.available === true, "exports folder not found; forge something first");
expect(Array.isArray(listing.assets) && listing.assets.length > 0, "no forged assets listed");
const sample = listing.assets[0];
const glb = await fetch(new URL(`/api/forged?file=${encodeURIComponent(sample.file)}`, BASE));
expect(glb.status === 200, `serving ${sample.file}: HTTP ${glb.status}`);
expect(glb.headers.get("content-type") === "model/gltf-binary", `content type ${glb.headers.get("content-type")}`);
const bytes = new Uint8Array(await glb.arrayBuffer());
expect(bytes.length === sample.bytes, `served ${bytes.length} bytes, listed ${sample.bytes}`);
expect(new TextDecoder().decode(bytes.subarray(0, 4)) === "glTF", "served file is not a GLB");
for (const escape of ["../package.json", "forge/../../package.json", "/etc/passwd", "forge/x.glb/../../../package.json"]) {
  const res = await fetch(new URL(`/api/forged?file=${encodeURIComponent(escape)}`, BASE));
  expect(res.status === 404, `path escape "${escape}" returned ${res.status}`);
}
const nonGlb = await fetch(new URL("/api/forged?file=forge/textures", BASE));
expect(nonGlb.status === 404, `non-GLB path returned ${nonGlb.status}`);

// --- the viewport -------------------------------------------------------------------------------
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#anvil-forged-pick", { timeout: 30000 });

const source = () => page.evaluate(() => {
  const spans = [...document.querySelectorAll("div.pointer-events-none span")].map((s) => s.textContent.trim());
  return {
    label: spans.find((t) => t.includes("forged") || t.includes("blockout")) ?? null,
    tris: spans.find((t) => t.includes("tris")) ?? null,
    picked: document.querySelector("#anvil-forged-pick")?.value ?? null,
  };
});

// A prototype whose name no forged file matches must stay on the blockout.
const initial = await source();
expect(initial.label === "blockout preview", `fresh session shows "${initial.label}"`);

// Picking a forged file must switch the viewport to it and report a triangle count from the GLB.
const forgedFile = listing.assets.find((a) => a.file.startsWith("forge/")) ?? sample;
await page.selectOption("#anvil-forged-pick", forgedFile.file);
await page.waitForFunction(
  () => [...document.querySelectorAll("div.pointer-events-none span")].some((s) => s.textContent.trim().startsWith("forged in Blender")),
  { timeout: 60000 },
);
const picked = await source();
const tris = Number((picked.tris ?? "0").replace(/[^0-9]/g, "").slice(0, -1) || 0);
expect(picked.picked === forgedFile.file, `picker shows ${picked.picked}`);
expect(tris > 100, `forged preview reported ${picked.tris}`);

// The inspector's LOD row must count the forged file, not the blockout the spec would build, and a
// level the file does not carry (a Godot export has no LOD chain) must not borrow a blockout count.
// The label reads "forged" before the file has loaded, so wait until the file's counts have landed
// (the "triangles from" caption) and compare with the overlay at that moment. The middle dot, em dash
// and ellipsis are written as escapes so re-encoding this file cannot break the matches.
const lodButtons = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /^LOD[012] ·/.test(t)));
const overlayTris = () => page.evaluate(() => [...document.querySelectorAll("div.pointer-events-none span")].map((s) => s.textContent.trim()).find((t) => t.includes("tris")) ?? null);
const hasForgedCaption = () => [...document.querySelectorAll("p")].some((p) => p.textContent.trim().startsWith("triangles from "));
const inspectorCountsForged = await page
  .waitForFunction(() => {
    const caption = [...document.querySelectorAll("p")].some((p) => p.textContent.trim().startsWith("triangles from "));
    const overlay = ([...document.querySelectorAll("div.pointer-events-none span")].map((s) => s.textContent.trim()).find((t) => t.includes("tris")) ?? "").split(" tris")[0];
    const lod0 = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).find((t) => t.startsWith("LOD0 · ")) ?? "";
    return caption && overlay !== "" && overlay !== "0" && lod0.startsWith(`LOD0 · ${overlay} /`);
  }, null, { timeout: 30000 })
  .then(() => true, () => false);
expect(inspectorCountsForged, `inspector LOD row ${JSON.stringify(await lodButtons())} does not match the forged preview's ${await overlayTris()}`);
if (!forgedFile.mesh.startsWith("SM_")) {
  const [, lod1] = await lodButtons();
  expect(/^LOD1 · — \//.test(lod1 ?? ""), `LOD1 of ${forgedFile.mesh} (no LOD chain in the file) shows ${lod1}`);
}

// Back to the blockout on request.
await page.selectOption("#anvil-forged-pick", "");
await page.waitForFunction(
  () => [...document.querySelectorAll("div.pointer-events-none span")].some((s) => s.textContent.trim() === "blockout preview"),
  { timeout: 30000 },
);
// ...and the inspector goes back to the blockout's counts, which exist for every level.
const inspectorBackToBlockout = await page
  .waitForFunction(() => {
    const row = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => /^LOD[012] ·/.test(t));
    const caption = [...document.querySelectorAll("p")].some((p) => p.textContent.trim().startsWith("triangles from "));
    return !caption && row.length === 3 && row.every((t) => !t.includes("—") && !t.includes("…"));
  }, null, { timeout: 15000 })
  .then(() => true, () => false);
expect(inspectorBackToBlockout, `inspector kept forged counts on the blockout: ${JSON.stringify(await lodButtons())} caption=${await page.evaluate(hasForgedCaption)}`);

// A file that carries a LOD chain must switch meshes with the LOD buttons; one that does not
// (a Godot export, where the engine builds its own) must say so and keep showing LOD0.
const withLods = listing.assets.find((a) => a.mesh.startsWith("SM_"));
if (withLods) {
  await page.selectOption("#anvil-forged-pick", withLods.file);
  await page.waitForFunction(
    () => [...document.querySelectorAll("div.pointer-events-none span")].some((s) => s.textContent.trim().startsWith("forged in Blender")),
    { timeout: 60000 },
  );
  const read = async () => Number(((await source()).tris ?? "").replace(/[^0-9]/g, "").slice(0, -1) || 0);
  const at0 = await read();
  await page.click("button:has-text('LOD1')");
  await page.waitForTimeout(900);
  const at1 = await read();
  expect(at1 > 0 && at1 < at0, `LOD1 of ${withLods.mesh} reported ${at1} against LOD0 ${at0}`);
  await page.click("button:has-text('LOD0')");
  await page.waitForTimeout(500);
}

// Switching asset drops the manual pick.
await page.click("li button:has-text('Oil barrel')");
await page.waitForTimeout(600);
const afterSwitch = await source();
expect(afterSwitch.picked === "", `pick survived an asset change: ${afterSwitch.picked}`);
expect(pageErrors.length === 0, `page errors: ${JSON.stringify(pageErrors)}`);

console.log(JSON.stringify({ ok: problems.length === 0, listed: listing.assets.length, sample: sample.file, problems, pageErrors }, null, 2));
await browser.close();
process.exit(problems.length ? 1 : 0);
