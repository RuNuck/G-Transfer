extends SceneTree
# Headless proof that a composed scene.tscn loads in Godot.
# Printed line: ANVIL_SCENE_OK <path>  or ANVIL_SCENE_FAIL <reason>
func _init() -> void:
	var path := "res://scene.tscn"
	if not ResourceLoader.exists(path):
		print("ANVIL_SCENE_FAIL missing ", path)
		quit(1)
		return
	var packed = load(path)
	if packed == null:
		print("ANVIL_SCENE_FAIL load_null ", path)
		quit(1)
		return
	var inst = packed.instantiate()
	if inst == null:
		print("ANVIL_SCENE_FAIL instantiate_null ", path)
		quit(1)
		return
	print("ANVIL_SCENE_OK ", path, " root=", inst.get_class(), " name=", inst.name)
	inst.queue_free()
	quit(0)
