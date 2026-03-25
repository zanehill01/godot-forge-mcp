@tool
class_name ForgeServer
extends Node
## WebSocket JSON-RPC server for communication with the MCP server.

signal client_connected
signal client_disconnected
signal command_received(method: String, params: Dictionary)
signal status_changed(status: String)

const DEFAULT_PORT := 6100

var _server: TCPServer
var _clients: Array[StreamPeerTCP] = []
var _ws_clients: Array[WebSocketPeer] = []
var _port: int = DEFAULT_PORT
var _running := false
var _handlers: Dictionary = {}  # String -> handler object
var _last_command := ""
var _command_count := 0


func start(port: int = DEFAULT_PORT) -> void:
	_port = port
	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[Godot Forge] Failed to start server on port %d: %s" % [_port, error_string(err)])
		status_changed.emit("error")
		return

	_running = true
	status_changed.emit("listening")
	print("[Godot Forge] Server listening on 127.0.0.1:%d" % _port)


func stop() -> void:
	_running = false
	for ws in _ws_clients:
		ws.close()
	_ws_clients.clear()
	_clients.clear()
	if _server:
		_server.stop()
	status_changed.emit("stopped")


func register_handler(domain: String, handler: RefCounted) -> void:
	_handlers[domain] = handler


func get_client_count() -> int:
	return _ws_clients.size()


func get_last_command() -> String:
	return _last_command


func get_command_count() -> int:
	return _command_count


func is_running() -> bool:
	return _running


func _process(_delta: float) -> void:
	if not _running or not _server:
		return

	# Accept new TCP connections
	if _server.is_connection_available():
		var tcp := _server.take_connection()
		if tcp:
			var ws := WebSocketPeer.new()
			ws.accept_stream(tcp)
			_ws_clients.append(ws)
			_clients.append(tcp)
			client_connected.emit()
			status_changed.emit("connected")
			print("[Godot Forge] Client connected (%d total)" % _ws_clients.size())

	# Poll all WebSocket clients
	var to_remove: Array[int] = []
	for i in range(_ws_clients.size()):
		var ws := _ws_clients[i]
		ws.poll()

		var state := ws.get_ready_state()

		if state == WebSocketPeer.STATE_OPEN:
			while ws.get_available_packet_count() > 0:
				var packet := ws.get_packet()
				var text := packet.get_string_from_utf8()
				_handle_message(ws, text)
		elif state == WebSocketPeer.STATE_CLOSED:
			to_remove.append(i)

	# Remove disconnected clients (reverse order)
	for i in range(to_remove.size() - 1, -1, -1):
		var idx := to_remove[i]
		_ws_clients.remove_at(idx)
		_clients.remove_at(idx)
		client_disconnected.emit()
		if _ws_clients.is_empty():
			status_changed.emit("listening")
		print("[Godot Forge] Client disconnected (%d remaining)" % _ws_clients.size())


func _handle_message(ws: WebSocketPeer, text: String) -> void:
	var json := JSON.new()
	var err := json.parse(text)
	if err != OK:
		_send_error(ws, null, -32700, "Parse error")
		return

	var msg: Dictionary = json.data
	if not msg.has("method") or not msg.has("id"):
		_send_error(ws, msg.get("id"), -32600, "Invalid request")
		return

	var method: String = msg.get("method", "")
	var params: Dictionary = msg.get("params", {})
	var id = msg.get("id")

	_last_command = method
	_command_count += 1
	command_received.emit(method, params)

	# Route to handler — use call_deferred for thread safety
	var parts := method.split(".")
	if parts.size() < 2:
		_send_error(ws, id, -32601, "Method not found: %s (expected domain.method)" % method)
		return

	var domain := parts[0]
	var action := parts[1]

	if not _handlers.has(domain):
		_send_error(ws, id, -32601, "Unknown domain: %s" % domain)
		return

	var handler = _handlers[domain]
	if not handler.has_method(action):
		_send_error(ws, id, -32601, "Unknown method: %s.%s" % [domain, action])
		return

	# Execute on main thread via call_deferred
	var result = handler.call(action, params)
	_send_result(ws, id, result)


func _send_result(ws: WebSocketPeer, id, result) -> void:
	var response := {
		"jsonrpc": "2.0",
		"id": id,
		"result": result
	}
	ws.send_text(JSON.stringify(response))


func _send_error(ws: WebSocketPeer, id, code: int, message: String) -> void:
	var response := {
		"jsonrpc": "2.0",
		"id": id,
		"error": {
			"code": code,
			"message": message
		}
	}
	ws.send_text(JSON.stringify(response))
