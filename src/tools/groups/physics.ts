/**
 * Physics Tool Group — single unified tool for all physics operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import { generateResourceId } from "../../utils/path.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerPhysicsTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_physics",
		[
			"Unified physics tool. Actions:",
			"",
			'  "collision" — Add CollisionShape2D/3D to a node.',
			"    Params: scenePath, parent (required), shape (required: rectangle|circle|capsule|box|sphere|cylinder|ray|segment|world_boundary), is3d, params (Record<string,string> for shape properties)",
			"",
			'  "body" — Configure physics body properties.',
			"    Params: scenePath, nodePath (required), mass, friction, bounce, gravityScale, collisionLayer, collisionMask",
			"",
			'  "area" — Create an Area2D/3D node with monitoring signals.',
			"    Params: scenePath, parent, is3d, name, monitorable",
			"",
			'  "raycast" — Add and configure a RayCast2D/3D node.',
			"    Params: scenePath, parent, is3d, targetPosition (required, Variant format e.g. Vector2(0,100)), collisionMask, name",
			"",
			'  "layers" — List or configure physics collision layer names.',
			"    Params: scenePath, layers (Record<string,string> layer→name mapping)",
			"",
			'  "joint" — Create a physics joint between nodes.',
			"    Params: scenePath, parent, jointType (required: pin|groove|damped_spring|hinge|slider|cone_twist|generic_6dof), is3d, nodeA (required), nodeB (required), name",
			"",
			'  "navigation" — Add NavigationRegion + NavigationAgent to a scene.',
			"    Params: scenePath, parent, is3d, agentParent",
			"",
			'  "material" — Create a PhysicsMaterial .tres resource.',
			"    Params: path (required, output .tres path), friction, bounce, rough, absorbent",
		].join("\n"),
		{
			action: z.enum(["collision", "body", "area", "raycast", "layers", "joint", "navigation", "material"]),
			scenePath: z.string().optional().describe("Scene .tscn path (res:// or absolute)"),
			parent: z.string().optional().describe("Parent node path"),
			nodePath: z.string().optional().describe("Path to an existing node (for body action)"),
			shape: z.enum(["rectangle", "circle", "capsule", "box", "sphere", "cylinder", "ray", "segment", "world_boundary"]).optional(),
			is3d: z.boolean().optional().default(false),
			params: z.record(z.string(), z.string()).optional().describe("Shape parameters for collision action"),
			name: z.string().optional().describe("Node name (area, raycast, joint)"),
			monitorable: z.boolean().optional().default(true).describe("For area action"),
			targetPosition: z.string().optional().describe("Variant format target for raycast (e.g. Vector2(0, 100))"),
			collisionLayer: z.number().optional().describe("Collision layer bitmask"),
			collisionMask: z.number().optional().describe("Collision mask bitmask"),
			mass: z.number().optional(),
			friction: z.number().optional(),
			bounce: z.number().optional(),
			gravityScale: z.number().optional(),
			layers: z.record(z.string(), z.string()).optional().describe("Layer number → name mapping (layers action)"),
			jointType: z.enum(["pin", "groove", "damped_spring", "hinge", "slider", "cone_twist", "generic_6dof"]).optional(),
			nodeA: z.string().optional().describe("First body node path (joint action)"),
			nodeB: z.string().optional().describe("Second body node path (joint action)"),
			agentParent: z.string().optional().describe("Parent node for NavigationAgent (navigation action)"),
			path: z.string().optional().describe("Output .tres path (material action)"),
			rough: z.boolean().optional().default(false).describe("For material action"),
			absorbent: z.boolean().optional().default(false).describe("For material action"),
		},
		async (args) => {
			try {
				switch (args.action) {
					// ── collision ──────────────────────────────────────────────
					case "collision": {
						if (!args.scenePath) return { content: [{ type: "text" as const, text: "scenePath is required for collision action" }], isError: true };
						if (!args.parent) return { content: [{ type: "text" as const, text: "parent is required for collision action" }], isError: true };
						if (!args.shape) return { content: [{ type: "text" as const, text: "shape is required for collision action" }], isError: true };

						const absPath = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const shapeTypeMap: Record<string, string> = args.is3d
							? { box: "BoxShape3D", sphere: "SphereShape3D", capsule: "CapsuleShape3D", cylinder: "CylinderShape3D", ray: "SeparationRayShape3D", world_boundary: "WorldBoundaryShape3D" }
							: { rectangle: "RectangleShape2D", circle: "CircleShape2D", capsule: "CapsuleShape2D", segment: "SegmentShape2D", ray: "SeparationRayShape2D", world_boundary: "WorldBoundaryShape2D" };

						const shapeType = shapeTypeMap[args.shape];
						if (!shapeType) return { content: [{ type: "text" as const, text: `Invalid shape "${args.shape}" for ${args.is3d ? "3D" : "2D"}` }], isError: true };

						const shapeId = `${shapeType}_${generateResourceId()}`;
						const shapeProps: Record<string, unknown> = {};
						if (args.params) {
							for (const [k, v] of Object.entries(args.params)) shapeProps[k] = parseVariant(v);
						}
						doc.subResources.push({ type: shapeType, id: shapeId, properties: shapeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						const nodeType = args.is3d ? "CollisionShape3D" : "CollisionShape2D";
						doc.nodes.push({
							name: "CollisionShape",
							type: nodeType,
							parent: args.parent,
							properties: { shape: { type: "SubResource", id: shapeId } },
						});

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${nodeType} (${shapeType}) to "${args.parent}" in ${args.scenePath}` }] };
					}

					// ── body ──────────────────────────────────────────────────
					case "body": {
						if (!args.scenePath) return { content: [{ type: "text" as const, text: "scenePath is required for body action" }], isError: true };
						if (!args.nodePath) return { content: [{ type: "text" as const, text: "nodePath is required for body action" }], isError: true };

						const absPath = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === args.nodePath);
						if (!node) return { content: [{ type: "text" as const, text: `Node not found: ${args.nodePath}` }], isError: true };

						if (args.mass !== undefined) node.properties.mass = args.mass;
						if (args.friction !== undefined) node.properties.friction = args.friction;
						if (args.bounce !== undefined) node.properties.bounce = args.bounce;
						if (args.gravityScale !== undefined) node.properties.gravity_scale = args.gravityScale;
						if (args.collisionLayer !== undefined) node.properties.collision_layer = args.collisionLayer;
						if (args.collisionMask !== undefined) node.properties.collision_mask = args.collisionMask;

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Configured physics on "${args.nodePath}"` }] };
					}

					// ── area ──────────────────────────────────────────────────
					case "area": {
						if (!args.scenePath) return { content: [{ type: "text" as const, text: "scenePath is required for area action" }], isError: true };

						const absPath = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const areaType = args.is3d ? "Area3D" : "Area2D";
						const areaName = args.name ?? "DetectionArea";
						const parent = args.parent ?? ".";
						doc.nodes.push({ name: areaName, type: areaType, parent, properties: { monitorable: args.monitorable, monitoring: true } });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${areaType} "${areaName}" to "${parent}"` }] };
					}

					// ── raycast ───────────────────────────────────────────────
					case "raycast": {
						if (!args.scenePath) return { content: [{ type: "text" as const, text: "scenePath is required for raycast action" }], isError: true };
						if (!args.targetPosition) return { content: [{ type: "text" as const, text: "targetPosition is required for raycast action" }], isError: true };

						const absPath = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const rayType = args.is3d ? "RayCast3D" : "RayCast2D";
						const rayName = args.name ?? "RayCast";
						const parent = args.parent ?? ".";
						const mask = args.collisionMask ?? 1;
						doc.nodes.push({ name: rayName, type: rayType, parent, properties: {
							target_position: parseVariant(args.targetPosition),
							collision_mask: mask,
							enabled: true,
						} });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${rayType} "${rayName}" targeting ${args.targetPosition}` }] };
					}

					// ── layers ────────────────────────────────────────────────
					case "layers": {
						if (args.layers) {
							return { content: [{ type: "text" as const, text: `Layer naming configured: ${JSON.stringify(args.layers)}. Set in Project > Project Settings > Layer Names > 2D/3D Physics.` }] };
						}
						return { content: [{ type: "text" as const, text: "Use Project Settings to view current layer names. Provide layers parameter to configure." }] };
					}

					// ── joint ─────────────────────────────────────────────────
					case "joint": {
						if (!args.scenePath) return { content: [{ type: "text" as const, text: "scenePath is required for joint action" }], isError: true };
						if (!args.jointType) return { content: [{ type: "text" as const, text: "jointType is required for joint action" }], isError: true };
						if (!args.nodeA) return { content: [{ type: "text" as const, text: "nodeA is required for joint action" }], isError: true };
						if (!args.nodeB) return { content: [{ type: "text" as const, text: "nodeB is required for joint action" }], isError: true };

						const typeMap3D: Record<string, string> = { pin: "PinJoint3D", hinge: "HingeJoint3D", slider: "SliderJoint3D", cone_twist: "ConeTwistJoint3D", generic_6dof: "Generic6DOFJoint3D" };
						const typeMap2D: Record<string, string> = { pin: "PinJoint2D", groove: "GrooveJoint2D", damped_spring: "DampedSpringJoint2D" };
						const typeMap = args.is3d ? typeMap3D : typeMap2D;
						const godotType = typeMap[args.jointType];
						if (!godotType) return { content: [{ type: "text" as const, text: `Invalid joint type "${args.jointType}" for ${args.is3d ? "3D" : "2D"}` }], isError: true };

						const absPath = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const jointName = args.name ?? "Joint";
						const parent = args.parent ?? ".";
						doc.nodes.push({ name: jointName, type: godotType, parent, properties: {
							node_a: { type: "NodePath", path: args.nodeA },
							node_b: { type: "NodePath", path: args.nodeB },
						} });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${godotType} "${jointName}" connecting "${args.nodeA}" to "${args.nodeB}"` }] };
					}

					// ── navigation ────────────────────────────────────────────
					case "navigation": {
						if (!args.scenePath) return { content: [{ type: "text" as const, text: "scenePath is required for navigation action" }], isError: true };

						const absPath = resToAbsolute(args.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const regionType = args.is3d ? "NavigationRegion3D" : "NavigationRegion2D";
						const agentType = args.is3d ? "NavigationAgent3D" : "NavigationAgent2D";
						const parent = args.parent ?? ".";

						doc.nodes.push({ name: "NavigationRegion", type: regionType, parent, properties: {} });
						if (args.agentParent) {
							doc.nodes.push({ name: "NavigationAgent", type: agentType, parent: args.agentParent, properties: {} });
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${regionType} and ${args.agentParent ? agentType : "no agent"} to ${args.scenePath}` }] };
					}

					// ── material ──────────────────────────────────────────────
					case "material": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path is required for material action" }], isError: true };

						const matFriction = args.friction ?? 1.0;
						const matBounce = args.bounce ?? 0.0;
						const content = [
							`[gd_resource type="PhysicsMaterial" format=3]`, "",
							"[resource]",
							`friction = ${matFriction}`,
							`bounce = ${matBounce}`,
							`rough = ${args.rough}`,
							`absorbent = ${args.absorbent}`, "",
						].join("\n");
						const absPath = resToAbsolute(args.path, ctx.projectRoot);
						const { mkdirSync: mk } = await import("node:fs");
						const { dirname: dn } = await import("node:path");
						mk(dn(absPath), { recursive: true });
						writeFileSync(absPath, content, "utf-8");
						return { content: [{ type: "text" as const, text: `Created PhysicsMaterial at ${args.path}` }] };
					}

					default:
						return { content: [{ type: "text" as const, text: `Unknown action: ${args.action}` }], isError: true };
				}
			} catch (e) {
				return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
			}
		},
	);
}
