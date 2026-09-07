import { blenderScript, bakeScript } from "@/lib/assets/blender-script";
import { CATALOG } from "@/lib/assets/catalog";
import { LOD_SCREEN, engineNotes, pipelineFor, qcFor } from "@/lib/assets/pipeline";
import { specFromBrief } from "@/lib/assets/spec";
import { DEFAULT_ENGINE, KINDS, type AssetKind, type Engine } from "@/lib/assets/types";
import { collisionName, folderHint, meshName, textureSet } from "@/lib/assets/naming";
import type { McpPrompt, McpResource, McpTool } from "./protocol";
import { readForgeJob } from "@/lib/jobs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const TOOLS: McpTool[] = [
  {
    name: "forge_create_asset",
    description:
      "Create a production game-asset spec from a natural-language brief. Returns naming, PBR, LOD, collision, engine export notes, and a complete Blender Python script. Use this first.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "What to build, including style, scale, and engine if known." },
        engine: {
          type: "string",
          enum: ["godot", "unreal", "unity", "blender"],
          description: "Target engine. Default godot.",
        },
        kind: {
          type: "string",
          enum: [...KINDS],
          description: "Optional forced prototype (crate, rifle, wall, …).",
        },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_blender_script",
    description:
      "Generate a Blender 4.2+ Python script that builds the asset at real-world scale, bevels, UVs, names LODs, and sets up collision. Paste into Blender's Scripting workspace, or pass it as `code` to blender_run_python on the local anvil-blender server.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
        kind: { type: "string", enum: [...KINDS] },
      },
      required: ["brief"],
    },
  },
  {
    name: "blender_execute",
    description:
      "Deprecated and never executes anything: this HTTP server has no access to your machine. Use forge_blender_script (or the blenderScript field of forge_create_asset) and pass that Python as `code` to blender_run_python on the local anvil-blender stdio server.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python executed inside Blender (bpy)." },
        brief: { type: "string", description: "If code is omitted, build from this brief." },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
      },
    },
  },
  {
    name: "forge_pbr_set",
    description: "Produce a production PBR texture set plan: albedo, normal, ORM/Mask packing, color space, and texel density.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
        kind: { type: "string", enum: [...KINDS] },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_lod_plan",
    description: "LOD triangle budgets, reduction order, and screen-size hints for Unreal/Unity/Godot.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
        kind: { type: "string", enum: [...KINDS] },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_bake_plan",
    description: "Cage bake plan plus a Blender Cycles bake script (normal + AO → ORM).",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
        kind: { type: "string", enum: [...KINDS] },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_engine_export",
    description: "Engine-specific import checklist: Unreal, Unity, or Godot. Folders, prefixes, collision, lightmaps.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
        kind: { type: "string", enum: [...KINDS] },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_kit_module",
    description:
      "Plan a modular kitbash set (walls, floors, trims, corners) with grid size, texel lock, and naming so pieces snap.",
    inputSchema: {
      type: "object",
      properties: {
        theme: { type: "string", description: "e.g. dungeon stone, sci-fi corridor, wooden interior" },
        grid: { type: "number", description: "Grid size in meters. Default 2." },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
      },
      required: ["theme"],
    },
  },
  {
    name: "forge_pipeline",
    description: "Full production pipeline from brief to shipped mesh: stages, QC, and what Claude should do in Blender at each step.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_qc_checklist",
    description: "Gate the asset against production QC: scale, pivot, tris, texel, UV, naming, collision, PBR ranges.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string" },
        engine: { type: "string", enum: ["godot", "unreal", "unity", "blender"] },
        kind: { type: "string", enum: [...KINDS] },
      },
      required: ["brief"],
    },
  },
  {
    name: "forge_list_prototypes",
    description: "List Anvil's built-in production prototypes Claude can instantiate immediately.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "forge_run_asset",
    description:
      "Enqueue / run a forge asset job against an existing exports GLB (Phase 1 scaffold). Walks stages queued to published; Blender build/bake simulated when blender binary is missing. Prefer jobs over pasting scripts once reliable.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to an existing .glb under exports/ (alias: mesh)." },
        mesh: { type: "string", description: "Alias for file — path or mesh name under exports/forge." },
      },
    },
  },
  {
    name: "forge_scene",
    description:
      "Enqueue a Phase 4 scene compose job from a SceneSpec object or a brief. Scaffold writes exports/scenes/<id>/scene.tscn + report.json (placeholders; no GLBs invented). Poll with forge_job_status.",
    inputSchema: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description: "Natural-language scene brief. If sceneSpec is omitted, uses the jungle-clearing example fixture.",
        },
        sceneSpec: {
          type: "object",
          description: "Full SceneSpec (schemaVersion 1) object. Preferred when the agent has structured input.",
        },
        specPath: {
          type: "string",
          description: "Optional path to a SceneSpec JSON file under the project root.",
        },
      },
    },
  },

  {
    name: "forge_validate",
    description:
      "Run godot_prod artifact gates on a GLB path or folder (fail closed). Prefer this over forge_qc_checklist for forged files. Optional out path writes a ValidationReport JSON.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "GLB file or directory under the project (alias: file)." },
        file: { type: "string", description: "Alias for path." },
        profile: { type: "string", description: "Validation profile. Default godot_prod." },
        out: { type: "string", description: "Optional path to write ValidationReport JSON." },
      },
    },
  },
  {
    name: "forge_job_status",
    description:
      "Poll a forge job by id. Returns status stages, paths, validation summary, and errors from the local job store.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job id returned by forge_run_asset or forge_scene." },
        id: { type: "string", description: "Alias for jobId." },
      },
    },
  },
];

export const RESOURCES: McpResource[] = [
  {
    uri: "anvil://pipeline/unreal",
    name: "Unreal production pipeline",
    description: "UE5 naming, Nanite vs LOD, UCX collision, ORM packing, lightmaps.",
    mimeType: "text/markdown",
  },
  {
    uri: "anvil://pipeline/unity",
    name: "Unity production pipeline",
    description: "URP/HDRP maps, LOD Group, FBX scale, convex colliders.",
    mimeType: "text/markdown",
  },
  {
    uri: "anvil://pipeline/godot",
    name: "Godot production pipeline",
    description: "glTF import, StandardMaterial3D, ORM, collision shapes.",
    mimeType: "text/markdown",
  },
  {
    uri: "anvil://conventions/naming",
    name: "Naming conventions",
    description: "SM_/T_/MI_/UCX_ and Unity/Godot equivalents.",
    mimeType: "text/markdown",
  },
  {
    uri: "anvil://blender/addon",
    name: "Blender add-on install",
    description: "How to install the Anvil TCP add-on and pair it with Claude Code.",
    mimeType: "text/markdown",
  },

  {
    uri: "anvil://guide/agent",
    name: "Agent guide",
    description: "How Claude Code/Cowork should Plan vs Run Anvil: tools, Godot gates, scene = kits.",
    mimeType: "text/markdown",
  },
  {
    uri: "anvil://schemas/weapon-graph",
    name: "WeaponGraph schema",
    description: "JSON Schema for modular M4-class WeaponGraph (Phase 2).",
    mimeType: "application/schema+json",
  },
  {
    uri: "anvil://schemas/scene-spec",
    name: "SceneSpec schema",
    description: "JSON Schema for SceneSpec composition (Phase 4). Kits only — no mega-mesh.",
    mimeType: "application/schema+json",
  },
];

export const PROMPTS: McpPrompt[] = [
  {
    name: "hero_weapon",
    description: "Produce a hero weapon ready for first-person view.",
    arguments: [
      { name: "weapon", description: "sword, rifle, pistol, shotgun, dagger", required: true },
      { name: "engine", description: "unreal | unity | godot", required: false },
    ],
  },
  {
    name: "modular_kit",
    description: "Author a snapping architecture kit.",
    arguments: [
      { name: "theme", description: "dungeon, sci-fi corridor, timber house…", required: true },
      { name: "engine", description: "unreal | unity | godot", required: false },
    ],
  },
  {
    name: "prop_pack",
    description: "A readable set of 5–8 matching props for a space.",
    arguments: [
      { name: "space", description: "warehouse, tavern, spaceship bay…", required: true },
      { name: "engine", description: "unreal | unity | godot", required: false },
    ],
  },
];

/** Thrown for arguments that violate a tool's schema; the handler turns it into JSON-RPC -32602. */
export class InvalidParams extends Error {}

const MAX_BRIEF_CHARS = 4000;

function asEngine(value: unknown): Engine {
  if (value === "unity" || value === "godot" || value === "blender" || value === "unreal") return value;
  throw new InvalidParams(`engine must be one of unreal, unity, godot, blender; got ${JSON.stringify(value)}`);
}

/** An explicit engine argument is authoritative; when it is absent the brief may name one. */
function explicitEngine(value: unknown): Engine | undefined {
  return value === undefined || value === null || value === "" ? undefined : asEngine(value);
}

function asKind(value: unknown): AssetKind | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && (KINDS as readonly string[]).includes(value)) return value as AssetKind;
  throw new InvalidParams(`kind must be one of ${KINDS.join(", ")}; got ${JSON.stringify(value)}`);
}

function requiredText(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || !value.trim()) throw new InvalidParams(`${field} is required and must be a non-empty string`);
  if (value.length > MAX_BRIEF_CHARS) throw new InvalidParams(`${field} must be at most ${MAX_BRIEF_CHARS} characters`);
  return value;
}

function optionalText(args: Record<string, unknown>, field: string, fallback: string): string {
  const value = args[field];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new InvalidParams(`${field} must be a string`);
  if (value.length > MAX_BRIEF_CHARS) throw new InvalidParams(`${field} must be at most ${MAX_BRIEF_CHARS} characters`);
  return value;
}

function specOf(args: Record<string, unknown>) {
  const brief = requiredText(args, "brief");
  const kind = asKind(args.kind);
  return specFromBrief(brief, explicitEngine(args.engine), kind);
}

function findAnvilRoot(): string {
  const cwd = process.cwd();
  if (
    existsSync(resolve(cwd, "tools/forge-run/run-asset.mjs")) ||
    existsSync(resolve(cwd, "tools/scene-compose/compose.mjs"))
  ) {
    return cwd;
  }
  return cwd;
}

function text(value: string) {
  return { content: [{ type: "text", text: value }] };
}

export function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "forge_create_asset": {
      const spec = specOf(args);
      const payload = {
        spec,
        mesh: meshName(spec),
        folder: folderHint(spec),
        textures: textureSet(spec),
        collision: collisionName(spec),
        pipeline: pipelineFor(spec),
        qc: qcFor(spec),
        engineNotes: engineNotes(spec),
        blenderScript: blenderScript(spec),
      };
      return text(JSON.stringify(payload, null, 2));
    }
    case "forge_blender_script": {
      const spec = specOf(args);
      return text(blenderScript(spec));
    }
    case "blender_execute": {
      return {
        content: [
          {
            type: "text",
            text:
              "Anvil's HTTP server cannot execute Python. Generate the script with forge_blender_script (or take blenderScript from forge_create_asset) and pass it as `code` to blender_run_python on the local anvil-blender server, which needs the Blender add-on connected on 127.0.0.1:9876. See anvil://blender/addon.",
          },
        ],
        isError: true,
      };
    }
    case "forge_pbr_set": {
      const spec = specOf(args);
      const tex = textureSet(spec);
      return text(
        JSON.stringify(
          {
            mesh: meshName(spec),
            texelDensity: spec.texelDensity,
            materials: spec.materials,
            textures: tex,
            colorSpace: {
              albedo: "sRGB",
              normal:
                spec.engine === "unreal"
                  ? "Linear, DirectX (-Y): flip the green channel of a Blender (OpenGL) bake, no sRGB"
                  : "Linear, OpenGL (+Y) as Blender bakes it, no sRGB",
              orm: "Linear, no sRGB",
            },
            rules: [
              "Albedo 30–240 sRGB. No baked lighting or AO in albedo.",
              "Metals: albedo is F0 (steel ~180, gold not used here), roughness 0.2–0.5.",
              "Dielectrics: metalness 0. Specular 0.5 unless fabric/skin.",
              spec.engine === "unreal"
                ? "Normal: Unreal expects DirectX (-Y); Blender bakes OpenGL (+Y), so flip green on import."
                : "Normal: OpenGL (+Y), which is what Blender bakes; no flip.",
              `Padding 4 px at 2k. Target ${spec.texelDensity} px/m.`,
            ],
          },
          null,
          2,
        ),
      );
    }
    case "forge_lod_plan": {
      const spec = specOf(args);
      return text(
        JSON.stringify(
          {
            mesh: meshName(spec),
            budgets: spec.triangleBudget,
            reduce: [
              "LOD1: drop bolts, panel insets, bevel segments 2→1.",
              "LOD2: hull only, 6–12 sided cylinders, no interiors.",
            ],
            screensize: { ...LOD_SCREEN },
            nanite: spec.category === "architecture" ? "Eligible if unique enough. Not for weapons." : "Keep traditional LODs.",
          },
          null,
          2,
        ),
      );
    }
    case "forge_bake_plan": {
      const spec = specOf(args);
      return text(
        JSON.stringify(
          {
            cage: "0.5–1.5 cm offset. Explode intersecting cages.",
            maps: ["normal", "ao", "curvature", "position"],
            pack: "R=AO, G=Roughness, B=Metallic (ORM) unless Unity HDRP Mask.",
            blender: bakeScript(spec),
          },
          null,
          2,
        ),
      );
    }
    case "forge_engine_export": {
      const spec = specOf(args);
      return text(
        JSON.stringify(
          {
            engine: spec.engine,
            mesh: meshName(spec),
            folder: folderHint(spec),
            collision: collisionName(spec),
            notes: engineNotes(spec),
            gltf: {
              format: "GLB",
              yUp: true,
              applyModifiers: true,
              selected: true,
              punctualLights: false,
            },
          },
          null,
          2,
        ),
      );
    }
    case "forge_kit_module": {
      const theme = requiredText(args, "theme");
      if (args.grid !== undefined && (typeof args.grid !== "number" || !Number.isFinite(args.grid) || args.grid <= 0)) {
        throw new InvalidParams(`grid must be a positive number of metres; got ${JSON.stringify(args.grid)}`);
      }
      const grid = typeof args.grid === "number" ? Math.min(10, Math.max(0.25, args.grid)) : 2;
      const engine = explicitEngine(args.engine) ?? DEFAULT_ENGINE;
      const wall = specFromBrief(`${theme} modular wall, ${grid} m grid`, engine, "wall");
      wall.name = `${theme} wall`;
      wall.dimensions = { x: grid, y: 3, z: 0.3 };
      return text(
        JSON.stringify(
          {
            theme,
            gridMeters: grid,
            snap: `All pieces occupy ${grid} m XY. Pivot at module corner (0,0,0).`,
            set: [
              "Wall_Plain",
              "Wall_Doorway",
              "Wall_Window",
              "Floor",
              "Ceiling",
              "Corner_Inner",
              "Corner_Outer",
              "Trim_Base",
              "Trim_Crown",
              "Pillar",
              "Stairs",
            ].map((name) => ({ name: `${theme.replace(/\s+/g, "_")}_${name}`, grid })),
            texelLock: "Lock texel across the kit. One trim sheet + one unique atlas.",
            wallScript: blenderScript(wall),
          },
          null,
          2,
        ),
      );
    }
    case "forge_pipeline": {
      const spec = specOf(args);
      return text(
        JSON.stringify(
          {
            spec,
            stages: pipelineFor(spec),
            qc: qcFor(spec),
            claudeSteps: [
              "1. forge_create_asset with the brief.",
              "2. Open Blender, enable Anvil add-on, Connect.",
              "3. Pass blenderScript as `code` to blender_run_python on the local anvil-blender server.",
              "4. Retopo / bevel / weighted normals as the QC demands.",
              "5. forge_bake_plan then bake.",
              "6. forge_engine_export and save GLB next to textures.",
            ],
          },
          null,
          2,
        ),
      );
    }
    case "forge_qc_checklist": {
      const spec = specOf(args);
      const qc = qcFor(spec);
      return text(
        JSON.stringify(
          {
            mesh: meshName(spec),
            passed: qc.filter((item) => item.kind === "check").every((item) => item.ok),
            qc,
          },
          null,
          2,
        ),
      );
    }
    case "forge_job_status": {
      const jobIdRaw = args.jobId ?? args.id;
      if (typeof jobIdRaw !== "string" || !jobIdRaw.trim()) {
        throw new InvalidParams("jobId is required and must be a non-empty string");
      }
      const jobId = jobIdRaw.trim();
      const root = findAnvilRoot();
      const job = readForgeJob(jobId, root);
      if (!job) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: `job not found: ${jobId}` }, null, 2),
            },
          ],
          isError: true,
        };
      }
      return text(JSON.stringify({ ok: true, job }, null, 2));
    }
    case "forge_scene": {
      const brief = args.brief;
      const sceneSpec = args.sceneSpec;
      const specPath = args.specPath;
      if (
        (brief === undefined || brief === null || brief === "") &&
        (sceneSpec === undefined || sceneSpec === null) &&
        (specPath === undefined || specPath === null || specPath === "")
      ) {
        throw new InvalidParams("forge_scene requires brief, sceneSpec, or specPath");
      }
      if (brief !== undefined && brief !== null && typeof brief !== "string") {
        throw new InvalidParams("brief must be a string");
      }
      if (typeof brief === "string" && brief.length > MAX_BRIEF_CHARS) {
        throw new InvalidParams(`brief must be at most ${MAX_BRIEF_CHARS} characters`);
      }
      if (sceneSpec !== undefined && sceneSpec !== null && (typeof sceneSpec !== "object" || Array.isArray(sceneSpec))) {
        throw new InvalidParams("sceneSpec must be an object");
      }
      if (specPath !== undefined && specPath !== null && typeof specPath !== "string") {
        throw new InvalidParams("specPath must be a string");
      }
      const root = findAnvilRoot();
      const runner = resolve(root, "tools/scene-compose/run-scene.mjs");
      if (!existsSync(runner)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: "scene-compose runner missing", runner }, null, 2),
            },
          ],
          isError: true,
        };
      }
      const argv = [runner, "--json"];
      if (typeof sceneSpec === "object" && sceneSpec !== null) {
        argv.push("--scene-spec-json", JSON.stringify(sceneSpec));
      } else if (typeof specPath === "string" && specPath.trim()) {
        argv.push("--spec", specPath.trim());
      } else {
        argv.push("--brief", String(brief).trim());
      }
      const r = spawnSync(process.execPath, argv, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      const out = (r.stdout || "").trim() || (r.stderr || "").trim() || `exit ${r.status}`;
      let payload: unknown = out;
      try {
        payload = JSON.parse(out);
      } catch {
        // keep string
      }
      const failed = (r.status ?? 1) !== 0;
      return {
        content: [
          {
            type: "text",
            text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
          },
        ],
        ...(failed ? { isError: true } : {}),
      };
    }
    case "forge_run_asset": {
      const fileRaw = args.file ?? args.mesh;
      if (typeof fileRaw !== "string" || !fileRaw.trim()) {
        throw new InvalidParams("file or mesh is required (path to an existing exports .glb)");
      }
      const root = findAnvilRoot();
      const runner = resolve(root, "tools/forge-run/run-asset.mjs");
      if (!existsSync(runner)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: "forge-run runner missing", runner }, null, 2),
            },
          ],
          isError: true,
        };
      }
      const r = spawnSync(process.execPath, [runner, "--file", fileRaw.trim(), "--json"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      const out = (r.stdout || "").trim() || (r.stderr || "").trim() || `exit ${r.status}`;
      let payload: unknown = out;
      try {
        payload = JSON.parse(out);
      } catch {
        // keep string
      }
      const failed = (r.status ?? 1) !== 0;
      return {
        content: [
          {
            type: "text",
            text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
          },
        ],
        ...(failed ? { isError: true } : {}),
      };
    }

    case "forge_validate": {
      const pathRaw = args.path ?? args.file;
      if (typeof pathRaw !== "string" || !pathRaw.trim()) {
        throw new InvalidParams("path or file is required");
      }
      const root = findAnvilRoot();
      const runner = resolve(root, "tools/validate/run.mjs");
      if (!existsSync(runner)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: "validate runner missing", runner }, null, 2),
            },
          ],
          isError: true,
        };
      }
      const profile = typeof args.profile === "string" && args.profile.trim() ? args.profile.trim() : "godot_prod";
      const argv = [runner, pathRaw.trim(), "--profile", profile, "--json"];
      if (typeof args.out === "string" && args.out.trim()) {
        argv.push("--out", args.out.trim());
      }
      const r = spawnSync(process.execPath, argv, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      const out = (r.stdout || "").trim() || (r.stderr || "").trim() || `exit ${r.status}`;
      let payload: unknown = out;
      try {
        payload = JSON.parse(out);
      } catch {
        // keep string
      }
      const failed = (r.status ?? 1) !== 0;
      return {
        content: [
          {
            type: "text",
            text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
          },
        ],
        ...(failed ? { isError: true } : {}),
      };
    }
    case "forge_list_prototypes":
      return text(
        JSON.stringify(
          CATALOG.map((item) => ({
            kind: item.kind,
            name: item.name,
            category: item.category,
            brief: item.brief,
            lod0: item.triangleBudget.lod0,
          })),
          null,
          2,
        ),
      );
    default:
      return null;
  }
}

export type ResourceBody = { text: string; mimeType: string };

function readProjectText(relPath: string): string | null {
  const root = findAnvilRoot();
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

export function resourceBody(uri: string): ResourceBody | null {
  if (uri === "anvil://pipeline/unreal") {
    return { mimeType: "text/markdown", text: `# Unreal 5 — Anvil\n\n- Prefixes: SM_ mesh, T_ textures, MI_ instances, UBX_/USP_/UCP_/UCX_ collision by shape.\n- ORM: R AO, G Roughness, B Metallic. sRGB off on N and ORM.\n- Nanite: architecture and unique hero props. Weapons and small props keep LODs.\n- Lightmap UV on UV1, 2 px pad. Generate if missing.\n- Collision: UBX_/USP_/UCP_/UCX_ prefixed meshes exported beside the render mesh (FBX, or glTF on UE 5.4+), or Auto Convex 8 hulls max.\n` };
  }
  if (uri === "anvil://pipeline/unity") {
    return { mimeType: "text/markdown", text: `# Unity — Anvil\n\n- Scale factor 1. Mesh compression Off for hero.\n- URP Lit or HDRP Lit. Normal OpenGL (flip G if it caves in).\n- HDRP Mask: R Metallic, G AO, B Detail, A Smoothness.\n- LOD Group 100 / 40 / 12, cull 4.\n- Convex MeshCollider on a child named COL_.\n` };
  }
  if (uri === "anvil://pipeline/godot") {
    return { mimeType: "text/markdown", text: `# Godot 4 — Anvil\n\n- Import GLB, ensure tangents.\n- StandardMaterial3D + ORM.\n- A node named <mesh>_col-convcolonly imports as a StaticBody3D named <mesh>_col with a convex CollisionShape3D.\n- VisibilityRange or importer LOD.\n` };
  }
  if (uri === "anvil://conventions/naming") {
    return { mimeType: "text/markdown", text: `# Naming\n\nUnreal: SM_Crate_01, T_Crate_01_D/N/ORM, MI_Crate_01, UBX_SM_Crate_01 (USP_/UCP_/UCX_ by shape)\nUnity: Crate_01, T_Crate_01_Albedo/Normal/Mask, M_Crate_01, COL_Crate_01\nGodot: crate_01.glb, tex_crate_01_albedo, mat_crate_01, crate_01_col-convcolonly\n` };
  }
  if (uri === "anvil://blender/addon") {
    return { mimeType: "text/markdown", text: `# Anvil Blender bridge\n\nTwo servers: this HTTP server generates scripts; the local "anvil-blender" stdio server executes them in Blender.\n\n1. Download anvil_blender_addon.zip and anvil-mcp-server.mjs from the app's Connect panel. Keep the .mjs somewhere permanent; it needs Node.js 18+.\n2. Blender 4.2+ → Edit → Preferences → Add-ons → Install from Disk → the zip → enable "Anvil: Game Asset MCP" → N-panel → Anvil → Connect. Nothing listens until Connect; it writes the token to ~/.anvil/token, which the local server reads (or set ANVIL_BLENDER_TOKEN). The zip carries the part kit and surfacing recipes that the generated build and bake scripts use when the add-on is installed (remove an older anvil_blender_addon.py first).\n3. claude mcp add anvil-blender -- node "<full path to>/anvil-mcp-server.mjs"\n4. In Claude Code: forge_create_asset, then pass its blenderScript as code to blender_run_python. blender_ping checks the connection.\n` };
  }
  if (uri === "anvil://guide/agent") {
    const text =
      readProjectText("docs/AGENT-GUIDE.md") ??
      "# Agent guide missing on disk. See docs/AGENT-GUIDE.md in the Anvil repo.";
    return { mimeType: "text/markdown", text };
  }
  if (uri === "anvil://schemas/weapon-graph") {
    const text = readProjectText("docs/schemas/weapon-graph.schema.json");
    if (!text) return null;
    return { mimeType: "application/schema+json", text };
  }
  if (uri === "anvil://schemas/scene-spec") {
    const text = readProjectText("docs/schemas/scene-spec.schema.json");
    if (!text) return null;
    return { mimeType: "application/schema+json", text };
  }
  return null;
}

export function promptBody(name: string, args: Record<string, unknown>) {
  const engine = explicitEngine(args.engine) ?? DEFAULT_ENGINE;
  if (name === "hero_weapon") {
    const weapon = requiredText(args, "weapon");
    return {
      description: "Hero weapon",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a production ${weapon} for ${engine}. Use forge_create_asset, then run its blenderScript with blender_run_python on the local anvil-blender server. First-person silhouette, 1024 px/m, 3 LODs, box collision on the receiver, pivot at the grip.`,
          },
        },
      ],
    };
  }
  if (name === "modular_kit") {
    const theme = requiredText(args, "theme");
    return {
      description: "Modular kit",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Author a ${theme} modular architecture kit for ${engine}. 2 m grid, locked texel, snapping pivots. Call forge_kit_module then generate wall, floor, corner, stairs.`,
          },
        },
      ],
    };
  }
  return {
    description: "Prop pack",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Build a matching prop pack for a ${optionalText(args, "space", "warehouse")} in ${engine}. 6 assets, shared trim sheet, consistent wear. Start with forge_list_prototypes then forge_create_asset for each.`,
        },
      },
    ],
  };
}
