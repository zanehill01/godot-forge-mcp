@tool
extends RefCounted
## Handles scene tree operations via the editor.

func get_tree_data(_params: Dictionary) -> Dictionary:
	"""Get the current scene tree as a serialized dictionary."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return {"error": "No scene open"}
	return _serialize_node(root)


func get_selected_nodes(_params: Dictionary) -> Array:
	"""Get currently selected nodes in the editor."""
	var selection := EditorInterface.get_selection()
	var selected := selection.get_selected_nodes()
	var result: Array = []
	for node in selected:
		result.append({
			"name": node.name,
			"type": node.get_class(),
			"path": str(node.get_path()),
		})
	return result


func get_node_properties(params: Dictionary) -> Dictionary:
	"""Get all properties of a node by path."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return {"error": "No scene open"}

	var path: String = params.get("path", "")
	var node := root.get_node_or_null(path)
	if not node:
		return {"error": "Node not found: %s" % path}

	var props: Dictionary = {}
	for prop in node.get_property_list():
		if prop.usage & PROPERTY_USAGE_EDITOR:
			props[prop.name] = _variant_to_json(node.get(prop.name))

	return {"name": node.name, "type": node.get_class(), "properties": props}


func set_node_property(params: Dictionary) -> Dictionary:
	"""Set a property on a node. Uses undo/redo for safety."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return {"error": "No scene open"}

	var path: String = params.get("path", "")
	var property: String = params.get("property", "")
	var value = params.get("value")

	var node := root.get_node_or_null(path)
	if not node:
		return {"error": "Node not found: %s" % path}

	# Use undo/redo manager for safe property changes
	var undo_redo := EditorInterface.get_editor_undo_redo()
	undo_redo.create_action("Forge: Set %s.%s" % [node.name, property])
	undo_redo.add_do_property(node, property, value)
	undo_redo.add_undo_property(node, property, node.get(property))
	undo_redo.commit_action()

	return {"ok": true, "node": str(node.get_path()), "property": property}


func add_child_node(params: Dictionary) -> Dictionary:
	"""Add a child node to the scene."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return {"error": "No scene open"}

	var parent_path: String = params.get("parent", ".")
	var node_type: String = params.get("type", "Node")
	var node_name: String = params.get("name", "NewNode")

	var parent := root if parent_path == "." else root.get_node_or_null(parent_path)
	if not parent:
		return {"error": "Parent not found: %s" % parent_path}

	var new_node := ClassDB.instantiate(node_type)
	if not new_node:
		return {"error": "Cannot instantiate type: %s" % node_type}

	new_node.name = node_name

	var undo_redo := EditorInterface.get_editor_undo_redo()
	undo_redo.create_action("Forge: Add %s" % node_name)
	undo_redo.add_do_method(parent, "add_child", new_node)
	undo_redo.add_do_method(new_node, "set_owner", root)
	undo_redo.add_do_reference(new_node)
	undo_redo.add_undo_method(parent, "remove_child", new_node)
	undo_redo.commit_action()

	return {"ok": true, "path": str(new_node.get_path())}


func remove_node(params: Dictionary) -> Dictionary:
	"""Remove a node from the scene."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return {"error": "No scene open"}

	var path: String = params.get("path", "")
	var node := root.get_node_or_null(path)
	if not node:
		return {"error": "Node not found: %s" % path}
	if node == root:
		return {"error": "Cannot remove root node"}

	var parent := node.get_parent()
	var undo_redo := EditorInterface.get_editor_undo_redo()
	undo_redo.create_action("Forge: Remove %s" % node.name)
	undo_redo.add_do_method(parent, "remove_child", node)
	undo_redo.add_undo_method(parent, "add_child", node)
	undo_redo.add_undo_method(node, "set_owner", root)
	undo_redo.add_undo_reference(node)
	undo_redo.commit_action()

	return {"ok": true, "removed": path}


func list_nodes_by_type(params: Dictionary) -> Array:
	"""Find all nodes of a given type in the current scene."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return []

	var type_name: String = params.get("type", "Node")
	var results: Array = []
	_find_by_type(root, type_name, results)
	return results


func list_nodes_by_group(params: Dictionary) -> Array:
	"""Find all nodes in a given group."""
	var root := EditorInterface.get_edited_scene_root()
	if not root:
		return []

	var group_name: String = params.get("group", "")
	var results: Array = []
	_find_by_group(root, group_name, results)
	return results


# ── Helpers ─────────────────────────────────────────────────────

func _serialize_node(node: Node) -> Dictionary:
	var data: Dictionary = {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path()),
	}

	if node.get_child_count() > 0:
		var children: Array = []
		for child in node.get_children():
			children.append(_serialize_node(child))
		data["children"] = children

	return data


func _find_by_type(node: Node, type_name: String, results: Array) -> void:
	if node.is_class(type_name):
		results.append({
			"name": node.name,
			"type": node.get_class(),
			"path": str(node.get_path()),
		})
	for child in node.get_children():
		_find_by_type(child, type_name, results)


func _find_by_group(node: Node, group_name: String, results: Array) -> void:
	if node.is_in_group(group_name):
		results.append({
			"name": node.name,
			"type": node.get_class(),
			"path": str(node.get_path()),
		})
	for child in node.get_children():
		_find_by_group(child, group_name, results)


func _variant_to_json(value) -> Variant:
	"""Convert a Godot Variant to JSON-safe value."""
	if value == null:
		return null
	if value is bool or value is int or value is float or value is String:
		return value
	if value is Vector2:
		return {"type": "Vector2", "x": value.x, "y": value.y}
	if value is Vector3:
		return {"type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
	if value is Color:
		return {"type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
	if value is Transform2D:
		return {"type": "Transform2D", "value": str(value)}
	if value is Transform3D:
		return {"type": "Transform3D", "value": str(value)}
	if value is NodePath:
		return {"type": "NodePath", "path": str(value)}
	if value is Array:
		var arr: Array = []
		for item in value:
			arr.append(_variant_to_json(item))
		return arr
	if value is Dictionary:
		var dict: Dictionary = {}
		for key in value:
			dict[str(key)] = _variant_to_json(value[key])
		return dict
	# Fallback
	return str(value)
