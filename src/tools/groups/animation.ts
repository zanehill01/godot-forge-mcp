/**
 * Animation Tool Group — 4 tools that actually manipulate animation data.
 *
 * Removed: stubs (add_animation_state, add_animation_transition, add_animation_track),
 * code-gen wrappers (tween_builder, create_blend_tree, animation_from_spritesheet).
 * An LLM can generate tween code, blend tree configs, and spritesheet setups natively.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

export function registerAnimationTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_create_animation",
		"Create an Animation resource (.tres) with tracks and keyframes. Writes real .tres files.",
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
		"Add an AnimationTree node to a scene with a state machine or blend tree root. Writes real .tscn data.",
		{
			scenePath: z.string().describe("Scene path (res://)"),
			parent: z.string().optional().default("."),
			animPlayerPath: z.string().describe("Path to AnimationPlayer node"),
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
		"godot_list_animations",
		"List all animations in AnimationPlayer nodes across the project. Reads real .tscn files.",
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
		"Inspect an AnimationTree's structure from a .tscn file.",
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
}
