/**
 * Debug Tool Group — Single unified tool for live debugging via the editor plugin.
 *
 * All actions require the editor plugin (Socket Bridge) to be connected.
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
	server.tool(
		"godot_debug",
		`Unified debug tool for the Godot editor plugin. Dispatches by action.

Actions and their parameters:
  screenshot   — Capture editor/game viewport. viewport?: "editor"|"game" (default "editor")
  performance  — Get real-time performance metrics (FPS, memory, render, physics). No extra params.
  scene_tree   — Get live scene tree. source?: "editor"|"running" (default "editor")
  inspect_node — Inspect a node's properties. nodePath: string (required)
  set_property — Set a node property (with undo support). nodePath: string, property: string, value: any (all required)
  input        — Inject input into the running game. inputType: "key"|"mouse_button"|"mouse_motion"|"action", key?: string, button?: number, position?: {x,y}, inputAction?: string, pressed?: boolean (default true)
  editor_state — Get editor state: open scenes, selected nodes, active script. No extra params.`,
		{
			action: z.enum(["screenshot", "performance", "scene_tree", "inspect_node", "set_property", "input", "editor_state"]).describe("The debug action to perform"),
			viewport: z.enum(["editor", "game"]).optional().default("editor").describe("Which viewport to capture (screenshot action)"),
			source: z.enum(["editor", "running"]).optional().default("editor").describe("Get tree from editor or running game (scene_tree action)"),
			nodePath: z.string().optional().describe("Path to the node in the scene tree, e.g. 'Player', 'Level/Enemies/Boss' (inspect_node, set_property actions)"),
			property: z.string().optional().describe("Property name, e.g. 'position', 'visible', 'modulate' (set_property action)"),
			value: z.any().optional().describe("New value for the property (set_property action)"),
			inputType: z.enum(["key", "mouse_button", "mouse_motion", "action"]).optional().describe("Input event type (input action)"),
			key: z.string().optional().describe("Key name for 'key' inputType, e.g. 'space', 'w', 'escape'"),
			button: z.number().optional().describe("Mouse button index for 'mouse_button' inputType (1=left, 2=right, 3=middle)"),
			position: z.object({ x: z.number(), y: z.number() }).optional().describe("Position for mouse events"),
			inputAction: z.string().optional().describe("Action name for 'action' inputType, e.g. 'ui_accept', 'move_left'"),
			pressed: z.boolean().optional().default(true).describe("Whether the input is a press (true) or release (false)"),
		},
		async ({ action, viewport, source, nodePath, property, value, inputType, key, button, position, inputAction, pressed }) => {
			try {
				const socket = requireConnection(ctx);

				switch (action) {
					case "screenshot": {
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
					}

					case "performance": {
						const result = await socket.getPerformance();
						return {
							content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						};
					}

					case "scene_tree": {
						const result = source === "running"
							? await socket.getRunningSceneTree()
							: await socket.getSceneTree();
						return {
							content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						};
					}

					case "inspect_node": {
						if (!nodePath) {
							return { content: [{ type: "text", text: "Missing required 'nodePath' parameter for inspect_node" }], isError: true };
						}
						const result = await socket.getNodeProperties(nodePath);
						return {
							content: [{ type: "text", text: JSON.stringify({ nodePath, properties: result }, null, 2) }],
						};
					}

					case "set_property": {
						if (!nodePath) {
							return { content: [{ type: "text", text: "Missing required 'nodePath' parameter for set_property" }], isError: true };
						}
						if (!property) {
							return { content: [{ type: "text", text: "Missing required 'property' parameter for set_property" }], isError: true };
						}
						if (value === undefined) {
							return { content: [{ type: "text", text: "Missing required 'value' parameter for set_property" }], isError: true };
						}
						const result = await socket.setNodeProperty(nodePath, property, value);
						return {
							content: [{ type: "text", text: JSON.stringify({ nodePath, property, value, result }, null, 2) }],
						};
					}

					case "input": {
						if (!inputType) {
							return { content: [{ type: "text", text: "Missing required 'inputType' parameter for input action" }], isError: true };
						}

						const params: Record<string, unknown> = { pressed };

						switch (inputType) {
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
								if (!inputAction) return { content: [{ type: "text", text: "Missing 'inputAction' parameter for action input" }], isError: true };
								params.action = inputAction;
								break;
						}

						const result = await socket.injectInput(inputType, params);
						return {
							content: [{ type: "text", text: JSON.stringify({ injected: { type: inputType, ...params }, result }, null, 2) }],
						};
					}

					case "editor_state": {
						const [state, selected] = await Promise.all([
							socket.getEditorState(),
							socket.getSelectedNodes(),
						]);
						return {
							content: [{ type: "text", text: JSON.stringify({ editorState: state, selectedNodes: selected }, null, 2) }],
						};
					}
				}
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}
