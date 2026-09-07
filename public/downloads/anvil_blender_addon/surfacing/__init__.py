"""Anvil surfacing: mesh maps and material recipes baked into game textures.

Stage two of Anvil's pipeline. Stage one (the part kit or the blockout) makes clean geometry
with a material slot per role; this stage covers it. Given the low-poly game mesh and a denser
high-poly copy it

1. bakes mesh maps from the high-poly onto the low-poly UVs: ambient occlusion and an edge map
   (R: edges from a bevel-node probe, G: convexity, B: concavity, both from pointiness);
2. builds one procedural recipe material per slot (painted, blued or bare steel, polymer,
   rubber, wood, brass, leather, fabric, stone, moss, glass or generic) driven by those maps, 3D noise
   in object space (so nothing shows a UV seam) and the surface orientation (dust settles on
   top), with wear on exposed edges and grime in cavities;
3. bakes the recipes to albedo, roughness, metallic and a tangent normal (high-poly geometry
   plus the recipe's micro bump), packs the engine's mask texture (ORM, or Unity's Mask) and
   writes PNGs;
4. rewires the mesh's materials to the baked textures so a GLB export carries them, and keeps
   each recipe as <material>_recipe for editing and re-baking.

Entry point (the generated bake script calls this when the add-on is installed):

    from anvil_blender_addon.surfacing import surface
    out = surface(low, high, slots=[{"name": "MI_Receiver", "recipe": "auto", "color": "#3d4046",
                  "roughness": 0.4, "metallic": 0.78}, ...], size=2048, samples=16,
                  out_dir=folder, names={"albedo": ..., "normal": ..., "packed": ...},
                  engine="unreal", wear=0.45, dirt=0.35, seed=7)

Everything bakes with Cycles on whatever device the scene uses; nothing leaves the machine.
"""
import math
import os
import time

import bpy
import numpy as np
from mathutils import Vector

RECIPES = ("painted_steel", "blued_steel", "bare_steel", "polymer", "rubber", "wood", "brass", "leather", "fabric", "stone", "moss", "glass", "generic")

# first match on the lower-cased material name wins
KEYWORDS = (
    ("glass", ("glass", "lens", "crystal", "window")),
    ("rubber", ("rubber",)),
    ("polymer", ("polymer", "plastic", "nylon", "grip", "furniture", "composite", "resin")),
    ("wood", ("wood", "oak", "walnut", "timber", "plank", "birch", "pine")),
    ("brass", ("brass", "copper", "bronze", "gold", "gilt")),
    ("leather", ("leather", "hide", "strap")),
    ("fabric", ("fabric", "cloth", "canvas", "linen", "wool", "cotton", "textile", "webbing")),
    ("moss", ("moss", "lichen", "grass", "vegetation", "foliage", "algae", "ivy", "overgrowth")),
    ("stone", ("stone", "rock", "concrete", "marble", "granite", "brick", "plaster")),
    ("painted_steel", ("paint", "coated", "enamel", "hull", "panel", "plating", "armor", "armour", "chassis")),
    ("blued_steel", ("blued", "receiver", "barrel", "gunmetal", "iron", "blade")),
    ("bare_steel", ("steel", "chrome", "silver", "aluminum", "aluminium", "metal", "titanium")),
)

BAKE_KEYS = ("use_selected_to_active", "cage_extrusion", "max_ray_distance", "margin", "normal_space", "use_clear", "use_cage", "target")


# --- colour helpers -------------------------------------------------------------------------------

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear(color):
    """Hex string (sRGB) or an RGB/RGBA tuple that is already linear -> linear RGBA tuple."""
    if isinstance(color, str):
        h = color.lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
        return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)
    color = tuple(float(c) for c in color)
    return color if len(color) == 4 else (color[0], color[1], color[2], 1.0)


def luminance(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def lighten(rgb, t):
    return tuple(rgb[i] + (1.0 - rgb[i]) * t for i in range(3)) + (1.0,)


def darken(rgb, f):
    return (rgb[0] * f, rgb[1] * f, rgb[2] * f, 1.0)


def tint(rgb, other, t):
    return tuple(rgb[i] + (other[i] - rgb[i]) * t for i in range(3)) + (1.0,)


STEEL = linear("#9a9da1")   # bare metal under chipped paint or rubbed-off bluing
GRIME = linear("#3a352e")   # cavity dirt; deliberately not black, so deep crevices read as dirt rather than holes
OIL = linear("#16151a")     # dark grime on metal
DUST = linear("#8d8779")    # settled dust on upward faces


def recipe_for(name, rgb, metallic):
    """Recipe from the material name, else from metalness and brightness."""
    lowered = (name or "").lower()
    for recipe, words in KEYWORDS:
        if any(word in lowered for word in words):
            return recipe
    if metallic >= 0.5:
        return "blued_steel" if luminance(rgb) < 0.12 else "bare_steel"
    return "generic"


# --- node graph helper ----------------------------------------------------------------------------

def _sock(sockets, identifier):
    for sock in sockets:
        if sock.identifier == identifier:
            return sock
    return sockets[identifier]


class Graph:
    """Builds shader node trees: every method returns an output socket and accepts sockets or
    constants for its inputs, so a recipe reads like arithmetic."""

    def __init__(self, tree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self.count = 0

    def new(self, kind, **props):
        node = self.nodes.new(kind)
        for key, value in props.items():
            setattr(node, key, value)
        node.location = ((self.count % 10) * 240, -(self.count // 10) * 300)
        self.count += 1
        return node

    def feed(self, socket, value):
        """Link `socket` from another socket, or set its default value from a constant."""
        if value is None:
            return
        if isinstance(value, bpy.types.NodeSocket):
            self.links.new(value, socket)
            return
        if socket.type == "RGBA":
            if isinstance(value, (int, float)):
                value = (value, value, value, 1.0)
            elif len(value) == 3:
                value = (value[0], value[1], value[2], 1.0)
        elif socket.type == "VECTOR" and isinstance(value, (int, float)):
            value = (value, value, value)
        socket.default_value = value

    def math(self, op, a, b=None, c=None, clamp=False):
        node = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.feed(node.inputs[0], a)
        if b is not None:
            self.feed(node.inputs[1], b)
        if c is not None:
            self.feed(node.inputs[2], c)
        return node.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b)

    def sub(self, a, b):
        return self.math("SUBTRACT", a, b)

    def mul(self, a, b):
        return self.math("MULTIPLY", a, b)

    def mad(self, a, b, c):
        """a * b + c"""
        return self.math("MULTIPLY_ADD", a, b, c)

    def maxi(self, a, b):
        return self.math("MAXIMUM", a, b)

    def vec(self, op, a, b=None):
        node = self.new("ShaderNodeVectorMath", operation=op)
        self.feed(node.inputs[0], a)
        if b is not None:
            self.feed(node.inputs[1], b)
        return node.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else node.outputs["Vector"]

    def scale_vec(self, v, factors):
        return self.vec("MULTIPLY", v, factors)

    def smooth(self, value, lo, hi, to_lo=0.0, to_hi=1.0):
        """Smoothstep remap of a float, clamped."""
        node = self.new("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.feed(_sock(node.inputs, "Value"), value)
        self.feed(_sock(node.inputs, "From Min"), lo)
        self.feed(_sock(node.inputs, "From Max"), hi)
        self.feed(_sock(node.inputs, "To Min"), to_lo)
        self.feed(_sock(node.inputs, "To Max"), to_hi)
        return _sock(node.outputs, "Result")

    def mix(self, fac, a, b, color=True):
        node = self.new("ShaderNodeMix", data_type="RGBA" if color else "FLOAT", clamp_factor=True)
        self.feed(_sock(node.inputs, "Factor_Float"), fac)
        self.feed(_sock(node.inputs, "A_Color" if color else "A_Float"), a)
        self.feed(_sock(node.inputs, "B_Color" if color else "B_Float"), b)
        return _sock(node.outputs, "Result_Color" if color else "Result_Float")

    def noise(self, vector, scale, detail=4.0, roughness=0.5, distortion=0.0):
        node = self.new("ShaderNodeTexNoise")
        self.feed(node.inputs["Vector"], vector)
        self.feed(node.inputs["Scale"], scale)
        self.feed(node.inputs["Detail"], detail)
        self.feed(node.inputs["Roughness"], roughness)
        self.feed(node.inputs["Distortion"], distortion)
        return node.outputs[0]

    def voronoi(self, vector, scale, feature="F1"):
        node = self.new("ShaderNodeTexVoronoi", feature=feature)
        self.feed(node.inputs["Vector"], vector)
        self.feed(node.inputs["Scale"], scale)
        return node.outputs["Distance"]

    def wave(self, vector, scale, direction="X", distortion=0.0, detail=2.0, wave_type="BANDS"):
        node = self.new("ShaderNodeTexWave", wave_type=wave_type, bands_direction=direction)
        self.feed(node.inputs["Vector"], vector)
        self.feed(node.inputs["Scale"], scale)
        self.feed(node.inputs["Distortion"], distortion)
        self.feed(node.inputs["Detail"], detail)
        return node.outputs[1]

    def image(self, img, vector=None, interpolation="Linear"):
        node = self.new("ShaderNodeTexImage", interpolation=interpolation)
        node.image = img
        if vector is not None:
            self.feed(node.inputs["Vector"], vector)
        return node

    def separate(self, color):
        node = self.new("ShaderNodeSeparateColor", mode="RGB")
        self.feed(node.inputs["Color"], color)
        return node.outputs["Red"], node.outputs["Green"], node.outputs["Blue"]

    def combine(self, r, g, b):
        node = self.new("ShaderNodeCombineColor", mode="RGB")
        self.feed(node.inputs["Red"], r)
        self.feed(node.inputs["Green"], g)
        self.feed(node.inputs["Blue"], b)
        return node.outputs["Color"]

    def sep_xyz(self, vector):
        node = self.new("ShaderNodeSeparateXYZ")
        self.feed(node.inputs["Vector"], vector)
        return node.outputs["X"], node.outputs["Y"], node.outputs["Z"]

    def bump(self, height, distance, strength=1.0):
        node = self.new("ShaderNodeBump")
        self.feed(node.inputs["Height"], height)
        self.feed(node.inputs["Distance"], distance)
        self.feed(node.inputs["Strength"], strength)
        return node.outputs["Normal"]


# --- masks shared by every recipe -----------------------------------------------------------------

def build_masks(G, m, ao_img, edge_img, seed):
    """Sockets every recipe reads: mesh maps, noises in object space, orientation, wear and dirt."""
    tc = G.new("ShaderNodeTexCoord")
    uv = tc.outputs["UV"]
    p = G.vec("ADD", tc.outputs["Object"], ((seed * 0.618) % 7.0, (seed * 0.382) % 7.0, (seed * 0.236) % 7.0))
    ao = G.separate(G.image(ao_img, uv).outputs["Color"])[0]
    er, eg, eb = G.separate(G.image(edge_img, uv).outputs["Color"])
    edge = G.maxi(er, G.mul(eg, 0.8))
    cavity = G.maxi(G.sub(1.0, ao), G.mul(eb, 0.6))
    grunge = G.mix(0.5, G.noise(p, 6.0, detail=5.0, roughness=0.6), G.noise(p, 28.0, detail=4.0, roughness=0.55), color=False)
    fine = G.noise(p, 320.0, detail=3.0, roughness=0.5)
    streak = G.noise(G.scale_vec(p, (0.05, 1.0, 1.0)), 220.0, detail=2.0, roughness=0.45)  # brushed along X
    geo = G.new("ShaderNodeNewGeometry")
    top = G.smooth(G.sep_xyz(geo.outputs["Normal"])[2], 0.35, 0.95)
    w, d = m["wear"], m["dirt"]
    wear = G.smooth(G.mul(edge, G.mad(grunge, 0.9, 0.55)), 0.8 - 0.65 * w, 1.05 - 0.65 * w)
    scratch = G.smooth(G.noise(G.scale_vec(p, (1.0, 30.0, 30.0)), 45.0, detail=2.0), 0.64, 0.72, 0.0, 0.7 * w)
    wear = G.maxi(wear, scratch)
    dirt = G.smooth(G.mul(cavity, G.mad(grunge, 0.8, 0.6)), 0.7 - 0.6 * d, 1.1 - 0.6 * d)
    dust = G.mul(G.mul(top, G.smooth(grunge, 0.3, 0.8)), d)
    return dict(uv=uv, obj=p, ao=ao, edge=edge, cavity=cavity, grunge=grunge, fine=fine, streak=streak, top=top, wear=wear, dirt=dirt, dust=dust)


# --- recipes: each returns colour, roughness, metallic sockets (or constants) and a bump height ----

def _painted_steel(G, m, M):
    c = m["rgb"]
    base = G.mix(G.mul(M["fine"], 0.25), c, darken(c, 0.72))
    base = G.mix(G.mul(M["grunge"], 0.18), base, lighten(c, 0.12))
    color = G.mix(M["wear"], base, STEEL)
    color = G.mix(G.mul(M["dirt"], 0.75), color, GRIME)
    color = G.mix(G.mul(M["dust"], 0.4), color, DUST)
    rough = G.mad(M["fine"], 0.18, m["roughness"] - 0.09)
    rough = G.mix(M["wear"], rough, 0.35, color=False)
    rough = G.mix(M["dirt"], rough, 0.9, color=False)
    rough = G.mix(G.mul(M["dust"], 0.6), rough, 0.95, color=False)
    # Wear chips expose metal (AA fringe ok); base paint is dielectric 0 — no mid plateaus.
    metal = G.mix(M["wear"], 0.0, 1.0, color=False)
    height = G.sub(G.mul(M["fine"], 0.35), G.mul(M["wear"], 0.9))  # chips sit below the paint
    return dict(color=color, rough=rough, metal=metal, height=height, distance=0.0005)


def _blued_steel(G, m, M):
    c = m["rgb"]
    base = G.mix(G.mul(M["fine"], 0.2), c, darken(c, 0.7))
    base = G.mix(G.mul(M["streak"], 0.3), base, lighten(c, 0.15))
    color = G.mix(M["wear"], base, STEEL)
    color = G.mix(G.mul(M["dirt"], 0.6), color, OIL)
    rough = G.mad(M["streak"], 0.2, m["roughness"] - 0.1)
    rough = G.mad(M["fine"], 0.06, rough)
    rough = G.mix(M["wear"], rough, 0.28, color=False)
    rough = G.mix(M["dirt"], rough, 0.7, color=False)
    metal = 1.0  # binary metal; dirt/wear stay on albedo+roughness
    height = G.mad(M["streak"], 0.3, G.mul(M["fine"], 0.15))
    return dict(color=color, rough=rough, metal=metal, height=height, distance=0.00015)


def _bare_steel(G, m, M):
    c = m["rgb"]
    base = G.mix(G.mul(M["streak"], 0.35), lighten(c, 0.05), darken(c, 0.72))
    base = G.mix(G.mul(M["grunge"], 0.2), base, darken(c, 0.85))
    color = G.mix(M["wear"], base, lighten(c, 0.3))  # polished highlights
    color = G.mix(G.mul(M["dirt"], 0.7), color, OIL)
    rough = G.mad(M["streak"], 0.25, m["roughness"] - 0.1)
    rough = G.mix(M["wear"], rough, 0.2, color=False)
    rough = G.mix(M["dirt"], rough, 0.75, color=False)
    metal = 1.0  # binary metal; dirt/wear stay on albedo+roughness
    height = G.mad(M["streak"], 0.4, G.mul(M["fine"], 0.2))
    return dict(color=color, rough=rough, metal=metal, height=height, distance=0.0002)


def _polymer(G, m, M):
    c = m["rgb"]
    grain = G.smooth(G.voronoi(M["obj"], 900.0), 0.0, 0.7)
    base = G.mix(G.mul(M["fine"], 0.2), c, darken(c, 0.78))
    color = G.mix(G.mul(M["wear"], 0.55), base, lighten(c, 0.3))  # polymer scuffs stay subtle
    color = G.mix(G.mul(M["dirt"], 0.6), color, GRIME)
    color = G.mix(G.mul(M["dust"], 0.45), color, DUST)
    rough = G.mad(grain, 0.15, m["roughness"] - 0.05)
    rough = G.mix(M["wear"], rough, 0.33, color=False)  # polished by handling
    rough = G.mix(M["dirt"], rough, 0.85, color=False)
    height = G.mad(M["fine"], 0.3, grain)
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.00025)


def _rubber(G, m, M):
    c = m["rgb"]
    grain = G.smooth(G.voronoi(M["obj"], 1400.0), 0.0, 0.6)
    base = G.mix(G.mul(M["fine"], 0.25), c, darken(c, 0.7))
    color = G.mix(G.mul(M["wear"], 0.7), base, lighten(c, 0.2))
    color = G.mix(G.mul(M["dust"], 0.5), color, DUST)
    rough = G.mad(grain, 0.12, max(m["roughness"], 0.75) - 0.06)
    rough = G.mix(M["wear"], rough, 0.45, color=False)
    height = G.mad(M["fine"], 0.4, grain)
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.0004)


def _wood(G, m, M):
    c = m["rgb"]
    p = M["obj"]
    rings = G.wave(G.scale_vec(p, (0.12, 1.0, 1.0)), 16.0, "Y", distortion=1.4, detail=3.0)
    pores = G.noise(G.scale_vec(p, (0.03, 1.0, 1.0)), 300.0, detail=2.0)
    grain = G.mix(0.35, rings, pores, color=False)
    base = G.mix(G.mul(grain, 0.6), lighten(c, 0.08), darken(c, 0.5))
    base = G.mix(G.mul(M["grunge"], 0.25), base, darken(c, 0.75))
    color = G.mix(G.mul(M["wear"], 0.85), base, lighten(c, 0.4))  # bleached edges
    color = G.mix(G.mul(M["dirt"], 0.7), color, GRIME)
    rough = G.mad(grain, 0.2, m["roughness"] - 0.1)
    rough = G.mix(M["wear"], rough, 0.45, color=False)
    rough = G.mix(M["dirt"], rough, 0.9, color=False)
    height = G.mad(grain, 0.8, G.mul(M["fine"], 0.25))
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.0005)


def _brass(G, m, M):
    c = m["rgb"]
    tarnish = tint(darken(c, 0.35), (0.12, 0.16, 0.10, 1.0), 0.5)
    base = G.mix(G.mul(M["fine"], 0.18), c, darken(c, 0.8))
    base = G.mix(G.mul(M["grunge"], 0.35), base, tarnish)
    color = G.mix(G.mul(M["dirt"], 0.85), base, tarnish)
    color = G.mix(M["wear"], color, lighten(c, 0.25))
    rough = G.mad(M["fine"], 0.12, m["roughness"] - 0.06)
    rough = G.mix(G.mul(M["dirt"], 0.8), rough, 0.7, color=False)
    rough = G.mix(M["wear"], rough, 0.18, color=False)
    # Quinn/prod: ORM metallic binary 0/1 (wear AA only) — no dirt mid-gray plateaus.
    metal = 1.0
    height = G.mad(M["fine"], 0.25, G.mul(M["streak"], 0.15))
    return dict(color=color, rough=rough, metal=metal, height=height, distance=0.00015)


def _leather(G, m, M):
    c = m["rgb"]
    cells = G.smooth(G.voronoi(M["obj"], 500.0), 0.0, 0.75)
    base = G.mix(G.mul(cells, 0.35), c, darken(c, 0.65))
    base = G.mix(G.mul(M["grunge"], 0.3), base, darken(c, 0.8))
    color = G.mix(G.mul(M["wear"], 0.8), base, lighten(c, 0.3))
    color = G.mix(G.mul(M["dirt"], 0.6), color, GRIME)
    rough = G.mad(cells, 0.2, max(m["roughness"], 0.5) - 0.1)
    rough = G.mix(M["wear"], rough, 0.4, color=False)
    height = G.mad(M["fine"], 0.25, cells)
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.0004)


def _fabric(G, m, M):
    c = m["rgb"]
    warp = G.wave(M["uv"], 400.0, "X", distortion=0.2, detail=1.0)
    weft = G.wave(M["uv"], 400.0, "Y", distortion=0.2, detail=1.0)
    weave = G.mul(warp, weft)
    base = G.mix(G.mul(weave, 0.45), c, darken(c, 0.65))
    base = G.mix(G.mul(M["grunge"], 0.25), base, darken(c, 0.8))
    color = G.mix(G.mul(M["dirt"], 0.7), base, GRIME)
    color = G.mix(G.mul(M["dust"], 0.5), color, DUST)
    color = G.mix(G.mul(M["wear"], 0.5), color, lighten(c, 0.35))
    rough = G.mad(weave, 0.1, max(m["roughness"], 0.8) - 0.05)
    height = G.mad(M["fine"], 0.3, weave)
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.0003)


def _stone(G, m, M):
    c = m["rgb"]
    p = M["obj"]
    mottle = G.noise(p, 9.0, detail=6.0, roughness=0.65)
    speck = G.noise(p, 120.0, detail=4.0)
    base = G.mix(G.mul(mottle, 0.6), lighten(c, 0.15), darken(c, 0.6))
    base = G.mix(G.mul(speck, 0.3), base, darken(c, 0.75))
    color = G.mix(G.mul(M["dirt"], 0.8), base, GRIME)
    color = G.mix(G.mul(M["wear"], 0.6), color, lighten(c, 0.3))  # chipped edges
    rough = G.mad(M["fine"], 0.15, max(m["roughness"], 0.7) - 0.07)
    height = G.mad(speck, 0.6, G.mul(M["fine"], 0.4))
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.0012)


def _moss(G, m, M):
    """Organic growth: clumped, broken up by noise, thickest in cavities and on upward faces,
    thinning to the bare surface it grows on so a moss patch never reads as flat paint."""
    c = m["rgb"]
    p = M["obj"]
    stone = darken(c, 0.30)  # the growth thinning out to a dark stain of itself, not a grey patch
    clump = G.noise(p, 45.0, detail=6.0, roughness=0.7)
    fine = G.noise(p, 260.0, detail=4.0, roughness=0.6)
    # coverage: more where dirt collects and on horizontal faces, less on exposed edges
    coverage = G.smooth(G.mad(clump, 0.85, G.mad(M["top"], 0.35, G.mul(M["cavity"], 0.35))), 0.32, 0.78)
    coverage = G.smooth(G.sub(coverage, G.mul(M["edge"], 0.5)), 0.05, 0.6)
    # keep the material's own colour: vary it in value, never wash it toward white
    tone = G.mix(G.mul(fine, 0.8), darken(c, 0.45), darken(c, 1.35))
    tone = G.mix(G.mul(clump, 0.5), tone, darken(c, 0.7))
    color = G.mix(coverage, stone, tone)
    rough = G.mix(coverage, 0.78, G.mad(fine, 0.12, 0.88), color=False)
    height = G.mul(coverage, G.mad(clump, 0.7, G.mul(fine, 0.3)))
    return dict(color=color, rough=rough, metal=0.0, height=height, distance=0.0022)


def _glass(G, m, M):
    c = m["rgb"]
    color = G.mix(G.mul(M["dust"], 0.3), c, DUST)
    rough = G.mad(M["dust"], 0.4, max(0.04, m["roughness"] * 0.4))
    return dict(color=color, rough=rough, metal=0.0, height=None)


def _generic(G, m, M):
    c = m["rgb"]
    metallic = m["metallic"]
    base = G.mix(G.mul(M["fine"], 0.15), c, darken(c, 0.8))
    base = G.mix(G.mul(M["grunge"], 0.15), base, lighten(c, 0.1))
    color = G.mix(M["wear"], base, lighten(c, 0.35 if metallic >= 0.5 else 0.3))
    color = G.mix(G.mul(M["dirt"], 0.65), color, GRIME)
    color = G.mix(G.mul(M["dust"], 0.4), color, DUST)
    rough = G.mad(M["fine"], 0.12, m["roughness"] - 0.06)
    rough = G.mix(M["wear"], rough, 0.3 if metallic >= 0.5 else 0.4, color=False)
    rough = G.mix(M["dirt"], rough, 0.85, color=False)
    metal = 1.0 if metallic >= 0.5 else 0.0  # binary; dirt stays on albedo/rough
    height = G.mul(M["fine"], 0.3)
    return dict(color=color, rough=rough, metal=metal, height=height, distance=0.0003)


RECIPE_FUNCS = {
    "painted_steel": _painted_steel,
    "blued_steel": _blued_steel,
    "bare_steel": _bare_steel,
    "polymer": _polymer,
    "rubber": _rubber,
    "wood": _wood,
    "brass": _brass,
    "leather": _leather,
    "fabric": _fabric,
    "stone": _stone,
    "moss": _moss,
    "glass": _glass,
    "generic": _generic,
}


# --- materials ------------------------------------------------------------------------------------

def _new_material(name, mesh_name):
    old = bpy.data.materials.get(name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):  # 5.x materials are always node-based
        mat.use_nodes = True
    mat.node_tree.nodes.clear()
    mat["anvil_mesh"] = mesh_name
    return mat


def meshmap_material(mesh_name, radius):
    """Emission material whose colour is the edge map: R edges (bevel probe), G convex, B concave."""
    mat = _new_material("Anvil_meshmaps_" + mesh_name, mesh_name)
    G = Graph(mat.node_tree)
    geo = G.new("ShaderNodeNewGeometry")
    bevel = G.new("ShaderNodeBevel", samples=8)
    G.feed(bevel.inputs["Radius"], radius)
    edge = G.smooth(G.sub(1.0, G.vec("DOT_PRODUCT", bevel.outputs["Normal"], geo.outputs["Normal"])), 0.02, 0.3)
    convex = G.smooth(G.sub(geo.outputs["Pointiness"], 0.5), 0.02, 0.22)
    concave = G.smooth(G.sub(0.5, geo.outputs["Pointiness"]), 0.02, 0.22)
    emission = G.new("ShaderNodeEmission")
    G.feed(emission.inputs["Color"], G.combine(edge, convex, concave))
    out = G.new("ShaderNodeOutputMaterial")
    G.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    return mat


def recipe_material(slot, ao_img, edge_img, seed, mesh_name):
    """A recipe material plus the sockets each bake pass reads."""
    mat = _new_material(slot["name"] + "_recipe", mesh_name)
    mat["anvil_recipe"] = slot["recipe"]
    mat.use_fake_user = True  # survives file save with no users; replaced by the next surfacing run
    G = Graph(mat.node_tree)
    masks = build_masks(G, slot, ao_img, edge_img, seed)
    out = RECIPE_FUNCS[slot["recipe"]](G, slot, masks)
    bsdf = G.new("ShaderNodeBsdfPrincipled")
    G.feed(bsdf.inputs["Base Color"], out["color"])
    G.feed(bsdf.inputs["Roughness"], out["rough"])
    G.feed(bsdf.inputs["Metallic"], out["metal"])
    if out.get("height") is not None:
        G.feed(bsdf.inputs["Normal"], G.bump(out["height"], out.get("distance", 0.0004)))
    emission = G.new("ShaderNodeEmission")
    output = G.new("ShaderNodeOutputMaterial")
    G.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    channels = {"color": out["color"], "rough": out["rough"], "metal": out["metal"], "bsdf": bsdf, "emission": emission, "output": output, "graph": G}
    return mat, channels


def set_pass(mat, channels, which):
    """Route one channel to an Emission shader for an EMIT bake, or the BSDF for the normal bake."""
    links = mat.node_tree.links
    output, emission = channels["output"], channels["emission"]
    for link in list(links):
        if link.to_socket in (output.inputs["Surface"], emission.inputs["Color"]):
            links.remove(link)
    if which == "normal":
        links.new(channels["bsdf"].outputs["BSDF"], output.inputs["Surface"])
    else:
        channels["graph"].feed(emission.inputs["Color"], channels[which])
        links.new(emission.outputs["Emission"], output.inputs["Surface"])


def _gltf_output_group():
    """The node group the glTF exporter reads occlusion from."""
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        group.nodes.new("NodeGroupInput")
    return group


def wire_baked(mat, slot, albedo_img, normal_img, packed_img, engine):
    """Replace a material's nodes with the baked textures (what the GLB and the viewport show)."""
    mat.node_tree.nodes.clear()
    G = Graph(mat.node_tree)
    uv = G.new("ShaderNodeTexCoord").outputs["UV"]
    albedo = G.image(albedo_img, uv)
    normal = G.image(normal_img, uv)
    packed = G.image(packed_img, uv)
    bsdf = G.new("ShaderNodeBsdfPrincipled")
    G.feed(bsdf.inputs["Base Color"], albedo.outputs["Color"])
    r, g, b = G.separate(packed.outputs["Color"])
    if engine == "unity":
        metal, ao, rough = r, g, G.sub(1.0, packed.outputs["Alpha"])
    else:
        ao, rough, metal = r, g, b
    G.feed(bsdf.inputs["Roughness"], rough)
    G.feed(bsdf.inputs["Metallic"], metal)
    normal_map = G.new("ShaderNodeNormalMap", space="TANGENT")
    G.feed(normal_map.inputs["Color"], normal.outputs["Color"])
    G.feed(bsdf.inputs["Normal"], normal_map.outputs["Normal"])
    if slot.get("emissive"):
        G.feed(bsdf.inputs["Emission Color"], linear(slot["emissive"]))
        G.feed(bsdf.inputs["Emission Strength"], float(slot.get("emissive_strength", 1.0)))
    try:
        group = G.new("ShaderNodeGroup")
        group.node_tree = _gltf_output_group()
        G.feed(group.inputs[0], ao)
    except Exception as exc:  # cosmetic: only the exporter's occlusion slot is lost
        print("Anvil surfacing: no glTF occlusion hook:", exc)
    out = G.new("ShaderNodeOutputMaterial")
    G.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat["anvil_surfaced"] = slot["recipe"]


# --- scene plumbing -------------------------------------------------------------------------------

def _select_only(ob):
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def _fill(img, rgba):
    """Paint the whole image one colour, so texels the bake never reaches keep a sane value."""
    count = img.size[0] * img.size[1]
    if count:
        img.pixels.foreach_set(np.tile(np.array(rgba, dtype=np.float32), count))
    return img


def _image(name, size, data, alpha=False):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    return bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False, is_data=data)


def _save(img, folder):
    path = os.path.join(folder, img.name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save(filepath=path)
    return path


def _bounds(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def make_high(low):
    """A denser copy of `low` for the mesh-map and normal bakes: the same bevel with more
    segments, or a subdivision for meshes without one. The caller removes it."""
    high = low.copy()
    high.data = low.data.copy()
    high.name = "HP_" + low.name
    high.data.name = high.name
    (low.users_collection[0] if low.users_collection else bpy.context.scene.collection).objects.link(high)
    bevels = [m for m in high.modifiers if m.type == "BEVEL"]
    if bevels:
        for mod in bevels:
            mod.segments = max(mod.segments * 3, 6)
            mod.harden_normals = True
    else:
        # One level, not two: a part-assembled mesh has interpenetrating pieces, and each extra
        # subdivision pulls the surface further from the low-poly it is baked onto.
        sub = high.modifiers.new("AnvilHP", "SUBSURF")
        sub.levels = 1
        sub.render_levels = 1
    _select_only(high)
    for mod in list(high.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth()
    return high


def clean_normal(img, min_z=0.25):
    """Replace pathological pixels in a baked tangent normal map with the neutral normal.

    Where two parts of an assembly interpenetrate, a ray from the low-poly can land on the
    high-poly's neighbouring surface and record a normal pointing sideways or backwards. A
    tangent-space normal always has a positive Z, so anything below `min_z` is a bake artifact,
    and it renders as a hard black band. Returns the fraction of pixels replaced."""
    count = img.size[0] * img.size[1]
    if not count:
        return 0.0
    buf = np.empty(count * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    px = buf.reshape(count, 4)
    bad = px[:, 2] < min_z
    fraction = float(bad.mean())
    if fraction:
        px[bad, 0] = 0.5
        px[bad, 1] = 0.5
        px[bad, 2] = 1.0
        img.pixels.foreach_set(px.ravel())
        img.update()
    return fraction


class _Session:
    """Cycles bake settings and scene isolation for the run, restored afterwards."""

    def __init__(self, low, high, size, cage):
        self.scene = bpy.context.scene
        self.low, self.high, self.size, self.cage = low, high, size, cage
        self.hidden = []
        self.uv_state = []
        self.saved = {}

    def prepare(self):
        scene = self.scene
        self.saved = {"engine": scene.render.engine, "samples": scene.cycles.samples}
        bake = scene.render.bake
        self.saved["bake"] = {key: getattr(bake, key) for key in BAKE_KEYS}
        for ob in scene.objects:  # anything else in the scene would occlude the AO rays
            if ob not in (self.low, self.high) and not ob.hide_render:
                ob.hide_render = True
                self.hidden.append(ob)
        for ob in (self.low, self.high):
            for layer in ob.data.uv_layers:
                self.uv_state.append((layer, layer.active_render))
            if ob.data.uv_layers:
                ob.data.uv_layers[0].active_render = True  # UV0 is the texture set; UV1 is the lightmap
        scene.render.engine = "CYCLES"
        bake.use_selected_to_active = True
        bake.use_cage = False
        bake.cage_extrusion = self.cage
        bake.max_ray_distance = self.cage * 2
        bake.margin = max(4, self.size // 128)
        bake.normal_space = "TANGENT"
        # Never clear to black. A face that straddles the intersection of two parts gets no valid
        # sample (its ray leaves into a neighbouring part and finds only backfaces), and a cleared
        # texel would render as a hard black band. Each pass pre-fills its own neutral instead.
        bake.use_clear = False
        bake.target = "IMAGE_TEXTURES"

    def bake(self, targets, image, kind, samples, fill=None):
        if fill is not None:
            _fill(image, fill)
        for mat, node in targets:
            node.image = image
            for other in mat.node_tree.nodes:
                other.select = False
            node.select = True
            mat.node_tree.nodes.active = node
        self.scene.cycles.samples = samples
        _select_only(self.low)
        self.high.select_set(True)
        bpy.context.view_layer.objects.active = self.low
        bpy.ops.object.bake(type=kind)

    def restore(self):
        scene = self.scene
        for ob in self.hidden:
            ob.hide_render = False
        for layer, active in self.uv_state:
            try:
                layer.active_render = active
            except ReferenceError:
                pass
        if self.saved:
            for key, value in self.saved["bake"].items():
                setattr(scene.render.bake, key, value)
            scene.cycles.samples = self.saved["samples"]
            scene.render.engine = self.saved["engine"]


def _material_defaults(mat):
    """Slot values from a material's Principled BSDF, for callers that pass no slot list."""
    out = {"name": mat.name if mat else "", "color": (0.5, 0.5, 0.5, 1.0), "roughness": 0.5, "metallic": 0.0, "emissive": None, "emissive_strength": 1.0}
    if mat is None or mat.node_tree is None:
        return out
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return out
    out["color"] = tuple(bsdf.inputs["Base Color"].default_value)
    out["roughness"] = float(bsdf.inputs["Roughness"].default_value)
    out["metallic"] = float(bsdf.inputs["Metallic"].default_value)
    if bsdf.inputs["Emission Strength"].default_value > 0:
        out["emissive"] = tuple(bsdf.inputs["Emission Color"].default_value)
        out["emissive_strength"] = float(bsdf.inputs["Emission Strength"].default_value)
    return out


def normalise_slots(low, slots, wear, dirt):
    """One complete slot dict per material slot of `low`, recipes resolved."""
    out = []
    for index, slot in enumerate(low.material_slots):
        base = _material_defaults(slot.material)
        given = slots[index] if slots and index < len(slots) and slots[index] else {}
        base.update({key: value for key, value in dict(given).items() if value is not None})
        base["name"] = base.get("name") or "slot%d" % index
        base["rgb"] = linear(base.get("color") or base.get("albedo") or "#808080")
        base["roughness"] = float(base.get("roughness", 0.5))
        base["metallic"] = float(base.get("metallic", base.get("metalness", 0.0)))
        base["wear"] = max(0.0, min(1.0, float(base.get("wear", wear))))
        base["dirt"] = max(0.0, min(1.0, float(base.get("dirt", dirt))))
        recipe = base.get("recipe") or "auto"
        if recipe not in RECIPE_FUNCS:
            recipe = recipe_for(base["name"], base["rgb"], base["metallic"])
        base["recipe"] = recipe
        out.append(base)
    return out


def pack(engine, name, size, ao_img, rough_img, metal_img):
    """ORM (R AO, G roughness, B metallic) or Unity HDRP Mask (R metallic, G AO, B 1, A smoothness)."""
    count = size * size

    def channel(img):
        buf = np.empty(count * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        return buf.reshape(count, 4)[:, 0]

    ao, rough, metal = channel(ao_img), channel(rough_img), channel(metal_img)
    # Production ORM metallic: binary 0/1 with thin wear AA only — snap mid-gray plateaus.
    # Keep fringe in (0, 0.12] U [0.88, 1) so island/wear edges stay anti-aliased.
    mid = (metal > 0.12) & (metal < 0.88)
    metal = np.where(mid, np.where(metal >= 0.5, 1.0, 0.0), metal)
    metal = np.clip(metal, 0.0, 1.0)
    packed = np.ones((count, 4), dtype=np.float32)
    if engine == "unity":
        packed[:, 0] = metal
        packed[:, 1] = ao
        packed[:, 3] = 1.0 - rough
        img = _image(name, size, True, alpha=True)
    else:
        packed[:, 0] = ao
        packed[:, 1] = rough
        packed[:, 2] = metal
        img = _image(name, size, True)
    img.pixels.foreach_set(packed.ravel())
    return img


# --- entry point ----------------------------------------------------------------------------------

def surface(low, high=None, slots=None, size=1024, samples=16, out_dir=None, names=None, engine="unreal", wear=0.45, dirt=0.35, seed=0, log=print):
    """Surface `low` (a mesh object with UV0 and one material per slot). See the module docstring.

    Returns {"saved": [png paths], "maps": [mesh-map png paths], "recipes": {slot name: recipe},
    "seconds": float, "passes": {pass: seconds}}.
    """
    if low is None or low.type != "MESH":
        raise ValueError("surface() needs a mesh object")
    if not low.data.uv_layers:
        raise ValueError(low.name + " has no UVs")
    if not any(slot.material for slot in low.material_slots):
        raise ValueError(low.name + " has no materials")
    started = time.time()
    names = dict(names or {})
    names.setdefault("albedo", low.name + "_D")
    names.setdefault("normal", low.name + "_N")
    names.setdefault("packed", low.name + "_ORM")
    if not out_dir:
        out_dir = bpy.path.abspath("//textures") if bpy.data.filepath else os.path.join(bpy.app.tempdir, "anvil_textures")
    maps_dir = os.path.join(out_dir, "maps")
    os.makedirs(maps_dir, exist_ok=True)
    resolved = normalise_slots(low, slots, wear, dirt)
    lo, hi = _bounds(low)
    span = max(hi - lo)
    # The high-poly is the same shape with a denser bevel, so a ray only has to cross that bevel.
    # A cage scaled to the object instead lets rays in a tight crevice reach a neighbouring part and
    # bake its surface direction, which shows up as black bands where parts meet.
    bevel = next((m.width for m in low.modifiers if m.type == "BEVEL" and m.width > 0), None)
    cage = max(0.0008, min(0.01, bevel * 3.0)) if bevel else max(0.002, min(0.02, span * 0.006))
    edge_radius = max(0.0015, min(0.02, span * 0.008))

    made_high = high is None
    if made_high:
        high = make_high(low)
    session = _Session(low, high, size, cage)
    high_materials = list(high.data.materials)
    while len(high.data.materials) < len(low.material_slots):
        high.data.materials.append(None)
    targets = []
    temp_images = []
    passes = {}
    meshmaps = None
    recipes = []

    def timed(name, fn):
        t = time.time()
        fn()
        passes[name] = round(time.time() - t, 1)
        log("Anvil surfacing: %s %.1fs" % (name, passes[name]))

    try:
        session.prepare()
        for slot in low.material_slots:
            mat = slot.material
            if mat is None:
                continue
            if bpy.app.version < (5, 0, 0):
                mat.use_nodes = True
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.name = "AnvilBakeTarget"
            targets.append((mat, node))

        ao_img = _image(low.name + "_AO", size, True)
        edge_img = _image(low.name + "_Edge", size, True)
        normal_img = _image(names["normal"], size, True)
        albedo_img = _image(names["albedo"], size, False)
        rough_img = _image("Anvil_rough_temp", size, True)
        metal_img = _image("Anvil_metal_temp", size, True)
        temp_images.extend((rough_img, metal_img))

        # 1. mesh maps from the high-poly
        meshmaps = meshmap_material(low.name, edge_radius)
        for index in range(len(low.material_slots)):
            high.data.materials[index] = meshmaps
        timed("ao", lambda: session.bake(targets, ao_img, "AO", samples, fill=(1.0, 1.0, 1.0, 1.0)))
        timed("edges", lambda: session.bake(targets, edge_img, "EMIT", max(4, samples // 2), fill=(0.0, 0.0, 0.0, 1.0)))

        # 2. recipe materials on the high-poly
        for index, slot in enumerate(resolved):
            mat, channels = recipe_material(slot, ao_img, edge_img, seed + index * 13, low.name)
            recipes.append((mat, channels))
            high.data.materials[index] = mat

        # 3. channel bakes
        # what an unreachable texel should hold: the slots' own average look, not black
        mean_rgb = [sum(slot["rgb"][i] for slot in resolved) / len(resolved) for i in range(3)]
        mean_rough = sum(slot["roughness"] for slot in resolved) / len(resolved)
        fills = {
            "color": tuple(mean_rgb) + (1.0,),
            "rough": (mean_rough, mean_rough, mean_rough, 1.0),
            # Empty UV / unreachable texels: dielectric 0 (not slot-mean mid-gray ~0.33).
            "metal": (0.0, 0.0, 0.0, 1.0),
            "normal": (0.5, 0.5, 1.0, 1.0),
        }
        for pass_name, img, kind in (("color", albedo_img, "EMIT"), ("rough", rough_img, "EMIT"), ("metal", metal_img, "EMIT"), ("normal", normal_img, "NORMAL")):
            for mat, channels in recipes:
                set_pass(mat, channels, pass_name)
            timed(pass_name, lambda: session.bake(targets, img, kind, 4, fill=fills[pass_name]))
        for mat, channels in recipes:
            set_pass(mat, channels, "normal")  # leave the recipe as a shaded material for editing
        repaired = clean_normal(normal_img)
        if repaired > 0.0005:
            log("Anvil surfacing: repaired %.2f%% of the normal map where parts interpenetrate" % (repaired * 100))

        # 4. pack and save
        packed_img = pack(engine, names["packed"], size, ao_img, rough_img, metal_img)
        saved = [_save(img, out_dir) for img in (albedo_img, normal_img, packed_img)]
        maps = [_save(img, maps_dir) for img in (ao_img, edge_img)]

        # 5. the game mesh shows and exports the bakes
        for (mat, node) in targets:
            mat.node_tree.nodes.remove(node)
        targets = []
        for index, slot in enumerate(resolved):
            mat = low.material_slots[index].material
            if mat is not None:
                wire_baked(mat, slot, albedo_img, normal_img, packed_img, engine)
    finally:
        for mat, node in targets:
            try:
                mat.node_tree.nodes.remove(node)
            except Exception:
                pass
        for img in temp_images:
            try:
                bpy.data.images.remove(img)
            except Exception:
                pass
        for index, mat in enumerate(high_materials):
            if index < len(high.data.materials):
                high.data.materials[index] = mat
        if meshmaps is not None:
            bpy.data.materials.remove(meshmaps)
        session.restore()
        if made_high:
            mesh = high.data
            bpy.data.objects.remove(high, do_unlink=True)
            bpy.data.meshes.remove(mesh)
        _select_only(low)

    seconds = round(time.time() - started, 1)
    chosen = {slot["name"]: slot["recipe"] for slot in resolved}
    log("Anvil surfacing: %s at %dpx in %.1fs: %s" % (low.name, size, seconds, ", ".join("%s=%s" % kv for kv in chosen.items())))
    return {"saved": saved, "maps": maps, "recipes": chosen, "seconds": seconds, "passes": passes}


def surface_by_name(mesh_name, **kwargs):
    """Console convenience: surface(bpy.data.objects[mesh_name], ...)."""
    return surface(bpy.data.objects[mesh_name], **kwargs)
