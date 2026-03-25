/**
 * Debug Tool Group — 7 tools for live debugging via the editor plugin.
 *
 * All tools require the editor plugin (Socket Bridge) to be connected.
 * They communicate with the GDScript handlers in the editor plugin:
 * - debug_handler.gd: screenshots, performance, running scene tree
 * - input_handler.gd: input injection for testing
 * - editor_handler.gd: editor state
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SocketBridge } from "../../bridges/socket-bridge.js";
import type { ToolContext } from "../registry.js";

let socketBridge: SocketBridge | null = null;

function getSocket(ctx: ToolContext): SocketBridge {
	if (!socketBridge) {
		socketBridge = new SocketBridge();
	}
	return socketBridge;
}

function requireConnection(ctx: ToolContext): SocketBridge {
	const socket = getSocket(ctx);
	if (!socket.isConnected()) {
		throw new Error(
			"Editor plugin not connected. Start Godot with the Godot Forge plugin enabled, then try again.",
		);
	}
	return socket;
}

export function registerDebugTools(server: McpServer, ctx: ToolContext): void {
	// ── godot_debug_screenshot ────────────────────────────────
	server.tool(
		"godot_debug_screenshot",
		"Capture a screenshot of the Godot editor viewport. Returns a base64-encoded PNG image. Useful for visual debugging and verifying scene setup.",
		{
			viewport: z
				.enum(["editor", "game"])
				.optional()
				.default("editor")
				.describe("Which viewport to capture"),
		},
		async ({ viewport }) => {
			try {
				const socket = requireConnection(ctx);
				const result = await socket.screenshot() as { image?: string; width?: number; height?: number; error?: string };

				if (result?.error) {
					return { content: [{ type: "text", text: `Screenshot failed: ${result.error}` }], isError: true };
				}

				if (result?.image) {
					return {
						content: [
							{
								type: "image",
								data: result.image,
								mimeType: "image/png",
							},
							{
								type: "text",
								text: `Screenshot captured (${result.width ?? "?"}x${result.height ?? "?"})`,
							},
						],
					};
				}

				return {
					content: [{
						type: "text",
						text: JSON.stringify({ viewport, result }, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ── godot_debug_performance ───────────────────────────────
	server.tool(
		"godot_debug_performance",
		"Get real-time performance metrics from the running Godot editor: FPS, frame time, memory usage, render stats, physics stats.",
		{},
		async () => {
			try {
				const socket = requireConnection(ctx);
				const result = await socket.getPerformance();
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ── godot_debug_scene_tree ────────────────────────────────
	server.tool(
		"godot_debug_scene_tree",
		"Get the live scene tree from the running game or editor. Shows all nodes, their types, properties, and hierarchy. Essential for understanding the current scene state.",
		{
			source: z
				.enum(["editor", "running"])
				.optional()
				.default("editor")
				.describe("Get tree from the editor scene or the running game"),
		},
		async ({ source }) => {
			try {
				const socket = requireConnection(ctx);
				const result = source === "running"
					? await socket.getRunningSceneTree()
					: await socket.getSceneTree();
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ── godot_debug_inspect_node ──────────────────────────────
	server.tool(
		"godot_debug_inspect_node",
		"Inspect a specific node in the editor scene tree. Returns all properties and their current values.",
		{
			nodePath: z.string().describe("Path to the node in the scene tree (e.g., 'Player', 'Level/Enemies/Boss')"),
		},
		async ({ nodePath }) => {
			try {
				const socket = requireConnection(ctx);
				const result = await socket.getNodeProperties(nodePath);
				return {
					content: [{ type: "text", text: JSON.stringify({ nodePath, properties: result }, null, 2) }],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ── godot_debug_set_property ──────────────────────────────
	server.tool(
		"godot_debug_set_property",
		"Set a property on a node in the editor scene tree. Changes are applied with undo/redo support.",
		{
			nodePath: z.string().describe("Path to the node"),
			property: z.string().describe("Property name (e.g., 'position', 'visible', 'modulate')"),
			value: z.any().describe("New value for the property"),
		},
		async ({ nodePath, property, value }) => {
			try {
				const socket = requireConnection(ctx);
				const result = await socket.setNodeProperty(nodePath, property, value);
				return {
					content: [{ type: "text", text: JSON.stringify({ nodePath, property, value, result }, null, 2) }],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ── godot_debug_input ─────────────────────────────────────
	server.tool(
		"godot_debug_input",
		"Inject input events into the running Godot game for testing. Simulate key presses, mouse clicks, and touch events.",
		{
			type: z.enum(["key", "mouse_button", "mouse_motion", "action"]).describe("Input event type"),
			key: z.string().optional().describe("Key name for 'key' type (e.g., 'space', 'w', 'escape')"),
			button: z.number().optional().describe("Mouse button index for 'mouse_button' type (1=left, 2=right, 3=middle)"),
			position: z.object({ x: z.number(), y: z.number() }).optional().describe("Position for mouse events"),
			action: z.string().optional().describe("Action name for 'action' type (e.g., 'ui_accept', 'move_left')"),
			pressed: z.boolean().optional().default(true).describe("Whether the input is a press (true) or release (false)"),
		},
		async ({ type, key, button, position, action, pressed }) => {
			try {
				const socket = requireConnection(ctx);
				const params: Record<string, unknown> = { pressed };

				switch (type) {
					case "key":
						if (!key) return { content: [{ type: "text", text: "Missing 'key' parameter for key input" }], isError: true };
						params.key = key;
						break;
					case "mouse_button":
						params.button = button ?? 1;
						params.position = position ?? { x: 0, y: 0 };
						break;
					case "mouse_motion":
						params.position = position ?? { x: 0, y: 0 };
						break;
					case "action":
						if (!action) return { content: [{ type: "text", text: "Missing 'action' parameter for action input" }], isError: true };
						params.action = action;
						break;
				}

				const result = await socket.injectInput(type, params);
				return {
					content: [{ type: "text", text: JSON.stringify({ injected: { type, ...params }, result }, null, 2) }],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ── godot_debug_editor_state ──────────────────────────────
	server.tool(
		"godot_debug_editor_state",
		"Get the current state of the Godot editor: open scenes, selected nodes, active script, editor settings.",
		{},
		async () => {
			try {
				const socket = requireConnection(ctx);
				const [state, selected] = await Promise.all([
					socket.getEditorState(),
					socket.getSelectedNodes(),
				]);
				return {
					content: [{ type: "text", text: JSON.stringify({ editorState: state, selectedNodes: selected }, null, 2) }],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}
