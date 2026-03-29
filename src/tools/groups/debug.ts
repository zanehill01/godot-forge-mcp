/**
 * Debug Tool Group — Single unified tool for live debugging.
 *
 * Two modes of operation:
 * 1. **Editor Plugin (Socket Bridge)** — Full real-time access via WebSocket (screenshots, input injection, etc.)
 * 2. **CLI Fallback** — When plugin is unavailable, uses Godot CLI for screenshots and headless inspection.
 *
 * All actions gracefully degrade: plugin first, then CLI fallback, then helpful error message.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { SocketBridge } from "../../bridges/socket-bridge.js";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

let socketBridge: SocketBridge | null = null;

function getSocket(): SocketBridge {
	if (!socketBridge) {
		socketBridge = new SocketBridge();
	}
	return socketBridge;
}

function pluginConnected(): boolean {
	try {
		return socketBridge?.isConnected() ?? false;
	} catch {
		return false;
	}
}

export function registerDebugTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_debug",
		`Debug and inspection tool. Works with or without the editor plugin.

Actions:
• screenshot — Capture viewport. Falls back to CLI --dump-render if plugin unavailable.
    viewport?: "editor"|"game" (default "editor"), outputPath? (res:// path to save .png)

• performance — Get real-time FPS, memory, render, physics metrics. Requires plugin.

• scene_tree — Get live scene tree from editor or running game. Falls back to parsing .tscn files.
    source?: "editor"|"running" (default "editor"), scenePath? (for file-based fallback)

• inspect_node — Inspect a node's properties live. Falls back to reading scene file.
    nodePath (required), scenePath? (for file-based fallback)

• set_property — Set a node property with undo support. Requires plugin.
    nodePath (required), property (required), value (required)

• input — Inject input events into the running game.
    inputType (required: key|mouse_button|mouse_motion|action), key?, button?, position?, inputAction?, pressed?

• editor_state — Get editor state: open scenes, selected nodes, active script. Requires plugin.

• save_state — Serialize a scene's node tree to a JSON snapshot for checkpointing.
    scenePath (required), outputPath (required, res:// .json path)

• load_state — Restore a node tree from a JSON snapshot.
    snapshotPath (required, res:// .json path), scenePath (required, target .tscn to overwrite)`,
		{
			action: z.enum(["screenshot", "performance", "scene_tree", "inspect_node", "set_property", "input", "editor_state", "save_state", "load_state"]),
			viewport: z.enum(["editor", "game"]).optional().default("editor"),
			source: z.enum(["editor", "running"]).optional().default("editor"),
			scenePath: z.string().optional().describe("Scene path for file-based fallback (res://)"),
			outputPath: z.string().optional().describe("Output file path (res://)"),
			snapshotPath: z.string().optional().describe("JSON snapshot path (res://)"),
			nodePath: z.string().optional().describe("Node path e.g. 'Player', 'Level/Enemies/Boss'"),
			property: z.string().optional(),
			value: z.any().optional(),
			inputType: z.enum(["key", "mouse_button", "mouse_motion", "action"]).optional(),
			key: z.string().optional(),
			button: z.number().optional(),
			position: z.object({ x: z.number(), y: z.number() }).optional(),
			inputAction: z.string().optional(),
			pressed: z.boolean().optional().default(true),
		},
		async (args) => {
			try {
				switch (args.action) {
					// ── screenshot ─────────────────────────────────────────
					case "screenshot": {
						// Try plugin first
						if (pluginConnected()) {
							const socket = getSocket();
							const result = await socket.screenshot() as { image?: string; width?: number; height?: number; error?: string };
							if (result?.image) {
								return {
									content: [
										{ type: "image" as const, data: result.image, mimeType: "image/png" },
										{ type: "text" as const, text: `Screenshot captured (${result.width ?? "?"}x${result.height ?? "?"})` },
									],
								};
							}
						}

						// CLI fallback: render one frame and capture
						if (!ctx.godotBinary) {
							return { content: [{ type: "text" as const, text: "Screenshot requires either the editor plugin or a Godot binary. Neither is available." }], isError: true };
						}

						const outFile = args.outputPath
							? resToAbsolute(args.outputPath, ctx.projectRoot)
							: join(ctx.projectRoot, `.godot_forge_screenshot_${randomBytes(4).toString("hex")}.png`);

						mkdirSync(dirname(outFile), { recursive: true });

						// Use Godot's --dump-render to capture a frame
						const scriptCode = `extends SceneTree
func _init():
\tvar img := get_viewport().get_texture().get_image()
\timg.save_png("${outFile.replace(/\\/g, "/")}")
\tprint("SCREENSHOT_SAVED")
\tquit()
`;
						const tmpScript = join(ctx.projectRoot, `.godot_forge_tmp_ss_${randomBytes(4).toString("hex")}.gd`);
						writeFileSync(tmpScript, scriptCode, "utf-8");

						return new Promise((resolve) => {
							const proc = spawn(ctx.godotBinary!, ["--headless", "--path", ctx.projectRoot, "-s", tmpScript], {
								cwd: ctx.projectRoot, stdio: "pipe",
							});
							const timer = setTimeout(() => proc.kill(), 15000);
							proc.on("close", () => {
								clearTimeout(timer);
								try { unlinkSync(tmpScript); } catch { /* ignore */ }
								if (existsSync(outFile)) {
									const imgData = readFileSync(outFile).toString("base64");
									if (!args.outputPath) { try { unlinkSync(outFile); } catch { /* ignore */ } }
									resolve({
										content: [
											{ type: "image" as const, data: imgData, mimeType: "image/png" },
											{ type: "text" as const, text: `Screenshot captured via CLI fallback${args.outputPath ? ` → ${args.outputPath}` : ""}` },
										],
									});
								} else {
									resolve({ content: [{ type: "text" as const, text: "Screenshot capture failed — viewport may not have rendered content in headless mode. Try with the editor plugin for game viewport screenshots." }], isError: true });
								}
							});
							proc.on("error", (err) => {
								clearTimeout(timer);
								try { unlinkSync(tmpScript); } catch { /* ignore */ }
								resolve({ content: [{ type: "text" as const, text: `Screenshot failed: ${err.message}` }], isError: true });
							});
						});
					}

					// ── performance ────────────────────────────────────────
					case "performance": {
						if (!pluginConnected()) {
							return { content: [{ type: "text" as const, text: "Performance metrics require the editor plugin. Start Godot with the Godot Forge plugin enabled." }], isError: true };
						}
						const result = await getSocket().getPerformance();
						return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
					}

					// ── scene_tree ─────────────────────────────────────────
					case "scene_tree": {
						// Plugin mode
						if (pluginConnected()) {
							const socket = getSocket();
							const result = args.source === "running"
								? await socket.getRunningSceneTree()
								: await socket.getSceneTree();
							return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
						}

						// File fallback: parse .tscn
						const scenePath = args.scenePath;
						if (!scenePath) {
							// List all scenes with their node trees
							const scenes = ctx.getAssetManager().byCategory("scene");
							const trees: Array<{ scene: string; root: string; nodeCount: number }> = [];
							for (const s of scenes.slice(0, 20)) {
								try {
									const doc = parseTscn(readFileSync(s.absPath, "utf-8"));
									trees.push({
										scene: s.resPath,
										root: doc.nodes[0]?.type ?? "unknown",
										nodeCount: doc.nodes.length,
									});
								} catch { /* skip */ }
							}
							return { content: [{ type: "text" as const, text: JSON.stringify(trees, null, 2) }] };
						}

						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const tree = doc.nodes.map((n) => ({
							name: n.name,
							type: n.type,
							parent: n.parent ?? "(root)",
							properties: Object.keys(n.properties),
						}));
						return { content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }] };
					}

					// ── inspect_node ───────────────────────────────────────
					case "inspect_node": {
						if (!args.nodePath) {
							return { content: [{ type: "text" as const, text: "nodePath required" }], isError: true };
						}

						// Plugin mode
						if (pluginConnected()) {
							const result = await getSocket().getNodeProperties(args.nodePath);
							return { content: [{ type: "text" as const, text: JSON.stringify({ nodePath: args.nodePath, properties: result }, null, 2) }] };
						}

						// File fallback
						if (!args.scenePath) {
							return { content: [{ type: "text" as const, text: "Without the editor plugin, scenePath is required for inspect_node" }], isError: true };
						}
						const absPath2 = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc2 = parseTscn(readFileSync(absPath2, "utf-8"));
						const node = doc2.nodes.find((n) =>
							n.name === args.nodePath ||
							(n.parent === "." ? n.name : `${n.parent}/${n.name}`) === args.nodePath
						);
						if (!node) {
							return { content: [{ type: "text" as const, text: `Node "${args.nodePath}" not found in ${args.scenePath}` }], isError: true };
						}
						return { content: [{ type: "text" as const, text: JSON.stringify({ name: node.name, type: node.type, parent: node.parent, properties: node.properties }, null, 2) }] };
					}

					// ── set_property ───────────────────────────────────────
					case "set_property": {
						if (!args.nodePath || !args.property || args.value === undefined) {
							return { content: [{ type: "text" as const, text: "nodePath, property, and value required" }], isError: true };
						}
						if (!pluginConnected()) {
							return { content: [{ type: "text" as const, text: "set_property requires the editor plugin for undo/redo support. Use godot_scene(action: 'modify_node') for file-based property changes." }], isError: true };
						}
						const result = await getSocket().setNodeProperty(args.nodePath, args.property, args.value);
						return { content: [{ type: "text" as const, text: JSON.stringify({ nodePath: args.nodePath, property: args.property, value: args.value, result }, null, 2) }] };
					}

					// ── input ──────────────────────────────────────────────
					case "input": {
						if (!args.inputType) {
							return { content: [{ type: "text" as const, text: "inputType required" }], isError: true };
						}

						// Plugin mode (preferred)
						if (pluginConnected()) {
							const params: Record<string, unknown> = { pressed: args.pressed };
							switch (args.inputType) {
								case "key":
									if (!args.key) return { content: [{ type: "text" as const, text: "key required for key input" }], isError: true };
									params.key = args.key;
									break;
								case "mouse_button":
									params.button = args.button ?? 1;
									params.position = args.position ?? { x: 0, y: 0 };
									break;
								case "mouse_motion":
									params.position = args.position ?? { x: 0, y: 0 };
									break;
								case "action":
									if (!args.inputAction) return { content: [{ type: "text" as const, text: "inputAction required for action input" }], isError: true };
									params.action = args.inputAction;
									break;
							}
							const result = await getSocket().injectInput(args.inputType, params);
							return { content: [{ type: "text" as const, text: JSON.stringify({ injected: { type: args.inputType, ...params }, result }, null, 2) }] };
						}

						// CLI fallback: generate a script that sends the input
						if (!ctx.godotBinary) {
							return { content: [{ type: "text" as const, text: "Input injection requires either the editor plugin or a Godot binary." }], isError: true };
						}

						let inputCode = "";
						switch (args.inputType) {
							case "key":
								inputCode = `var ev := InputEventKey.new()\nev.keycode = KEY_${(args.key ?? "SPACE").toUpperCase()}\nev.pressed = ${args.pressed}\nInput.parse_input_event(ev)`;
								break;
							case "action":
								inputCode = `var ev := InputEventAction.new()\nev.action = "${args.inputAction ?? "ui_accept"}"\nev.pressed = ${args.pressed}\nInput.parse_input_event(ev)`;
								break;
							case "mouse_button":
								inputCode = `var ev := InputEventMouseButton.new()\nev.button_index = ${args.button ?? 1}\nev.pressed = ${args.pressed}\nev.position = Vector2(${args.position?.x ?? 0}, ${args.position?.y ?? 0})\nInput.parse_input_event(ev)`;
								break;
							case "mouse_motion":
								inputCode = `var ev := InputEventMouseMotion.new()\nev.position = Vector2(${args.position?.x ?? 0}, ${args.position?.y ?? 0})\nInput.parse_input_event(ev)`;
								break;
						}
						return { content: [{ type: "text" as const, text: `Input injection code (paste into running game or autoload):\n\n${inputCode}` }] };
					}

					// ── editor_state ───────────────────────────────────────
					case "editor_state": {
						if (!pluginConnected()) {
							return { content: [{ type: "text" as const, text: "editor_state requires the editor plugin." }], isError: true };
						}
						const socket = getSocket();
						const [state, selected] = await Promise.all([
							socket.getEditorState(),
							socket.getSelectedNodes(),
						]);
						return { content: [{ type: "text" as const, text: JSON.stringify({ editorState: state, selectedNodes: selected }, null, 2) }] };
					}

					// ── save_state ─────────────────────────────────────────
					case "save_state": {
						if (!args.scenePath || !args.outputPath) {
							return { content: [{ type: "text" as const, text: "scenePath and outputPath required" }], isError: true };
						}
						const absScene = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absScene, "utf-8"));

						const snapshot = {
							source: args.scenePath,
							timestamp: new Date().toISOString(),
							nodes: doc.nodes.map((n) => ({
								name: n.name,
								type: n.type,
								parent: n.parent,
								properties: n.properties,
							})),
							subResources: doc.subResources,
							extResources: doc.extResources,
							connections: doc.connections,
						};

						const absOut = resToAbsolute(args.outputPath, ctx.projectRoot);
						mkdirSync(dirname(absOut), { recursive: true });
						writeFileSync(absOut, JSON.stringify(snapshot, null, 2), "utf-8");
						return { content: [{ type: "text" as const, text: `Saved state snapshot of ${args.scenePath} (${doc.nodes.length} nodes) → ${args.outputPath}` }] };
					}

					// ── load_state ─────────────────────────────────────────
					case "load_state": {
						if (!args.snapshotPath || !args.scenePath) {
							return { content: [{ type: "text" as const, text: "snapshotPath and scenePath required" }], isError: true };
						}
						const absSnap = resToAbsolute(args.snapshotPath, ctx.projectRoot);
						if (!existsSync(absSnap)) {
							return { content: [{ type: "text" as const, text: `Snapshot not found: ${args.snapshotPath}` }], isError: true };
						}
						const snapshot = JSON.parse(readFileSync(absSnap, "utf-8"));
						const absTarget = resToAbsolute(args.scenePath, ctx.projectRoot);
						const targetDoc = parseTscn(readFileSync(absTarget, "utf-8"));

						// Replace nodes, sub_resources, and connections from snapshot
						targetDoc.nodes = snapshot.nodes;
						if (snapshot.subResources) targetDoc.subResources = snapshot.subResources;
						if (snapshot.connections) targetDoc.connections = snapshot.connections;

						const { writeTscn } = await import("../../parsers/tscn/writer.js");
						writeFileSync(absTarget, writeTscn(targetDoc), "utf-8");
						return { content: [{ type: "text" as const, text: `Restored ${snapshot.nodes.length} nodes from ${args.snapshotPath} → ${args.scenePath}` }] };
					}

					default:
						return { content: [{ type: "text" as const, text: `Unknown action: ${args.action}` }], isError: true };
				}
			} catch (e) {
				return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}
