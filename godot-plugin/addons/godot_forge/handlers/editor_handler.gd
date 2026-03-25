@tool
extends RefCounted
## Handles editor state queries.

func get_state(_params: Dictionary) -> Dictionary:
	"""Get current editor state."""
	var root := EditorInterface.get_edited_scene_root()
	var current_scene := ""
	if root:
		current_scene = root.scene_file_path

	return {
		"current_scene": current_scene,
		"open_scenes": _get_open_scenes(),
		"current_script": _get_current_script(),
		"editor_scale": EditorInterface.get_editor_scale(),
	}


func get_open_scenes(_params: Dictionary) -> Array:
	"""Get list of open scenes."""
	return _get_open_scenes()


func get_current_script(_params: Dictionary) -> Dictionary:
	"""Get the currently edited script."""
	var script := EditorInterface.get_script_editor().get_current_script()
	if not script:
		return {"error": "No script open"}

	return {
		"path": script.resource_path,
		"type": script.get_class(),
	}


func open_scene(params: Dictionary) -> Dictionary:
	"""Open a scene in the editor."""
	var path: String = params.get("path", "")
	if path.is_empty():
		return {"error": "No path provided"}

	EditorInterface.open_scene_from_path(path)
	return {"ok": true, "opened": path}


func open_script(params: Dictionary) -> Dictionary:
	"""Open a script in the editor."""
	var path: String = params.get("path", "")
	if path.is_empty():
		return {"error": "No path provided"}

	var script := load(path)
	if not script:
		return {"error": "Failed to load: %s" % path}

	EditorInterface.edit_script(script)
	return {"ok": true, "opened": path}


func save_all(_params: Dictionary) -> Dictionary:
	"""Save all open scenes and resources."""
	EditorInterface.save_all_scenes()
	return {"ok": true}


func reimport_all(_params: Dictionary) -> Dictionary:
	"""Trigger a full reimport of all assets."""
	EditorInterface.get_resource_filesystem().scan()
	return {"ok": true}


func get_editor_settings(_params: Dictionary) -> Dictionary:
	"""Get editor settings."""
	var settings := EditorInterface.get_editor_settings()
	return {
		"theme": settings.get_setting("interface/theme/preset"),
		"font_size": settings.get_setting("interface/editor/main_font_size"),
	}


# ── Helpers ─────────────────────────────────────────────────────

func _get_open_scenes() -> Array:
	var scenes: Array = []
	# EditorInterface doesn't directly expose open scene list in 4.3
	# Use the edited scene root as best available
	var root := EditorInterface.get_edited_scene_root()
	if root:
		scenes.append(root.scene_file_path)
	return scenes


func _get_current_script() -> String:
	var script := EditorInterface.get_script_editor().get_current_script()
	if script:
		return script.resource_path
	return ""
