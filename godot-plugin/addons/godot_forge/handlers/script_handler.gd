@tool
extends RefCounted
## Handles script operations via the editor.

func get_current(_params: Dictionary) -> Dictionary:
	"""Get the currently open script content."""
	var script := EditorInterface.get_script_editor().get_current_script()
	if not script:
		return {"error": "No script open"}

	return {
		"path": script.resource_path,
		"source": script.source_code,
		"type": script.get_class(),
	}


func open(params: Dictionary) -> Dictionary:
	"""Open a script in the editor."""
	var path: String = params.get("path", "")
	if path.is_empty():
		return {"error": "No path provided"}

	var script := load(path) as Script
	if not script:
		return {"error": "Failed to load script: %s" % path}

	EditorInterface.edit_script(script)
	return {"ok": true, "path": path}


func reload(params: Dictionary) -> Dictionary:
	"""Reload a script from disk."""
	var path: String = params.get("path", "")
	if path.is_empty():
		return {"error": "No path provided"}

	var script := load(path) as Script
	if not script:
		return {"error": "Script not found: %s" % path}

	script.reload()
	return {"ok": true, "path": path}


func get_errors(_params: Dictionary) -> Array:
	"""Get script errors from the current session."""
	# Note: Direct error access isn't available in 4.3 editor API
	# Errors appear in the output panel
	return []
