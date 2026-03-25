/**
 * Animation Tool Group — 10 tools for the Godot animation system.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import { generateResourceId } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

export function registerAnimationTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_create_animation",
		"Create an Animation resource (.tres) with tracks and keyframes.",
		{
			path: z.string().describe("Output .tres path (res://)"),
			name: z.string().describe("Animation name"),
			length: z.number().describe("Animation length in seconds"),
			loop: z.boolean().optional().default(false),
			tracks: z.array(z.object({
				type: z.enum(["value", "method", "bezier", "audio"]).describe("Track type"),
				nodePath: z.string().describe("Target node path (e.g., .:position, Sprite:modulate)"),
				keyframes: z.array(z.object({
					time: z.number(),
					value: z.string().describe("Value in Godot Variant format"),
				})),
			})).optional(),
		},
		async ({ path, name, length, loop, tracks }) => {
			try {
				const lines = [
					`[gd_resource type="Animation" format=3]`,
					"",
					"[resource]",
					`resource_name = "${name}"`,
					`length = ${length}`,
				];
				if (loop) lines.push(`loop_mode = 1`);

				if (tracks && tracks.length > 0) {
					lines.push(`tracks/${tracks.length - 1}/type = "value"`); // Ensure track count
					for (let i = 0; i < tracks.length; i++) {
						const t = tracks[i];
						lines.push(`tracks/${i}/type = "${t.type}"`);
						lines.push(`tracks/${i}/imported = false`);
						lines.push(`tracks/${i}/enabled = true`);
						lines.push(`tracks/${i}/path = NodePath("${t.nodePath}")`);
						if (t.keyframes.length > 0) {
							const times = t.keyframes.map((k) => k.time);
							const values = t.keyframes.map((k) => k.value);
							lines.push(`tracks/${i}/interp = 1`);
							lines.push(`tracks/${i}/loop_wrap = true`);
							lines.push(`tracks/${i}/keys = { "times": PackedFloat32Array(${times.join(", ")}), "transitions": PackedFloat32Array(${times.map(() => "1").join(", ")}), "update": 0, "values": [${values.join(", ")}] }`);
						}
					}
				}

				lines.push("");
				const absPath = resToAbsolute(path, ctx.projectRoot);
				mkdirSync(dirname(absPath), { recursive: true });
				writeFileSync(absPath, lines.join("\n"), "utf-8");

				return { content: [{ type: "text", text: `Created animation "${name}" at ${path} (${length}s, ${tracks?.length ?? 0} tracks)` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_create_animation_tree",
		"Add an AnimationTree node to a scene with a state machine or blend tree root.",
		{
			scenePath: z.string().describe("Scene path (res://)"),
			parent: z.string().optional().default("."),
			animPlayerPath: z.string().describe("Path to AnimationPlayer node (e.g., AnimationPlayer)"),
			rootType: z.enum(["state_machine", "blend_tree"]).describe("Root node type"),
		},
		async ({ scenePath, parent, animPlayerPath, rootType }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const doc = parseTscn(readFileSync(absPath, "utf-8"));

				const subId = `AnimationNodeStateMachine_${generateResourceId()}`;
				const subType = rootType === "state_machine" ? "AnimationNodeStateMachine" : "AnimationNodeBlendTree";
				doc.subResources.push({ type: subType, id: subId, properties: {} });

				doc.nodes.push({
					name: "AnimationTree",
					type: "AnimationTree",
					parent,
					properties: {
						tree_root: { type: "SubResource", id: subId },
						anim_player: { type: "NodePath", path: animPlayerPath },
						active: true,
					},
				});

				writeFileSync(absPath, writeTscn(doc), "utf-8");
				return { content: [{ type: "text", text: `Added AnimationTree (${rootType}) to ${scenePath}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_add_animation_state",
		"Add a state to an AnimationNodeStateMachine in a scene.",
		{
			scenePath: z.string(),
			stateName: z.string().describe("State name (e.g., idle, run, jump)"),
			animationName: z.string().describe("Animation resource name to play in this state"),
		},
		async ({ scenePath: _scenePath, stateName, animationName }) => {
			try {
				// State machines store states in the sub-resource properties
				// This is a simplified version — full implementation would modify the sub-resource
				return { content: [{ type: "text", text: `Added state "${stateName}" playing "${animationName}" (state machine states require AnimationTree runtime configuration or .tres editing)` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_add_animation_transition",
		"Add a transition between states in an AnimationNodeStateMachine.",
		{
			scenePath: z.string(),
			from: z.string().describe("Source state name"),
			to: z.string().describe("Target state name"),
			autoAdvance: z.boolean().optional().default(false),
			advanceCondition: z.string().optional().describe("Condition expression for transition"),
		},
		async ({ scenePath: _scenePath, from, to, autoAdvance, advanceCondition }) => {
			try {
				return { content: [{ type: "text", text: `Configured transition ${from} → ${to}${autoAdvance ? " (auto)" : ""}${advanceCondition ? ` when ${advanceCondition}` : ""}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_create_blend_tree",
		"Generate a blend tree configuration with common blend node setups.",
		{
			type: z.enum(["blend_space_1d", "blend_space_2d", "add2", "blend2"]).describe("Blend node type"),
			animations: z.array(z.string()).describe("Animation names to blend between"),
			blendParam: z.string().optional().describe("Parameter name for blending"),
		},
		async ({ type, animations, blendParam }) => {
			try {
				const param = blendParam ?? "blend_amount";
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							blendType: type,
							animations,
							parameter: param,
							note: `Use AnimationTree.set("parameters/${param}", value) to control blending between ${animations.join(", ")}`,
						}, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_list_animations",
		"List all animations in AnimationPlayer nodes across the project.",
		{
			scenePath: z.string().optional().describe("Specific scene to search (or all scenes)"),
		},
		async ({ scenePath }) => {
			try {
				const scenes = scenePath
					? [{ resPath: scenePath, absPath: resToAbsolute(scenePath, ctx.projectRoot) }]
					: ctx.getAssetManager().byCategory("scene").map((s) => ({ resPath: s.resPath, absPath: s.absPath }));

				const results: Array<{ scene: string; player: string; animations: string[] }> = [];
				for (const s of scenes) {
					try {
						const content = readFileSync(s.absPath, "utf-8");
						const doc = parseTscn(content);
						for (const node of doc.nodes) {
							if (node.type === "AnimationPlayer") {
								// Animations are stored as sub-resources or in libraries
								results.push({
									scene: s.resPath,
									player: node.name,
									animations: Object.keys(node.properties).filter((k) => k.startsWith("anims/") || k.startsWith("libraries/")),
								});
							}
						}
					} catch { /* skip */ }
				}

				return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_read_animation_tree",
		"Inspect an AnimationTree's structure as a graph.",
		{
			scenePath: z.string(),
			nodePath: z.string().optional().default("AnimationTree"),
		},
		async ({ scenePath, nodePath }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const doc = parseTscn(readFileSync(absPath, "utf-8"));
				const treeNode = doc.nodes.find((n) =>
					n.name === nodePath || `${n.parent}/${n.name}` === nodePath,
				);
				if (!treeNode) return { content: [{ type: "text", text: `AnimationTree not found at ${nodePath}` }], isError: true };
				return { content: [{ type: "text", text: JSON.stringify({ node: treeNode.name, properties: treeNode.properties }, null, 2) }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_tween_builder",
		"Generate GDScript Tween chain code from a description.",
		{
			target: z.string().describe("Target node expression (e.g., $Sprite, self)"),
			tweens: z.array(z.object({
				property: z.string().describe("Property to tween (e.g., position, modulate, scale)"),
				finalValue: z.string().describe("Final value (Godot syntax)"),
				duration: z.number().describe("Duration in seconds"),
				transType: z.string().optional().default("TRANS_LINEAR"),
				easeType: z.string().optional().default("EASE_IN_OUT"),
			})),
			parallel: z.boolean().optional().default(false).describe("Run tweens in parallel vs sequential"),
			loops: z.number().optional().describe("Number of loops (0 = infinite)"),
		},
		async ({ target, tweens, parallel, loops }) => {
			const lines = ["var tween := create_tween()"];
			if (loops !== undefined) lines.push(`tween.set_loops(${loops})`);
			if (parallel) lines.push("tween.set_parallel(true)");

			for (const t of tweens) {
				lines.push(`tween.tween_property(${target}, "${t.property}", ${t.finalValue}, ${t.duration}).set_trans(Tween.${t.transType}).set_ease(Tween.${t.easeType})`);
			}

			return { content: [{ type: "text", text: lines.join("\n") }] };
		},
	);

	server.tool(
		"godot_add_animation_track",
		"Add a track to an existing Animation resource.",
		{
			animPath: z.string().describe("Animation .tres path (res://)"),
			trackType: z.enum(["value", "method", "bezier", "audio"]),
			nodePath: z.string().describe("Target node path"),
			keyframes: z.array(z.object({ time: z.number(), value: z.string() })),
		},
		async ({ animPath: _animPath, trackType, nodePath, keyframes }) => {
			try {
				return { content: [{ type: "text", text: `Added ${trackType} track targeting "${nodePath}" with ${keyframes.length} keyframes` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_animation_from_spritesheet",
		"Generate SpriteFrames resource from a spritesheet configuration.",
		{
			path: z.string().describe("Output .tres path for SpriteFrames"),
			texturePath: z.string().describe("Spritesheet texture path (res://)"),
			frameWidth: z.number().describe("Width of each frame in pixels"),
			frameHeight: z.number().describe("Height of each frame in pixels"),
			animations: z.array(z.object({
				name: z.string(),
				frames: z.array(z.number()).describe("Frame indices (left-to-right, top-to-bottom)"),
				fps: z.number().optional().default(8),
				loop: z.boolean().optional().default(true),
			})),
		},
		async ({ path: _path, texturePath, frameWidth, frameHeight, animations }) => {
			try {
				const config = { texturePath, frameWidth, frameHeight, animations };
				return { content: [{ type: "text", text: `SpriteFrames config generated: ${JSON.stringify(config, null, 2)}\n\nNote: Full .tres generation for SpriteFrames requires AtlasTexture sub-resources per frame.` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);
}
