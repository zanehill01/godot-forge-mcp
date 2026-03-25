@tool
extends RefCounted
## Handles input injection for testing.

func inject_key(params: Dictionary) -> Dictionary:
	"""Inject a key press event."""
	var keycode: int = params.get("keycode", 0)
	var pressed: bool = params.get("pressed", true)
	var shift: bool = params.get("shift", false)
	var ctrl: bool = params.get("ctrl", false)
	var alt: bool = params.get("alt", false)

	var event := InputEventKey.new()
	event.keycode = keycode
	event.pressed = pressed
	event.shift_pressed = shift
	event.ctrl_pressed = ctrl
	event.alt_pressed = alt

	Input.parse_input_event(event)
	return {"ok": true, "type": "key", "keycode": keycode}


func inject_mouse_button(params: Dictionary) -> Dictionary:
	"""Inject a mouse button event."""
	var button: int = params.get("button", MOUSE_BUTTON_LEFT)
	var pressed: bool = params.get("pressed", true)
	var position_x: float = params.get("x", 0.0)
	var position_y: float = params.get("y", 0.0)

	var event := InputEventMouseButton.new()
	event.button_index = button
	event.pressed = pressed
	event.position = Vector2(position_x, position_y)

	Input.parse_input_event(event)
	return {"ok": true, "type": "mouse_button", "button": button}


func inject_mouse_motion(params: Dictionary) -> Dictionary:
	"""Inject a mouse motion event."""
	var relative_x: float = params.get("dx", 0.0)
	var relative_y: float = params.get("dy", 0.0)
	var position_x: float = params.get("x", 0.0)
	var position_y: float = params.get("y", 0.0)

	var event := InputEventMouseMotion.new()
	event.relative = Vector2(relative_x, relative_y)
	event.position = Vector2(position_x, position_y)

	Input.parse_input_event(event)
	return {"ok": true, "type": "mouse_motion"}


func inject_action(params: Dictionary) -> Dictionary:
	"""Inject an input action (press/release)."""
	var action: String = params.get("action", "")
	var pressed: bool = params.get("pressed", true)
	var strength: float = params.get("strength", 1.0)

	if action.is_empty():
		return {"error": "No action provided"}

	if not InputMap.has_action(action):
		return {"error": "Unknown action: %s" % action}

	if pressed:
		Input.action_press(action, strength)
	else:
		Input.action_release(action)

	return {"ok": true, "type": "action", "action": action, "pressed": pressed}
