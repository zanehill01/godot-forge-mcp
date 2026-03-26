/**
 * Game Essentials Tool Group — Core tools for video game development.
 *
 * SpriteFrames, input binding, Camera2D, resource creation (Curve, Gradient,
 * StyleBox, AudioBusLayout), 2D scene tools (parallax, lights), multiplayer
 * nodes, and scene validation. All write real .tscn/.tres data.
 *
 * Consolidated into a single "godot_game" tool dispatched by action.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerGameEssentialsTools(server: McpServer, ctx: ToolContext): void {

	server.tool(
		"godot_game",
		`Game essentials multi-tool. Actions and their params:

• sprite_frames — Create a SpriteFrames .tres resource for AnimatedSprite2D.
    path (string, required): Output .tres path (res://)
    animations (array, required): [{name, speed?, loop?, frames: [{texture, regionEnabled?, regionX?, regionY?, regionW?, regionH?}]}]

• bind_input — Bind input events to input actions in project.godot.
    inputAction (string, required): Input action name (e.g., move_left, jump)
    events (array, required): [{type: "key"|"gamepad_button"|"gamepad_axis"|"mouse_button", key?, button?, axis?, axisValue?, mouseButton?}]
    deadzone (number, optional): Default 0.5

• camera2d — Add a Camera2D node to a scene.
    scenePath (string, required), parent?, name?, current?, zoom?, smoothingEnabled?, smoothingSpeed?, dragHEnabled?, dragVEnabled?, limitLeft?, limitTop?, limitRight?, limitBottom?, limitSmoothed?

• validate_scene — Validate a .tscn scene for common errors.
    scenePath (string, required): Scene to validate (res://)

• curve — Create a Curve .tres resource.
    path (string, required), points (array, required): [{x, y, leftTangent?, rightTangent?}], minValue?, maxValue?

• gradient — Create a Gradient .tres resource.
    path (string, required), colors (array of strings, required), offsets? (array of numbers)

• audio_bus_layout — Create an AudioBusLayout .tres resource.
    path (string, required), buses (array, required): [{name, solo?, mute?, volumeDb?, sendTo?, effects?: [{type, enabled?}]}]

• parallax — Add a ParallaxBackground with layers to a 2D scene.
    scenePath (string, required), parent?, layers (array, required): [{name, texturePath, motionScale?, motionOffset?, mirroring?}]

• light2d — Add a PointLight2D or DirectionalLight2D to a scene.
    scenePath (string, required), parent?, name?, lightType?, color?, energy?, texturePath?, textureScale?, blendMode?, shadowEnabled?, transform?

• stylebox — Create a StyleBoxFlat .tres resource.
    path (string, required), bgColor?, borderColor?, borderWidth?, cornerRadius?, contentMargin?, shadowColor?, shadowSize?, shadowOffset?

• multiplayer — Add MultiplayerSpawner/Synchronizer nodes.
    scenePath (string, required), parent?, addSpawner?, spawnerScenes?, addSynchronizer?, syncProperties?

• check_integrity — Scan all project scenes for broken references and structural issues.
    (no additional params)`,
		{
			action: z.enum([
				"sprite_frames", "bind_input", "camera2d", "validate_scene",
				"curve", "gradient", "audio_bus_layout", "parallax",
				"light2d", "stylebox", "multiplayer", "check_integrity",
			]).describe("Which game-essentials action to run"),

			// sprite_frames params
			path: z.string().optional().describe("Output .tres path (res://) — used by sprite_frames, curve, gradient, audio_bus_layout, stylebox"),
			animations: z.array(z.object({
				name: z.string().describe("Animation name (e.g., idle, run, jump)"),
				speed: z.number().optional().default(8).describe("Frames per second"),
				loop: z.boolean().optional().default(true),
				frames: z.array(z.object({
					texture: z.string().describe("Texture path (res://)"),
					regionEnabled: z.boolean().optional().default(false),
					regionX: z.number().optional().describe("Atlas region X"),
					regionY: z.number().optional().describe("Atlas region Y"),
					regionW: z.number().optional().describe("Atlas region width"),
					regionH: z.number().optional().describe("Atlas region height"),
				})),
			})).optional().describe("Animations for sprite_frames"),

			// bind_input params
			inputAction: z.string().optional().describe("Input action name for bind_input (e.g., move_left, jump, attack)"),
			events: z.array(z.object({
				type: z.enum(["key", "gamepad_button", "gamepad_axis", "mouse_button"]),
				key: z.string().optional().describe("Key name for keyboard (e.g., W, A, S, D, Space, Escape, Shift)"),
				button: z.number().optional().describe("Gamepad button index (0=A/Cross, 1=B/Circle, 2=X/Square, 3=Y/Triangle)"),
				axis: z.number().optional().describe("Gamepad axis (0=LeftX, 1=LeftY, 2=RightX, 3=RightY)"),
				axisValue: z.number().optional().describe("Axis direction (-1.0 or 1.0)"),
				mouseButton: z.enum(["left", "right", "middle"]).optional(),
			})).optional().describe("Input events for bind_input"),
			deadzone: z.number().optional().default(0.5).describe("Deadzone for bind_input"),

			// camera2d / validate_scene / parallax / light2d / multiplayer params
			scenePath: z.string().optional().describe("Scene path (res://) — used by camera2d, validate_scene, parallax, light2d, multiplayer"),
			parent: z.string().optional().default(".").describe("Parent node path — used by camera2d, parallax, light2d, multiplayer"),
			name: z.string().optional().describe("Node name — used by camera2d, light2d"),

			// camera2d params
			current: z.boolean().optional().default(true).describe("Camera2D current flag"),
			zoom: z.string().optional().default("Vector2(1, 1)").describe("Zoom level as Vector2"),
			smoothingEnabled: z.boolean().optional().default(true).describe("Camera2D position smoothing"),
			smoothingSpeed: z.number().optional().default(5.0).describe("Camera2D smoothing speed"),
			dragHEnabled: z.boolean().optional().default(false).describe("Camera2D horizontal drag"),
			dragVEnabled: z.boolean().optional().default(false).describe("Camera2D vertical drag"),
			limitLeft: z.number().optional().describe("Left camera limit (pixels)"),
			limitTop: z.number().optional().describe("Top camera limit"),
			limitRight: z.number().optional().describe("Right camera limit"),
			limitBottom: z.number().optional().describe("Bottom camera limit"),
			limitSmoothed: z.boolean().optional().default(false).describe("Camera2D limit smoothing"),

			// curve params
			points: z.array(z.object({
				x: z.number().describe("Position (0.0 to 1.0)"),
				y: z.number().describe("Value (0.0 to 1.0)"),
				leftTangent: z.number().optional().default(0),
				rightTangent: z.number().optional().default(0),
			})).optional().describe("Points for curve"),
			minValue: z.number().optional().default(0).describe("Curve min value"),
			maxValue: z.number().optional().default(1).describe("Curve max value"),

			// gradient params
			colors: z.array(z.string()).optional().describe("Colors for gradient (e.g., ['Color(1,0,0,1)', 'Color(0,1,0,1)'])"),
			offsets: z.array(z.number()).optional().describe("Offset positions (0.0-1.0) for each color"),

			// audio_bus_layout params
			buses: z.array(z.object({
				name: z.string(),
				solo: z.boolean().optional().default(false),
				mute: z.boolean().optional().default(false),
				volumeDb: z.number().optional().default(0),
				sendTo: z.string().optional().default("Master"),
				effects: z.array(z.object({
					type: z.enum(["Reverb", "Chorus", "Delay", "EQ", "Compressor", "Limiter", "Distortion", "Phaser", "LowPassFilter", "HighPassFilter", "BandPassFilter"]),
					enabled: z.boolean().optional().default(true),
				})).optional(),
			})).optional().describe("Audio buses for audio_bus_layout"),

			// parallax params
			layers: z.array(z.object({
				name: z.string(),
				texturePath: z.string().describe("Background texture (res://)"),
				motionScale: z.string().optional().default("Vector2(0.5, 0.5)").describe("Scroll speed multiplier as Vector2"),
				motionOffset: z.string().optional().default("Vector2(0, 0)"),
				mirroring: z.string().optional().describe("Mirroring size as Vector2 for seamless repeat"),
			})).optional().describe("Parallax layers"),

			// light2d params
			lightType: z.enum(["point", "directional"]).optional().default("point").describe("Light type for light2d"),
			color: z.string().optional().default("Color(1, 1, 1, 1)").describe("Light color"),
			energy: z.number().optional().default(1.0).describe("Light energy"),
			texturePath: z.string().optional().describe("Light texture path (res://) — required for PointLight2D"),
			textureScale: z.number().optional().default(1.0).describe("Light texture scale"),
			blendMode: z.enum(["add", "sub", "mix"]).optional().default("add").describe("Light blend mode"),
			shadowEnabled: z.boolean().optional().default(false).describe("Enable light shadows"),
			transform: z.string().optional().describe("Node transform"),

			// stylebox params
			bgColor: z.string().optional().default("Color(0.2, 0.2, 0.2, 1)").describe("StyleBox background color"),
			borderColor: z.string().optional().describe("StyleBox border color"),
			borderWidth: z.number().optional().default(0).describe("Border width on all sides"),
			cornerRadius: z.number().optional().default(0).describe("Corner radius on all corners"),
			contentMargin: z.number().optional().describe("Content margin on all sides"),
			shadowColor: z.string().optional().describe("Shadow color"),
			shadowSize: z.number().optional().default(0).describe("Shadow size"),
			shadowOffset: z.string().optional().describe("Shadow offset as Vector2"),

			// multiplayer params
			addSpawner: z.boolean().optional().default(true).describe("Add MultiplayerSpawner"),
			spawnerScenes: z.array(z.string()).optional().describe("Scenes the spawner can spawn (res:// paths)"),
			addSynchronizer: z.boolean().optional().default(true).describe("Add MultiplayerSynchronizer"),
			syncProperties: z.array(z.string()).optional().describe("Node property paths to synchronize (e.g., .:position, .:rotation)"),
		},
		async (params) => {
			try {
				switch (params.action) {

					// ═══════════════════════════════════════════════════════════
					// sprite_frames
					// ═══════════════════════════════════════════════════════════
					case "sprite_frames": {
						const { path, animations } = params;
						if (!path) return { content: [{ type: "text" as const, text: "Error: path is required for sprite_frames" }], isError: true };
						if (!animations) return { content: [{ type: "text" as const, text: "Error: animations is required for sprite_frames" }], isError: true };

						const lines: string[] = [];
						lines.push(`[gd_resource type="SpriteFrames" load_steps=${animations.reduce((n, a) => n + a.frames.length, 0) + 1} format=3]`);
						lines.push("");

						const textureMap = new Map<string, string>();
						let extId = 1;
						for (const anim of animations) {
							for (const frame of anim.frames) {
								if (!textureMap.has(frame.texture)) {
									const id = `${extId}_tex`;
									textureMap.set(frame.texture, id);
									lines.push(`[ext_resource type="Texture2D" path="${frame.texture}" id="${id}"]`);
									extId++;
								}
							}
						}
						lines.push("");

						const atlasSubResources: Array<{ id: string; texId: string; region: string }> = [];
						let subId = 1;
						for (const anim of animations) {
							for (const frame of anim.frames) {
								if (frame.regionEnabled) {
									const sid = `AtlasTexture_${subId}`;
									const texExtId = textureMap.get(frame.texture)!;
									atlasSubResources.push({
										id: sid,
										texId: texExtId,
										region: `Rect2(${frame.regionX ?? 0}, ${frame.regionY ?? 0}, ${frame.regionW ?? 16}, ${frame.regionH ?? 16})`,
									});
									subId++;
								}
							}
						}

						for (const sub of atlasSubResources) {
							lines.push(`[sub_resource type="AtlasTexture" id="${sub.id}"]`);
							lines.push(`atlas = ExtResource("${sub.texId}")`);
							lines.push(`region = ${sub.region}`);
							lines.push("");
						}

						lines.push("[resource]");
						lines.push("animations = [{");

						const animEntries: string[] = [];
						let atlasIdx = 0;
						for (const anim of animations) {
							const frameRefs: string[] = [];
							for (const frame of anim.frames) {
								if (frame.regionEnabled) {
									frameRefs.push(`SubResource("${atlasSubResources[atlasIdx].id}")`);
									atlasIdx++;
								} else {
									frameRefs.push(`ExtResource("${textureMap.get(frame.texture)}")`);
								}
							}
							const durations = anim.frames.map(() => "1.0").join(", ");
							animEntries.push(`"frames": [${frameRefs.map((r, i) => `{"duration": 1.0, "texture": ${r}}`).join(", ")}], "loop": ${anim.loop}, "name": &"${anim.name}", "speed": ${anim.speed}.0`);
						}

						lines.push(animEntries.join("\n}, {\n"));
						lines.push("}]");
						lines.push("");

						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");

						return { content: [{ type: "text" as const, text: `Created SpriteFrames at ${path} with ${animations.length} animations: ${animations.map((a) => `${a.name} (${a.frames.length} frames, ${a.speed}fps)`).join(", ")}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// bind_input
					// ═══════════════════════════════════════════════════════════
					case "bind_input": {
						const { inputAction: action, events, deadzone } = params;
						if (!action) return { content: [{ type: "text" as const, text: "Error: inputAction is required for bind_input" }], isError: true };
						if (!events) return { content: [{ type: "text" as const, text: "Error: events is required for bind_input" }], isError: true };

						const configPath = join(ctx.projectRoot, "project.godot");
						let content = readFileSync(configPath, "utf-8");

						const eventStrings: string[] = [];
						for (const e of events) {
							switch (e.type) {
								case "key": {
									const keycode = godotKeycode(e.key ?? "Space");
									eventStrings.push(`Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":${keycode},"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)`);
									break;
								}
								case "gamepad_button": {
									eventStrings.push(`Object(InputEventJoypadButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"button_index":${e.button ?? 0},"pressure":0.0,"pressed":true,"script":null)`);
									break;
								}
								case "gamepad_axis": {
									eventStrings.push(`Object(InputEventJoypadMotion,"resource_local_to_scene":false,"resource_name":"","device":-1,"axis":${e.axis ?? 0},"axis_value":${e.axisValue ?? 1.0},"script":null)`);
									break;
								}
								case "mouse_button": {
									const btnMap: Record<string, number> = { left: 1, right: 2, middle: 3 };
									eventStrings.push(`Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0,0),"global_position":Vector2(0,0),"factor":1.0,"button_index":${btnMap[e.mouseButton ?? "left"]},"canceled":false,"pressed":true,"double_click":false,"script":null)`);
									break;
								}
							}
						}

						const actionValue = `{"deadzone": ${deadzone}, "events": [${eventStrings.join(", ")}]}`;

						if (!content.includes("[input]")) {
							content = content.trimEnd() + "\n\n[input]\n\n";
						}

						const actionRegex = new RegExp(`^${action}=.*$`, "m");
						if (actionRegex.test(content)) {
							content = content.replace(actionRegex, `${action}=${actionValue}`);
						} else {
							content = content.replace("[input]", `[input]\n\n${action}=${actionValue}`);
						}

						writeFileSync(configPath, content, "utf-8");
						ctx.getProject().load();

						const bindSummary = events.map((e) => {
							switch (e.type) {
								case "key": return `Key:${e.key}`;
								case "gamepad_button": return `Pad:Button${e.button}`;
								case "gamepad_axis": return `Pad:Axis${e.axis}(${e.axisValue})`;
								case "mouse_button": return `Mouse:${e.mouseButton}`;
							}
						}).join(", ");

						return { content: [{ type: "text" as const, text: `Bound "${action}" to: ${bindSummary}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// camera2d
					// ═══════════════════════════════════════════════════════════
					case "camera2d": {
						const { scenePath, parent, name: camName, current, zoom, smoothingEnabled, smoothingSpeed, dragHEnabled, dragVEnabled, limitLeft, limitTop, limitRight, limitBottom, limitSmoothed } = params;
						if (!scenePath) return { content: [{ type: "text" as const, text: "Error: scenePath is required for camera2d" }], isError: true };
						const nodeName = camName ?? "Camera2D";

						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const props: Record<string, unknown> = {
							current,
							zoom: parseVariant(zoom ?? "Vector2(1, 1)"),
							position_smoothing_enabled: smoothingEnabled,
							position_smoothing_speed: smoothingSpeed,
							drag_horizontal_enabled: dragHEnabled,
							drag_vertical_enabled: dragVEnabled,
						};

						if (limitLeft !== undefined) props.limit_left = limitLeft;
						if (limitTop !== undefined) props.limit_top = limitTop;
						if (limitRight !== undefined) props.limit_right = limitRight;
						if (limitBottom !== undefined) props.limit_bottom = limitBottom;
						if (limitSmoothed) props.limit_smoothed = true;

						doc.nodes.push({ name: nodeName, type: "Camera2D", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added Camera2D "${nodeName}" to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// validate_scene
					// ═══════════════════════════════════════════════════════════
					case "validate_scene": {
						const { scenePath } = params;
						if (!scenePath) return { content: [{ type: "text" as const, text: "Error: scenePath is required for validate_scene" }], isError: true };

						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const doc = parseTscn(content);
						const issues: Array<{ severity: "error" | "warning"; message: string }> = [];

						for (const ext of doc.extResources) {
							if (ext.path) {
								try {
									const extAbs = resToAbsolute(ext.path, ctx.projectRoot);
									if (!existsSync(extAbs)) {
										issues.push({ severity: "error", message: `Missing resource: ${ext.path} (${ext.type})` });
									}
								} catch {
									issues.push({ severity: "error", message: `Invalid resource path: ${ext.path}` });
								}
							}
						}

						const physicsBodyTypes = new Set(["StaticBody2D", "StaticBody3D", "RigidBody2D", "RigidBody3D", "CharacterBody2D", "CharacterBody3D", "AnimatableBody2D", "AnimatableBody3D", "Area2D", "Area3D"]);
						const collisionTypes = new Set(["CollisionShape2D", "CollisionShape3D", "CollisionPolygon2D", "CollisionPolygon3D"]);

						for (const node of doc.nodes) {
							if (node.type && physicsBodyTypes.has(node.type)) {
								const nodePath = node.parent === undefined ? "." : node.parent === "." ? node.name : `${node.parent}/${node.name}`;
								const hasCollision = doc.nodes.some((child) => child.parent === nodePath && child.type && collisionTypes.has(child.type));
								if (!hasCollision) {
									issues.push({ severity: "warning", message: `${node.type} "${node.name}" has no CollisionShape child` });
								}
							}
						}

						for (const node of doc.nodes) {
							const scriptRef = node.properties.script;
							if (scriptRef && typeof scriptRef === "object" && "type" in scriptRef && scriptRef.type === "ExtResource") {
								const ext = doc.extResources.find((e) => e.id === (scriptRef as { id: string }).id);
								if (ext && ext.path) {
									try {
										const scriptAbs = resToAbsolute(ext.path, ctx.projectRoot);
										if (!existsSync(scriptAbs)) {
											issues.push({ severity: "error", message: `Missing script: ${ext.path} on node "${node.name}"` });
										}
									} catch { /* skip */ }
								}
							}
						}

						if (doc.nodes.length === 0) {
							issues.push({ severity: "error", message: "Scene has no nodes" });
						}

						if (doc.nodes.length > 0 && !doc.nodes[0].type && !doc.nodes[0].instance) {
							issues.push({ severity: "warning", message: "Root node has no type (may be inherited scene)" });
						}

						const namesByParent = new Map<string, string[]>();
						for (const node of doc.nodes) {
							const p = node.parent ?? "__root__";
							if (!namesByParent.has(p)) namesByParent.set(p, []);
							const names = namesByParent.get(p)!;
							if (names.includes(node.name)) {
								issues.push({ severity: "error", message: `Duplicate node name "${node.name}" under parent "${p}"` });
							}
							names.push(node.name);
						}

						return {
							content: [{
								type: "text" as const,
								text: JSON.stringify({
									scene: scenePath,
									valid: issues.filter((i) => i.severity === "error").length === 0,
									nodeCount: doc.nodes.length,
									extResourceCount: doc.extResources.length,
									subResourceCount: doc.subResources.length,
									connectionCount: doc.connections.length,
									errors: issues.filter((i) => i.severity === "error"),
									warnings: issues.filter((i) => i.severity === "warning"),
								}, null, 2),
							}],
						};
					}

					// ═══════════════════════════════════════════════════════════
					// curve
					// ═══════════════════════════════════════════════════════════
					case "curve": {
						const { path, points, minValue, maxValue } = params;
						if (!path) return { content: [{ type: "text" as const, text: "Error: path is required for curve" }], isError: true };
						if (!points) return { content: [{ type: "text" as const, text: "Error: points is required for curve" }], isError: true };

						const pointData = points.map((p) => `${p.x}, ${p.y}, ${p.leftTangent}, ${p.rightTangent}, 0, 0`).join(", ");
						const content = `[gd_resource type="Curve" format=3]

[resource]
min_value = ${minValue}
max_value = ${maxValue}
_data = [${pointData}]
point_count = ${points.length}
`;
						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, content, "utf-8");
						return { content: [{ type: "text" as const, text: `Created Curve at ${path} with ${points.length} points` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// gradient
					// ═══════════════════════════════════════════════════════════
					case "gradient": {
						const { path, colors, offsets } = params;
						if (!path) return { content: [{ type: "text" as const, text: "Error: path is required for gradient" }], isError: true };
						if (!colors) return { content: [{ type: "text" as const, text: "Error: colors is required for gradient" }], isError: true };

						const offs = offsets ?? colors.map((_, i) => i / Math.max(colors.length - 1, 1));
						const colorStr = colors.join(", ");
						const offsetStr = offs.join(", ");
						const content = `[gd_resource type="Gradient" format=3]

[resource]
offsets = PackedFloat32Array(${offsetStr})
colors = PackedColorArray(${colorStr})
`;
						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, content, "utf-8");
						return { content: [{ type: "text" as const, text: `Created Gradient at ${path} with ${colors.length} color stops` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// audio_bus_layout
					// ═══════════════════════════════════════════════════════════
					case "audio_bus_layout": {
						const { path, buses } = params;
						if (!path) return { content: [{ type: "text" as const, text: "Error: path is required for audio_bus_layout" }], isError: true };
						if (!buses) return { content: [{ type: "text" as const, text: "Error: buses is required for audio_bus_layout" }], isError: true };

						const lines: string[] = [];
						let subCount = 0;

						for (const bus of buses) {
							subCount += (bus.effects?.length ?? 0);
						}

						lines.push(`[gd_resource type="AudioBusLayout" load_steps=${subCount + 1} format=3]`);
						lines.push("");

						let effectIdx = 0;
						const effectIds: string[][] = [];
						for (const bus of buses) {
							const busEffectIds: string[] = [];
							for (const fx of (bus.effects ?? [])) {
								const id = `AudioEffect${fx.type}_${effectIdx}`;
								lines.push(`[sub_resource type="AudioEffect${fx.type}" id="${id}"]`);
								lines.push("");
								busEffectIds.push(id);
								effectIdx++;
							}
							effectIds.push(busEffectIds);
						}

						lines.push("[resource]");

						for (let i = 0; i < buses.length; i++) {
							const bus = buses[i];
							const prefix = i === 0 ? "bus/0" : `bus/${i}`;
							lines.push(`${prefix}/name = &"${bus.name}"`);
							lines.push(`${prefix}/solo = ${bus.solo}`);
							lines.push(`${prefix}/mute = ${bus.mute}`);
							lines.push(`${prefix}/volume_db = ${bus.volumeDb ?? 0}`);
							if (bus.sendTo && bus.sendTo !== "Master" && i > 0) {
								lines.push(`${prefix}/send = &"${bus.sendTo}"`);
							}
							for (let j = 0; j < effectIds[i].length; j++) {
								lines.push(`${prefix}/effect/${j}/effect = SubResource("${effectIds[i][j]}")`);
								lines.push(`${prefix}/effect/${j}/enabled = ${(bus.effects?.[j]?.enabled ?? true)}`);
							}
						}
						lines.push("");

						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");

						return { content: [{ type: "text" as const, text: `Created AudioBusLayout at ${path} with buses: ${buses.map((b) => b.name).join(", ")}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// parallax
					// ═══════════════════════════════════════════════════════════
					case "parallax": {
						const { scenePath, parent, layers } = params;
						if (!scenePath) return { content: [{ type: "text" as const, text: "Error: scenePath is required for parallax" }], isError: true };
						if (!layers) return { content: [{ type: "text" as const, text: "Error: layers is required for parallax" }], isError: true };

						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const bgName = "ParallaxBackground";
						const bgPath = parent === "." ? bgName : `${parent}/${bgName}`;
						doc.nodes.push({ name: bgName, type: "ParallaxBackground", parent, properties: {} });

						for (const layer of layers) {
							const layerPath = bgPath;

							const texId = generateResourceId();
							doc.extResources.push({ type: "Texture2D", uid: generateUid(), path: layer.texturePath, id: texId });

							const layerProps: Record<string, unknown> = {
								motion_scale: parseVariant(layer.motionScale ?? "Vector2(0.5, 0.5)"),
								motion_offset: parseVariant(layer.motionOffset ?? "Vector2(0, 0)"),
							};
							if (layer.mirroring) layerProps.motion_mirroring = parseVariant(layer.mirroring);

							doc.nodes.push({ name: layer.name, type: "ParallaxLayer", parent: layerPath, properties: layerProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

							const spritePath = `${layerPath}/${layer.name}`;
							doc.nodes.push({
								name: "Sprite2D", type: "Sprite2D", parent: spritePath,
								properties: { texture: { type: "ExtResource", id: texId }, centered: false } as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
							});
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ParallaxBackground with ${layers.length} layers to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// light2d
					// ═══════════════════════════════════════════════════════════
					case "light2d": {
						const { scenePath, parent, name: lightName, lightType, color, energy, texturePath, textureScale, blendMode, shadowEnabled, transform } = params;
						if (!scenePath) return { content: [{ type: "text" as const, text: "Error: scenePath is required for light2d" }], isError: true };
						const nodeName = lightName ?? "Light2D";

						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const nodeType = lightType === "directional" ? "DirectionalLight2D" : "PointLight2D";

						const props: Record<string, unknown> = {
							color: parseVariant(color ?? "Color(1, 1, 1, 1)"),
							energy,
							shadow_enabled: shadowEnabled,
							texture_scale: textureScale,
						};

						const blendModes: Record<string, number> = { add: 0, sub: 1, mix: 2 };
						props.blend_mode = blendModes[blendMode ?? "add"] ?? 0;

						if (texturePath) {
							const texId = generateResourceId();
							doc.extResources.push({ type: "Texture2D", uid: generateUid(), path: texturePath, id: texId });
							props.texture = { type: "ExtResource", id: texId };
						}

						if (transform) props.transform = parseVariant(transform);

						doc.nodes.push({ name: nodeName, type: nodeType, parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${nodeType} "${nodeName}" to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// stylebox
					// ═══════════════════════════════════════════════════════════
					case "stylebox": {
						const { path, bgColor, borderColor, borderWidth, cornerRadius, contentMargin, shadowColor, shadowSize, shadowOffset } = params;
						if (!path) return { content: [{ type: "text" as const, text: "Error: path is required for stylebox" }], isError: true };

						const lines = [`[gd_resource type="StyleBoxFlat" format=3]`, "", "[resource]"];
						lines.push(`bg_color = ${bgColor}`);
						if (borderColor) {
							lines.push(`border_color = ${borderColor}`);
							lines.push(`border_width_left = ${borderWidth}`);
							lines.push(`border_width_top = ${borderWidth}`);
							lines.push(`border_width_right = ${borderWidth}`);
							lines.push(`border_width_bottom = ${borderWidth}`);
						}
						if ((cornerRadius ?? 0) > 0) {
							lines.push(`corner_radius_top_left = ${cornerRadius}`);
							lines.push(`corner_radius_top_right = ${cornerRadius}`);
							lines.push(`corner_radius_bottom_right = ${cornerRadius}`);
							lines.push(`corner_radius_bottom_left = ${cornerRadius}`);
						}
						if (contentMargin !== undefined) {
							lines.push(`content_margin_left = ${contentMargin}`);
							lines.push(`content_margin_top = ${contentMargin}`);
							lines.push(`content_margin_right = ${contentMargin}`);
							lines.push(`content_margin_bottom = ${contentMargin}`);
						}
						if (shadowColor) lines.push(`shadow_color = ${shadowColor}`);
						if ((shadowSize ?? 0) > 0) lines.push(`shadow_size = ${shadowSize}`);
						if (shadowOffset) lines.push(`shadow_offset = ${shadowOffset}`);
						lines.push("");

						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						return { content: [{ type: "text" as const, text: `Created StyleBoxFlat at ${path}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// multiplayer
					// ═══════════════════════════════════════════════════════════
					case "multiplayer": {
						const { scenePath, parent, addSpawner, spawnerScenes, addSynchronizer, syncProperties } = params;
						if (!scenePath) return { content: [{ type: "text" as const, text: "Error: scenePath is required for multiplayer" }], isError: true };

						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						if (addSpawner) {
							const props: Record<string, unknown> = {};
							if (spawnerScenes && spawnerScenes.length > 0) {
								const sceneIds: string[] = [];
								for (const sp of spawnerScenes) {
									const id = generateResourceId();
									doc.extResources.push({ type: "PackedScene", uid: generateUid(), path: sp, id });
									sceneIds.push(id);
								}
							}
							doc.nodes.push({ name: "MultiplayerSpawner", type: "MultiplayerSpawner", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						}

						if (addSynchronizer) {
							doc.nodes.push({ name: "MultiplayerSynchronizer", type: "MultiplayerSynchronizer", parent, properties: {} });
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						const added = [addSpawner ? "MultiplayerSpawner" : null, addSynchronizer ? "MultiplayerSynchronizer" : null].filter(Boolean);
						return { content: [{ type: "text" as const, text: `Added ${added.join(" + ")} to ${scenePath}. Configure spawn lists and sync properties in the editor for full setup.` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// check_integrity
					// ═══════════════════════════════════════════════════════════
					case "check_integrity": {
						const scenes = ctx.getAssetManager().byCategory("scene");
						const allIssues: Array<{ scene: string; severity: string; message: string }> = [];
						let totalNodes = 0;
						let totalResources = 0;

						for (const scene of scenes) {
							try {
								const content = readFileSync(scene.absPath, "utf-8");
								const doc = parseTscn(content);
								totalNodes += doc.nodes.length;
								totalResources += doc.extResources.length + doc.subResources.length;

								for (const ext of doc.extResources) {
									if (ext.path) {
										try {
											const extAbs = resToAbsolute(ext.path, ctx.projectRoot);
											if (!existsSync(extAbs)) {
												allIssues.push({ scene: scene.resPath, severity: "error", message: `Missing: ${ext.path} (${ext.type})` });
											}
										} catch {
											allIssues.push({ scene: scene.resPath, severity: "error", message: `Bad path: ${ext.path}` });
										}
									}
								}
							} catch (e) {
								allIssues.push({ scene: scene.resPath, severity: "error", message: `Failed to parse: ${e instanceof Error ? e.message : String(e)}` });
							}
						}

						return {
							content: [{
								type: "text" as const,
								text: JSON.stringify({
									scenesScanned: scenes.length,
									totalNodes,
									totalResources,
									issueCount: allIssues.length,
									errors: allIssues.filter((i) => i.severity === "error"),
									warnings: allIssues.filter((i) => i.severity === "warning"),
									healthy: allIssues.length === 0,
								}, null, 2),
							}],
						};
					}
				}
			} catch (e) { return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
		},
	);
}

// ═══════════════════════════════════════════════════════════════
// Godot Key Code Mapping
// ═══════════════════════════════════════════════════════════════

function godotKeycode(key: string): number {
	const keycodes: Record<string, number> = {
		// Letters
		A: 65, B: 66, C: 67, D: 68, E: 69, F: 70, G: 71, H: 72, I: 73, J: 74, K: 75, L: 76, M: 77,
		N: 78, O: 79, P: 80, Q: 81, R: 82, S: 83, T: 84, U: 85, V: 86, W: 87, X: 88, Y: 89, Z: 90,
		// Numbers
		"0": 48, "1": 49, "2": 50, "3": 51, "4": 52, "5": 53, "6": 54, "7": 55, "8": 56, "9": 57,
		// Special keys
		Space: 32, Escape: 4194305, Tab: 4194306, Enter: 4194309, Return: 4194309,
		Backspace: 4194308, Delete: 4194312, Insert: 4194311,
		Up: 4194320, Down: 4194322, Left: 4194319, Right: 4194321,
		Home: 4194313, End: 4194314, PageUp: 4194315, PageDown: 4194316,
		Shift: 4194325, Ctrl: 4194326, Alt: 4194328, Meta: 4194329,
		CapsLock: 4194327, NumLock: 4194331, ScrollLock: 4194330,
		F1: 4194332, F2: 4194333, F3: 4194334, F4: 4194335, F5: 4194336, F6: 4194337,
		F7: 4194338, F8: 4194339, F9: 4194340, F10: 4194341, F11: 4194342, F12: 4194343,
		// Punctuation
		Minus: 45, Equal: 61, BracketLeft: 91, BracketRight: 93,
		Semicolon: 59, Apostrophe: 39, Comma: 44, Period: 46, Slash: 47, Backslash: 92,
	};
	return keycodes[key] ?? keycodes[key.toUpperCase()] ?? keycodes[key.charAt(0).toUpperCase() + key.slice(1)] ?? 32;
}
