# Walks every imported .glb in res://assets and prints one JSON line describing what Godot got.
# Run headless by tools/godot-check/check-import.mjs; not part of a game project.
extends SceneTree


func _describe_material(mat: Material) -> Dictionary:
	var out := {"name": mat.resource_name if mat else "", "class": mat.get_class() if mat else "null"}
	if mat is BaseMaterial3D:
		var m := mat as BaseMaterial3D
		out["albedo_color"] = [
			snappedf(m.albedo_color.r, 0.001), snappedf(m.albedo_color.g, 0.001), snappedf(m.albedo_color.b, 0.001)
		]
		out["metallic"] = snappedf(m.metallic, 0.001)
		out["roughness"] = snappedf(m.roughness, 0.001)
		out["albedo_texture"] = m.albedo_texture != null
		out["normal_texture"] = m.normal_enabled and m.normal_texture != null
		out["orm_texture"] = m.orm_texture != null or m.roughness_texture != null or m.metallic_texture != null
		out["ao_texture"] = m.ao_enabled and m.ao_texture != null
		out["emission"] = m.emission_enabled
		var sizes := []
		for tex in [m.albedo_texture, m.normal_texture, m.orm_texture]:
			if tex != null:
				sizes.append([tex.get_width(), tex.get_height()])
		out["texture_sizes"] = sizes
	return out


func _walk(node: Node, asset: Dictionary) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		var mesh := mi.mesh
		var entry := {"name": mi.name, "surfaces": 0, "vertices": 0, "materials": []}
		if mesh != null:
			entry["surfaces"] = mesh.get_surface_count()
			var tris := 0
			for i in mesh.get_surface_count():
				var arrays := mesh.surface_get_arrays(i)
				if arrays.size() > Mesh.ARRAY_INDEX and arrays[Mesh.ARRAY_INDEX] != null:
					tris += arrays[Mesh.ARRAY_INDEX].size() / 3
				elif arrays.size() > Mesh.ARRAY_VERTEX and arrays[Mesh.ARRAY_VERTEX] != null:
					tris += arrays[Mesh.ARRAY_VERTEX].size() / 3
				entry["materials"].append(_describe_material(mesh.surface_get_material(i)))
			entry["triangles"] = tris
			var aabb := mesh.get_aabb()
			entry["size"] = [snappedf(aabb.size.x, 0.001), snappedf(aabb.size.y, 0.001), snappedf(aabb.size.z, 0.001)]
		asset["meshes"].append(entry)
	elif node is AnimationPlayer:
		var ap := node as AnimationPlayer
		for name in ap.get_animation_list():
			var anim := ap.get_animation(name)
			asset["animations"].append({"name": String(name), "length": snappedf(anim.get_length(), 0.001), "tracks": anim.get_track_count()})
	elif node is Skeleton3D:
		var sk := node as Skeleton3D
		var bones := []
		for i in sk.get_bone_count():
			bones.append(sk.get_bone_name(i))
		asset["skeletons"].append({"name": sk.name, "bones": bones})
	elif node is CollisionShape3D or node is StaticBody3D:
		asset["collision"].append({"name": node.name, "class": node.get_class()})
	for child in node.get_children():
		_walk(child, asset)


func _init() -> void:
	var report := {"assets": []}
	var dir := DirAccess.open("res://assets")
	var names := []
	if dir != null:
		for file in dir.get_files():
			if file.get_extension().to_lower() == "glb":
				names.append(file)
	names.sort()
	for file in names:
		var asset := {"file": file, "meshes": [], "animations": [], "skeletons": [], "collision": [], "nodes": []}
		var packed = load("res://assets/" + file)
		if packed == null:
			asset["error"] = "Godot could not load the imported resource"
		else:
			var root: Node = packed.instantiate()
			var stack: Array[Node] = [root]
			while stack.size() > 0:
				var n: Node = stack.pop_back()
				asset["nodes"].append(n.name)
				for c in n.get_children():
					stack.append(c)
			asset["body"] = root.name
			_walk(root, asset)
			root.free()
		report["assets"].append(asset)
	print("ANVIL_REPORT_JSON ", JSON.stringify(report))
	quit()
