@tool
extends PanelContainer

var _server: ForgeServer
var _status_label: Label
var _clients_label: Label
var _commands_label: Label
var _last_cmd_label: Label
var _toggle_button: Button


func setup(server: ForgeServer) -> void:
	_server = server
	_server.status_changed.connect(_on_status_changed)
	_server.client_connected.connect(_on_client_changed)
	_server.client_disconnected.connect(_on_client_changed)
	_server.command_received.connect(_on_command_received)


func _ready() -> void:
	# Build UI
	var vbox := VBoxContainer.new()
	add_child(vbox)

	# Header
	var header := Label.new()
	header.text = "Godot Forge MCP"
	header.add_theme_font_size_override("font_size", 16)
	vbox.add_child(header)

	var sep := HSeparator.new()
	vbox.add_child(sep)

	# Status
	var status_hbox := HBoxContainer.new()
	var status_title := Label.new()
	status_title.text = "Status: "
	status_hbox.add_child(status_title)
	_status_label = Label.new()
	_status_label.text = "Starting..."
	status_hbox.add_child(_status_label)
	vbox.add_child(status_hbox)

	# Clients
	var clients_hbox := HBoxContainer.new()
	var clients_title := Label.new()
	clients_title.text = "Clients: "
	clients_hbox.add_child(clients_title)
	_clients_label = Label.new()
	_clients_label.text = "0"
	clients_hbox.add_child(_clients_label)
	vbox.add_child(clients_hbox)

	# Commands
	var cmds_hbox := HBoxContainer.new()
	var cmds_title := Label.new()
	cmds_title.text = "Commands: "
	cmds_hbox.add_child(cmds_title)
	_commands_label = Label.new()
	_commands_label.text = "0"
	cmds_hbox.add_child(_commands_label)
	vbox.add_child(cmds_hbox)

	# Last command
	var last_hbox := HBoxContainer.new()
	var last_title := Label.new()
	last_title.text = "Last: "
	last_hbox.add_child(last_title)
	_last_cmd_label = Label.new()
	_last_cmd_label.text = "—"
	last_hbox.add_child(_last_cmd_label)
	vbox.add_child(last_hbox)

	var sep2 := HSeparator.new()
	vbox.add_child(sep2)

	# Toggle button
	_toggle_button = Button.new()
	_toggle_button.text = "Stop Server"
	_toggle_button.pressed.connect(_on_toggle_pressed)
	vbox.add_child(_toggle_button)


func _on_status_changed(status: String) -> void:
	if _status_label:
		_status_label.text = status
	if _toggle_button:
		_toggle_button.text = "Start Server" if status == "stopped" else "Stop Server"


func _on_client_changed() -> void:
	if _clients_label and _server:
		_clients_label.text = str(_server.get_client_count())


func _on_command_received(method: String, _params: Dictionary) -> void:
	if _commands_label and _server:
		_commands_label.text = str(_server.get_command_count())
	if _last_cmd_label:
		_last_cmd_label.text = method


func _on_toggle_pressed() -> void:
	if not _server:
		return
	if _server.is_running():
		_server.stop()
	else:
		_server.start()
