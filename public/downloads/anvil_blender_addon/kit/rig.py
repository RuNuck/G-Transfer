"""Rig for a kit build's moving parts: one armature, one bone per moving part, rigid skinning.

The kit families tag each moving part with a vertex group named after its bone and describe
the motion (see `kit/__init__.py`). `apply()` turns that description into:

- an armature `RIG_<mesh>` with a `root` bone and one deform bone per moving part, its head at
  the part's pivot and its Y axis along the motion axis, so a slide is `location.y` and a
  hinge is `rotation_euler.y` in pose space; a bone may name another as its `parent` so it
  rides along, which is how a handle bolted to a lid follows the lid when the lid opens;
- a `root` vertex group for everything that does not move, an Armature modifier on the mesh
  and its LOD copies, and the mesh parented to the armature;
- one demo action per motion (cock back, trigger pull, magazine release, ...) stashed on
  muted NLA tracks, which the glTF exporter writes as separate animation clips.

Pivots in the description are in build coordinates; pass `shift` (what the build subtracted
when it moved the mesh onto its pivot) so the bones land on the final geometry.
"""
import math

import bpy
from mathutils import Vector

ROOT = "root"
DEFAULT_BONE_LENGTH = 0.03


def _select_only(ob):
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def _remove_previous(name, mesh_name):
    old = bpy.data.objects.get(name)
    if old is not None:
        data = old.data
        bpy.data.objects.remove(old, do_unlink=True)
        if isinstance(data, bpy.types.Armature) and data.users == 0:
            bpy.data.armatures.remove(data)
    for action in list(bpy.data.actions):
        if action.get("anvil_mesh") == mesh_name:
            bpy.data.actions.remove(action)


def _build_bones(arm, bones, shift):
    """One bone per moving part. A bone may name another as its `parent` so it rides along
    (a handle bolted to a lid follows the lid); anything else hangs off root."""
    _select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    edit = arm.data.edit_bones
    root = edit.new(ROOT)
    root.head = (0.0, 0.0, 0.0)
    root.tail = (0.0, 0.0, DEFAULT_BONE_LENGTH * 2)
    made = {ROOT: root}

    def place(spec, parent):
        bone = edit.new(spec["bone"])
        head = Vector(spec["pivot"]) - shift
        axis = Vector(spec["axis"])
        axis = axis.normalized() if axis.length > 1e-9 else Vector((0.0, 1.0, 0.0))
        bone.head = head
        bone.tail = head + axis * float(spec.get("length", DEFAULT_BONE_LENGTH))
        bone.parent = parent
        bone.use_deform = True
        made[spec["bone"]] = bone

    pending = list(bones)
    while pending:
        ready = [s for s in pending if (s.get("parent") or ROOT) in made]
        if not ready:  # a missing or circular parent must not drop the bone
            for spec in pending:
                print("Anvil rig: bone %r names an unknown parent %r; attaching to root" % (spec["bone"], spec.get("parent")))
                place(spec, root)
            break
        for spec in ready:
            place(spec, made[spec.get("parent") or ROOT])
        pending = [s for s in pending if s["bone"] not in made]
    bpy.ops.object.mode_set(mode="OBJECT")


def _skin(ob, arm, bones):
    """Everything not in a moving part's group goes to root; then bind to the armature."""
    moving = set()
    for spec in bones:
        group = ob.vertex_groups.get(spec["group"])
        if group is None:
            continue
        for v in ob.data.vertices:
            if any(g.group == group.index for g in v.groups):
                moving.add(v.index)
    root = ob.vertex_groups.get(ROOT) or ob.vertex_groups.new(name=ROOT)
    root.add([v.index for v in ob.data.vertices if v.index not in moving], 1.0, "REPLACE")
    if moving:
        root.remove(sorted(moving))
    mod = ob.modifiers.get("AnvilRig") or ob.modifiers.new("AnvilRig", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()
    return len(moving)


def _pose(pose_bone, spec, fraction):
    if spec["motion"] == "slide":
        pose_bone.location = (0.0, float(spec.get("travel", 0.0)) * fraction, 0.0)
        return "location"
    pose_bone.rotation_mode = "XYZ"
    pose_bone.rotation_euler = (0.0, math.radians(float(spec.get("angle", 0.0)) * fraction), 0.0)
    return "rotation_euler"


def _actions(arm, bones, actions, mesh_name):
    by_bone = {spec["bone"]: spec for spec in bones}
    arm.animation_data_create()
    adt = arm.animation_data
    made = []
    for act_spec in actions:
        parts = [p for p in act_spec.get("parts", []) if p in by_bone and p in arm.pose.bones]
        if not parts:
            continue
        action = bpy.data.actions.new(act_spec["name"])  # may come back uniquified; the track keeps the real name
        action["anvil_mesh"] = mesh_name
        action.use_fake_user = True
        adt.action = action
        for bone_name in parts:
            spec = by_bone[bone_name]
            pose_bone = arm.pose.bones[bone_name]
            for frame, fraction in act_spec["keys"]:
                path = _pose(pose_bone, spec, float(fraction))
                pose_bone.keyframe_insert(path, frame=int(frame))
            _pose(pose_bone, spec, 0.0)
        track = adt.nla_tracks.new()
        # The exported clip takes the track's name, and Blender uniquifies an action name that is
        # already taken in the file. Name the track from the spec so a second asset forged in the
        # same session still exports "open", not "open_001".
        track.name = act_spec["name"]
        track.strips.new(act_spec["name"], int(act_spec["keys"][0][0]), action)
        track.mute = True  # stashed: exported as a clip, not playing in the viewport
        adt.action = None
        made.append(act_spec["name"])
    return made


def apply(body, rig_spec, lods=(), shift=(0.0, 0.0, 0.0), name=None):
    """Rig `body` (and its LOD copies) from a kit rig description. Returns the armature, or
    None when the description has no moving parts."""
    bones = [b for b in rig_spec.get("bones", []) if body.vertex_groups.get(b["group"]) is not None]
    if not bones:
        return None
    name = name or "RIG_" + body.name
    _remove_previous(name, body.name)
    arm_data = bpy.data.armatures.new(name)
    arm_data.display_type = "STICK"
    arm = bpy.data.objects.new(name, arm_data)
    arm.show_in_front = True
    (body.users_collection[0] if body.users_collection else bpy.context.scene.collection).objects.link(arm)
    _build_bones(arm, bones, Vector(shift))
    skinned = {ob.name: _skin(ob, arm, bones) for ob in (body, *lods) if ob is not None}
    actions = _actions(arm, bones, rig_spec.get("actions", []), body.name)
    body["anvil_rig"] = arm.name
    arm["anvil_mesh"] = body.name
    arm["anvil_actions"] = ", ".join(actions)
    _select_only(body)
    print("Anvil rig: {} with {} bones, moving vertices {}, actions {}".format(arm.name, len(bones), skinned, actions))
    return arm
