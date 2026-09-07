# Build res://main.tscn: every imported asset in res://assets laid out in a row on the ground,
# with a camera, a sun and a sky, so the project opens on something you can look at straight away.
# Run headless by tools/godot-check/open-project.mjs after the assets have been imported.
extends SceneTree


# A GLB carries more than the render mesh. Godot turns a "-colonly" node into an invisible
# StaticBody3D, but an export aimed at Unreal or Unity brings its collision proxy in as an ordinary
# mesh (UBX_/UCX_/USP_/UCP_/COL_), and every engine except Godot wants the _LOD1/_LOD2 chain in the
# file. Left alone they all draw on top of the asset. Hide them here: the tree still lists them, so
# they can be switched back on, and nothing is deleted from the imported scene.
const COLLISION_PREFIXES := ["UBX_", "UCX_", "USP_", "UCP_", "COL_"]


func _is_extra(node: Node) -> bool:
	if not (node is VisualInstance3D):
		return false
	var name := String(node.name)
	if name.contains("_LOD"):
		return true
	for prefix in COLLISION_PREFIXES:
		if name.begins_with(prefix):
			return true
	return name.ends_with("_col")


func _hide_extras(node: Node) -> int:
	var count := 0
	var stack: Array[Node] = [node]
	while stack.size() > 0:
		var n: Node = stack.pop_back()
		if _is_extra(n):
			(n as VisualInstance3D).visible = false
			count += 1
		for c in n.get_children():
			stack.append(c)
	return count


func _aabb(node: Node) -> AABB:
	var box := AABB()
	var seeded := false
	var stack: Array[Node] = [node]
	while stack.size() > 0:
		var n: Node = stack.pop_back()
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null and n.visible and not _is_extra(n):
			var mi := n as MeshInstance3D
			var local := mi.mesh.get_aabb()
			var xf := mi.transform
			var p := n.get_parent()
			while p != null and p != node:
				if p is Node3D:
					xf = (p as Node3D).transform * xf
				p = p.get_parent()
			var world := xf * local
			box = world if not seeded else box.merge(world)
			seeded = true
		for c in n.get_children():
			stack.append(c)
	return box


func _init() -> void:
	var root := Node3D.new()
	root.name = "Showcase"

	var dir := DirAccess.open("res://assets")
	var files := []
	if dir != null:
		for f in dir.get_files():
			if f.get_extension().to_lower() == "glb":
				files.append(f)
	files.sort()

	var cursor := 0.0
	var gap := 0.35
	var total := AABB()
	var seeded := false
	var placed := 0
	var hidden := 0
	for file in files:
		var packed: PackedScene = load("res://assets/" + file)
		if packed == null:
			push_warning("could not load " + file)
			continue
		var inst: Node = packed.instantiate()
		if not (inst is Node3D):
			inst.free()
			continue
		var node := inst as Node3D
		node.name = file.get_basename()
		var box := _aabb(node)
		# sit each asset on the ground and butt it up against the previous one
		node.position = Vector3(cursor + box.size.x * 0.5 - box.get_center().x, -box.position.y, 0.0)
		root.add_child(node)
		node.owner = root
		# A change inside an instanced scene is only written to the .tscn when the instance is
		# editable; without this the hidden meshes come back visible the next time it loads.
		root.set_editable_instance(node, true)
		hidden += _hide_extras(node)
		cursor += box.size.x + gap
		var world := AABB(box.position + node.position, box.size)
		total = world if not seeded else total.merge(world)
		seeded = true
		placed += 1

	# a sun, a sky and a camera framing the whole row
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-48, -130, 0)
	sun.light_energy = 1.4
	sun.shadow_enabled = true
	root.add_child(sun)
	sun.owner = root

	var env := Environment.new()
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	root.add_child(we)
	we.owner = root

	var cam := Camera3D.new()
	cam.name = "Camera3D"
	var centre := total.get_center()
	var span: float = max(total.size.x, 1.0)
	cam.position = centre + Vector3(0.0, span * 0.30, span * 0.78)
	cam.look_at_from_position(cam.position, centre, Vector3.UP)
	cam.current = true
	root.add_child(cam)
	cam.owner = root

	var scene := PackedScene.new()
	var err := scene.pack(root)
	if err == OK:
		err = ResourceSaver.save(scene, "res://main.tscn")
	print("ANVIL_SHOWCASE placed=%d hid_extras=%d width=%.2f saved=%s" % [placed, hidden, total.size.x, error_string(err)])
	root.free()  # otherwise Godot reports the whole tree as leaked at exit
	quit()
