@tool
extends EditorPlugin

const DOCK_SCENE = preload("res://addons/godot_forge/dock/forge_dock.tscn")

var forge_server: ForgeServer
var dock: Control


func _enter_tree() -> void:
	forge_server = ForgeServer.new()
	add_child(forge_server)

	# Register handlers
	forge_server.register_handler("scene", preload("res://addons/godot_forge/handlers/scene_handler.gd").new())
	forge_server.register_handler("editor", preload("res://addons/godot_forge/handlers/editor_handler.gd").new())
	forge_server.register_handler("debug", preload("res://addons/godot_forge/handlers/debug_handler.gd").new())
	forge_server.register_handler("script", preload("res://addons/godot_forge/handlers/script_handler.gd").new())
	forge_server.register_handler("input", preload("res://addons/godot_forge/handlers/input_handler.gd").new())

	# Create dock
	dock = DOCK_SCENE.instantiate()
	dock.setup(forge_server)
	add_control_to_bottom_panel(dock, "Forge")

	# Start server
	forge_server.start()
	print("[Godot Forge] Plugin loaded")


func _exit_tree() -> void:
	if forge_server:
		forge_server.stop()
		forge_server.queue_free()

	if dock:
		remove_control_from_bottom_panel(dock)
		dock.queue_free()

	print("[Godot Forge] Plugin unloaded")
