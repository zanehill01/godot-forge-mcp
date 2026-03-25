@tool
extends RefCounted
## Handles runtime debugging operations.

func screenshot(_params: Dictionary) -> Dictionary:
	"""Capture the editor viewport as a base64 image."""
	var viewport := EditorInterface.get_editor_viewport_3d()
	if not viewport:
		# Try 2D viewport
		viewport = EditorInterface.get_editor_viewport_2d()
	if not viewport:
		return {"error": "No viewport available"}

	var image := viewport.get_texture().get_image()
	if not image:
		return {"error": "Failed to capture viewport"}

	var png := image.save_png_to_buffer()
	return {
		"format": "png",
		"width": image.get_width(),
		"height": image.get_height(),
		"data_base64": Marshalls.raw_to_base64(png),
	}


func get_performance(_params: Dictionary) -> Dictionary:
	"""Get engine performance metrics."""
	return {
		"fps": Performance.get_monitor(Performance.TIME_FPS),
		"process_time": Performance.get_monitor(Performance.TIME_PROCESS),
		"physics_time": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS),
		"navigation_time": Performance.get_monitor(Performance.TIME_NAVIGATION_PROCESS),
		"render_objects": Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		"render_draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"render_primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"physics_2d_active": Performance.get_monitor(Performance.PHYSICS_2D_ACTIVE_OBJECTS),
		"physics_3d_active": Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS),
		"memory_static": Performance.get_monitor(Performance.MEMORY_STATIC),
		"memory_static_max": Performance.get_monitor(Performance.MEMORY_STATIC_MAX),
		"object_count": Performance.get_monitor(Performance.OBJECT_COUNT),
		"object_resource_count": Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT),
		"object_node_count": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
	}


func get_running_scene_tree(_params: Dictionary) -> Dictionary:
	"""Get the scene tree of the running game (via debug)."""
	# Note: In editor context, we can inspect the editor's own tree
	var tree := Engine.get_main_loop()
	if tree is SceneTree:
		return _serialize_tree(tree.root)
	return {"error": "No scene tree available"}


func get_console_output(_params: Dictionary) -> Dictionary:
	"""Get recent console/print output."""
	# Note: Godot 4.3 doesn't expose print output programmatically in editor
	# This would need the running game's output via remote debugger
	return {
		"note": "Console output capture requires the game to be running with remote debugging.",
		"available": false,
	}


# ── Helpers ─────────────────────────────────────────────────────

func _serialize_tree(node: Node) -> Dictionary:
	var data: Dictionary = {
		"name": node.name,
		"type": node.get_class(),
	}

	if node.get_child_count() > 0:
		var children: Array = []
		for child in node.get_children():
			children.append(_serialize_tree(child))
		data["children"] = children

	return data
