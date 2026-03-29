/**
 * Animation Tool — Single tool with action-based routing.
 *
 * Covers: Animation .tres creation, AnimationTree setup, state machine
 * states/transitions, blend spaces, and tween code generation.
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

• create — Create an Animation .tres with tracks/keyframes.
    path (required), name (required), length (required), loop, tracks[{type: value|method|bezier|audio, nodePath, keyframes[{time, value}]}]

• tree — Add AnimationTree node to a scene.
    scenePath (required), parent, animPlayerPath (required), rootType (required: state_machine|blend_tree)

• list — List all AnimationPlayer nodes and their animations.
    scenePath (optional, searches all if omitted)

• read_tree — Inspect AnimationTree structure.
    scenePath (required), nodePath

• add_state — Add a state to an AnimationNodeStateMachine.
    scenePath (required), treePath (node name of AnimationTree), stateName (required), animationName (required)

• add_transition — Add a transition between states in a state machine.
    scenePath (required), treePath, fromState (required), toState (required), autoAdvance, switchMode (immediate|at_end|sync), advanceCondition

• blend_space — Create a BlendSpace1D or BlendSpace2D in an AnimationTree.
    scenePath (required), treePath, blendType (required: 1d|2d), paramName, points[{position (number or string "x,y"), animation}], minSpace, maxSpace

• tween — Generate tween chain GDScript code.
    tweens (required): [{property, finalValue, duration, transType?, easeType?}], parallel, loop, objectPath`,
		{
			action: z.enum(["create", "tree", "list", "read_tree", "add_state", "add_transition", "blend_space", "tween"]),
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

			// add_state
			treePath: z.string().optional().default("AnimationTree").describe("AnimationTree node name in the scene"),
			stateName: z.string().optional().describe("State name to add"),
			animationName: z.string().optional().describe("Animation name to play in the state"),

			// add_transition
			fromState: z.string().optional().describe("Source state name"),
			toState: z.string().optional().describe("Target state name"),
			autoAdvance: z.boolean().optional().default(false),
			switchMode: z.enum(["immediate", "at_end", "sync"]).optional().default("immediate"),
			advanceCondition: z.string().optional().describe("Condition string for transition"),

			// blend_space
			blendType: z.enum(["1d", "2d"]).optional(),
			paramName: z.string().optional().describe("Blend parameter name"),
			points: z.array(z.object({
				position: z.string().describe("Position: number for 1D, 'x,y' for 2D"),
				animation: z.string().describe("Animation name"),
			})).optional(),
			minSpace: z.number().optional(),
			maxSpace: z.number().optional(),

			// tween
			tweens: z.array(z.object({
				property: z.string().describe("Property path (e.g., 'position:y', 'modulate:a')"),
				finalValue: z.string().describe("Target value as GDScript literal"),
				duration: z.number(),
				transType: z.string().optional().describe("Tween.TRANS_* (e.g., SINE, BOUNCE, ELASTIC, CUBIC)"),
				easeType: z.string().optional().describe("Tween.EASE_* (e.g., IN, OUT, IN_OUT)"),
			})).optional(),
			parallel: z.boolean().optional().default(false).describe("Run tweens in parallel"),
			objectPath: z.string().optional().describe("Node path for tween target (default self)"),
		},
		async (p) => {
			try {
				switch (p.action) {
					// ── create ─────────────────────────────────────────────
					case "create": {
						if (!p.path || !p.name || !p.length) return { content: [{ type: "text" as const, text: "path, name, length required" }], isError: true };
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
						return { content: [{ type: "text" as const, text: `Created animation "${p.name}" at ${p.path} (${p.length}s, ${p.tracks?.length ?? 0} tracks)` }] };
					}

					// ── tree ───────────────────────────────────────────────
					case "tree": {
						if (!p.scenePath || !p.animPlayerPath || !p.rootType) return { content: [{ type: "text" as const, text: "scenePath, animPlayerPath, rootType required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const subId = `AnimationNodeStateMachine_${generateResourceId()}`;
						const subType = p.rootType === "state_machine" ? "AnimationNodeStateMachine" : "AnimationNodeBlendTree";
						doc.subResources.push({ type: subType, id: subId, properties: {} });
						doc.nodes.push({ name: "AnimationTree", type: "AnimationTree", parent: p.parent, properties: { tree_root: { type: "SubResource", id: subId }, anim_player: { type: "NodePath", path: p.animPlayerPath }, active: true } });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added AnimationTree (${p.rootType}) to ${p.scenePath}` }] };
					}

					// ── list ───────────────────────────────────────────────
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
						return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
					}

					// ── read_tree ──────────────────────────────────────────
					case "read_tree": {
						if (!p.scenePath) return { content: [{ type: "text" as const, text: "scenePath required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const np = p.nodePath ?? "AnimationTree";
						const treeNode = doc.nodes.find((n) => n.name === np || `${n.parent}/${n.name}` === np);
						if (!treeNode) return { content: [{ type: "text" as const, text: `AnimationTree not found at ${np}` }], isError: true };
						return { content: [{ type: "text" as const, text: JSON.stringify({ node: treeNode.name, properties: treeNode.properties }, null, 2) }] };
					}

					// ── add_state ──────────────────────────────────────────
					case "add_state": {
						if (!p.scenePath || !p.stateName || !p.animationName) return { content: [{ type: "text" as const, text: "scenePath, stateName, animationName required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const treeName = p.treePath ?? "AnimationTree";
						const treeNode = doc.nodes.find((n) => n.name === treeName);
						if (!treeNode) return { content: [{ type: "text" as const, text: `AnimationTree "${treeName}" not found` }], isError: true };

						// Create AnimationNodeAnimation sub_resource for this state
						const animNodeId = `AnimNodeAnim_${generateResourceId()}`;
						doc.subResources.push({
							type: "AnimationNodeAnimation",
							id: animNodeId,
							properties: { animation: `&"${p.animationName}"` },
						});

						// Find the state machine sub_resource and add the state
						const treeRootRef = treeNode.properties.tree_root as { type: string; id: string } | undefined;
						if (treeRootRef?.type === "SubResource") {
							const smRes = doc.subResources.find((r) => r.id === treeRootRef.id);
							if (smRes) {
								smRes.properties[`states/${p.stateName}/node`] = { type: "SubResource", id: animNodeId };
								smRes.properties[`states/${p.stateName}/position`] = `Vector2(0, 0)`;
							}
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added state "${p.stateName}" (animation: ${p.animationName}) to ${treeName}` }] };
					}

					// ── add_transition ─────────────────────────────────────
					case "add_transition": {
						if (!p.scenePath || !p.fromState || !p.toState) return { content: [{ type: "text" as const, text: "scenePath, fromState, toState required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const treeName = p.treePath ?? "AnimationTree";
						const treeNode = doc.nodes.find((n) => n.name === treeName);
						if (!treeNode) return { content: [{ type: "text" as const, text: `AnimationTree "${treeName}" not found` }], isError: true };

						// Create transition sub_resource
						const transId = `AnimTransition_${generateResourceId()}`;
						const switchModeMap: Record<string, number> = { immediate: 0, at_end: 1, sync: 2 };
						const transProps: Record<string, unknown> = {
							switch_mode: switchModeMap[p.switchMode ?? "immediate"] ?? 0,
						};
						if (p.autoAdvance) transProps.auto_advance = true;
						if (p.advanceCondition) transProps.advance_condition = `&"${p.advanceCondition}"`;

						doc.subResources.push({
							type: "AnimationNodeStateMachineTransition",
							id: transId,
							properties: transProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
						});

						// Wire transition into state machine
						const treeRootRef = treeNode.properties.tree_root as { type: string; id: string } | undefined;
						if (treeRootRef?.type === "SubResource") {
							const smRes = doc.subResources.find((r) => r.id === treeRootRef.id);
							if (smRes) {
								// Find next transition index
								let idx = 0;
								while (smRes.properties[`transitions/${idx}/from`] !== undefined) idx++;
								smRes.properties[`transitions/${idx}/from`] = `&"${p.fromState}"`;
								smRes.properties[`transitions/${idx}/to`] = `&"${p.toState}"`;
								smRes.properties[`transitions/${idx}/transition`] = { type: "SubResource", id: transId };
							}
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						const desc = p.autoAdvance ? " (auto-advance)" : p.advanceCondition ? ` (condition: ${p.advanceCondition})` : "";
						return { content: [{ type: "text" as const, text: `Added transition ${p.fromState} → ${p.toState}${desc}` }] };
					}

					// ── blend_space ────────────────────────────────────────
					case "blend_space": {
						if (!p.scenePath || !p.blendType) return { content: [{ type: "text" as const, text: "scenePath, blendType required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const treeName = p.treePath ?? "AnimationTree";
						const treeNode = doc.nodes.find((n) => n.name === treeName);
						if (!treeNode) return { content: [{ type: "text" as const, text: `AnimationTree "${treeName}" not found` }], isError: true };

						const is1D = p.blendType === "1d";
						const blendId = `BlendSpace${is1D ? "1D" : "2D"}_${generateResourceId()}`;
						const blendType = is1D ? "AnimationNodeBlendSpace1D" : "AnimationNodeBlendSpace2D";
						const blendProps: Record<string, unknown> = {};

						if (p.minSpace !== undefined) blendProps[is1D ? "min_space" : "min_space"] = p.minSpace;
						if (p.maxSpace !== undefined) blendProps[is1D ? "max_space" : "max_space"] = p.maxSpace;
						if (p.paramName) blendProps["blend_position"] = 0;

						// Add blend points
						if (p.points) {
							for (let i = 0; i < p.points.length; i++) {
								const pt = p.points[i];
								const animId = `BlendAnim_${generateResourceId()}`;
								doc.subResources.push({
									type: "AnimationNodeAnimation",
									id: animId,
									properties: { animation: `&"${pt.animation}"` },
								});
								blendProps[`blend_point_${i}/node`] = { type: "SubResource", id: animId };
								if (is1D) {
									blendProps[`blend_point_${i}/pos`] = parseFloat(pt.position);
								} else {
									const parts = pt.position.split(",").map((s: string) => parseFloat(s.trim()));
									blendProps[`blend_point_${i}/pos`] = `Vector2(${parts[0] ?? 0}, ${parts[1] ?? 0})`;
								}
							}
						}

						doc.subResources.push({
							type: blendType,
							id: blendId,
							properties: blendProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
						});

						// Replace tree_root with the blend space
						treeNode.properties.tree_root = { type: "SubResource", id: blendId };
						if (p.paramName) {
							treeNode.properties[`parameters/${p.paramName}/blend_position`] = 0;
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Created ${blendType} with ${p.points?.length ?? 0} blend points` }] };
					}

					// ── tween ──────────────────────────────────────────────
					case "tween": {
						if (!p.tweens?.length) return { content: [{ type: "text" as const, text: "tweens[] required" }], isError: true };
						const obj = p.objectPath ? `$${p.objectPath}` : "self";
						const lines: string[] = ["var tween := create_tween()"];
						if (p.loop) lines.push("tween.set_loops()");
						if (p.parallel) lines.push("tween.set_parallel(true)");

						for (const tw of p.tweens) {
							let line = `tween.tween_property(${obj}, "${tw.property}", ${tw.finalValue}, ${tw.duration})`;
							if (tw.transType) line += `.set_trans(Tween.TRANS_${tw.transType.toUpperCase()})`;
							if (tw.easeType) line += `.set_ease(Tween.EASE_${tw.easeType.toUpperCase()})`;
							lines.push(line);
						}
						return { content: [{ type: "text" as const, text: lines.join("\n") }] };
					}
				}
			} catch (e) { return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true }; }
		},
	);
}
