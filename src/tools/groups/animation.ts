/**
 * Animation Tool — Single tool with action-based routing.
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
	server.tool("godot_animation",
		`Animation operations. Actions:
- create: Create an Animation .tres with tracks/keyframes. Params: path, name, length, loop, tracks[{type,nodePath,keyframes[{time,value}]}]
- tree: Add AnimationTree node to a scene. Params: scenePath, parent, animPlayerPath, rootType (state_machine|blend_tree)
- list: List all AnimationPlayer nodes and their animations. Params: scenePath (optional, searches all if omitted)
- read_tree: Inspect AnimationTree structure. Params: scenePath, nodePath`,
		{
			action: z.enum(["create", "tree", "list", "read_tree"]),
			path: z.string().optional(), scenePath: z.string().optional(), nodePath: z.string().optional(),
			name: z.string().optional(), length: z.number().optional(), loop: z.boolean().optional(),
			tracks: z.array(z.object({
				type: z.enum(["value", "method", "bezier", "audio"]),
				nodePath: z.string(),
				keyframes: z.array(z.object({ time: z.number(), value: z.string() })),
			})).optional(),
			parent: z.string().optional().default("."),
			animPlayerPath: z.string().optional(),
			rootType: z.enum(["state_machine", "blend_tree"]).optional(),
		},
		async (p) => {
			try {
				switch (p.action) {
					case "create": {
						if (!p.path || !p.name || !p.length) return { content: [{ type: "text", text: "path, name, length required" }], isError: true };
						const lines = [`[gd_resource type="Animation" format=3]`, "", "[resource]", `resource_name = "${p.name}"`, `length = ${p.length}`];
						if (p.loop) lines.push(`loop_mode = 1`);
						if (p.tracks) {
							for (let i = 0; i < p.tracks.length; i++) {
								const t = p.tracks[i];
								lines.push(`tracks/${i}/type = "${t.type}"`, `tracks/${i}/imported = false`, `tracks/${i}/enabled = true`, `tracks/${i}/path = NodePath("${t.nodePath}")`);
								if (t.keyframes.length > 0) {
									const times = t.keyframes.map((k) => k.time);
									const values = t.keyframes.map((k) => k.value);
									lines.push(`tracks/${i}/interp = 1`, `tracks/${i}/loop_wrap = true`,
										`tracks/${i}/keys = { "times": PackedFloat32Array(${times.join(", ")}), "transitions": PackedFloat32Array(${times.map(() => "1").join(", ")}), "update": 0, "values": [${values.join(", ")}] }`);
								}
							}
						}
						lines.push("");
						const absPath = resToAbsolute(p.path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						return { content: [{ type: "text", text: `Created animation "${p.name}" at ${p.path} (${p.length}s, ${p.tracks?.length ?? 0} tracks)` }] };
					}
					case "tree": {
						if (!p.scenePath || !p.animPlayerPath || !p.rootType) return { content: [{ type: "text", text: "scenePath, animPlayerPath, rootType required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const subId = `AnimationNodeStateMachine_${generateResourceId()}`;
						const subType = p.rootType === "state_machine" ? "AnimationNodeStateMachine" : "AnimationNodeBlendTree";
						doc.subResources.push({ type: subType, id: subId, properties: {} });
						doc.nodes.push({ name: "AnimationTree", type: "AnimationTree", parent: p.parent, properties: { tree_root: { type: "SubResource", id: subId }, anim_player: { type: "NodePath", path: p.animPlayerPath }, active: true } });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added AnimationTree (${p.rootType}) to ${p.scenePath}` }] };
					}
					case "list": {
						const scenes = p.scenePath
							? [{ resPath: p.scenePath, absPath: resToAbsolute(p.scenePath, ctx.projectRoot) }]
							: ctx.getAssetManager().byCategory("scene").map((s) => ({ resPath: s.resPath, absPath: s.absPath }));
						const results: Array<{ scene: string; player: string; animations: string[] }> = [];
						for (const s of scenes) {
							try {
								const doc = parseTscn(readFileSync(s.absPath, "utf-8"));
								for (const node of doc.nodes) {
									if (node.type === "AnimationPlayer") {
										results.push({ scene: s.resPath, player: node.name, animations: Object.keys(node.properties).filter((k) => k.startsWith("anims/") || k.startsWith("libraries/")) });
									}
								}
							} catch { /* skip */ }
						}
						return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
					}
					case "read_tree": {
						if (!p.scenePath) return { content: [{ type: "text", text: "scenePath required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const np = p.nodePath ?? "AnimationTree";
						const treeNode = doc.nodes.find((n) => n.name === np || `${n.parent}/${n.name}` === np);
						if (!treeNode) return { content: [{ type: "text", text: `AnimationTree not found at ${np}` }], isError: true };
						return { content: [{ type: "text", text: JSON.stringify({ node: treeNode.name, properties: treeNode.properties }, null, 2) }] };
					}
				}
			} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
		},
	);
}
