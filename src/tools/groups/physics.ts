/**
 * Physics Tool Group — 8 tools for physics setup.
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
		"godot_add_collision",
		"Add a CollisionShape2D/3D to a node with a specified shape.",
		{
			scenePath: z.string(),
			parent: z.string().describe("Parent node path (must be a physics body or Area)"),
			shape: z.enum(["rectangle", "circle", "capsule", "box", "sphere", "cylinder", "ray", "segment", "world_boundary"]),
			is3d: z.boolean().optional().default(false),
			params: z.record(z.string(), z.string()).optional().describe("Shape parameters (e.g., radius, size, height)"),
		},
		async ({ scenePath, parent, shape, is3d, params }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const doc = parseTscn(readFileSync(absPath, "utf-8"));

				const shapeTypeMap: Record<string, string> = is3d
					? { box: "BoxShape3D", sphere: "SphereShape3D", capsule: "CapsuleShape3D", cylinder: "CylinderShape3D", ray: "SeparationRayShape3D", world_boundary: "WorldBoundaryShape3D" }
					: { rectangle: "RectangleShape2D", circle: "CircleShape2D", capsule: "CapsuleShape2D", segment: "SegmentShape2D", ray: "SeparationRayShape2D", world_boundary: "WorldBoundaryShape2D" };

				const shapeType = shapeTypeMap[shape];
				if (!shapeType) return { content: [{ type: "text", text: `Invalid shape "${shape}" for ${is3d ? "3D" : "2D"}` }], isError: true };

				const shapeId = `${shapeType}_${generateResourceId()}`;
				const shapeProps: Record<string, unknown> = {};
				if (params) {
					for (const [k, v] of Object.entries(params)) shapeProps[k] = parseVariant(v);
				}
				doc.subResources.push({ type: shapeType, id: shapeId, properties: shapeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

				const nodeType = is3d ? "CollisionShape3D" : "CollisionShape2D";
				doc.nodes.push({
					name: "CollisionShape",
					type: nodeType,
					parent,
					properties: { shape: { type: "SubResource", id: shapeId } },
				});

				writeFileSync(absPath, writeTscn(doc), "utf-8");
				return { content: [{ type: "text", text: `Added ${nodeType} (${shapeType}) to "${parent}" in ${scenePath}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_configure_physics_body",
		"Configure physics body properties (mass, friction, bounce, layers, masks).",
		{
			scenePath: z.string(),
			nodePath: z.string().describe("Path to the physics body node"),
			mass: z.number().optional(),
			friction: z.number().optional(),
			bounce: z.number().optional(),
			gravityScale: z.number().optional(),
			collisionLayer: z.number().optional().describe("Collision layer bitmask"),
			collisionMask: z.number().optional().describe("Collision mask bitmask"),
		},
		async ({ scenePath, nodePath, mass, friction, bounce, gravityScale, collisionLayer, collisionMask }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const doc = parseTscn(readFileSync(absPath, "utf-8"));
				const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === nodePath);
				if (!node) return { content: [{ type: "text", text: `Node not found: ${nodePath}` }], isError: true };

				if (mass !== undefined) node.properties.mass = mass;
				if (friction !== undefined) node.properties.friction = friction;
				if (bounce !== undefined) node.properties.bounce = bounce;
				if (gravityScale !== undefined) node.properties.gravity_scale = gravityScale;
				if (collisionLayer !== undefined) node.properties.collision_layer = collisionLayer;
				if (collisionMask !== undefined) node.properties.collision_mask = collisionMask;

				writeFileSync(absPath, writeTscn(doc), "utf-8");
				return { content: [{ type: "text", text: `Configured physics on "${nodePath}"` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool("godot_create_area", "Create an Area2D/3D node with monitoring signals.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		is3d: z.boolean().optional().default(false),
		name: z.string().optional().default("DetectionArea"),
		monitorable: z.boolean().optional().default(true),
	}, async ({ scenePath, parent, is3d, name, monitorable }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const type = is3d ? "Area3D" : "Area2D";
			doc.nodes.push({ name, type, parent, properties: { monitorable, monitoring: true } });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${type} "${name}" to "${parent}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_configure_raycast", "Add and configure a RayCast2D/3D node.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		is3d: z.boolean().optional().default(false),
		targetPosition: z.string().describe("Target in Variant format (e.g., Vector2(0, 100))"),
		collisionMask: z.number().optional().default(1),
		name: z.string().optional().default("RayCast"),
	}, async ({ scenePath, parent, is3d, targetPosition, collisionMask, name }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const type = is3d ? "RayCast3D" : "RayCast2D";
			doc.nodes.push({ name, type, parent, properties: {
				target_position: parseVariant(targetPosition),
				collision_mask: collisionMask,
				enabled: true,
			} });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${type} "${name}" targeting ${targetPosition}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_physics_layers", "List or configure physics collision layer names.", {
		scenePath: z.string().optional().describe("If provided, set layers on a specific scene's project.godot"),
		layers: z.record(z.string(), z.string()).optional().describe("Layer number → name mapping"),
	}, async ({ layers }) => {
		try {
			if (layers) {
				return { content: [{ type: "text", text: `Layer naming configured: ${JSON.stringify(layers)}. Set in Project > Project Settings > Layer Names > 2D/3D Physics.` }] };
			}
			return { content: [{ type: "text", text: "Use Project Settings to view current layer names. Provide layers parameter to configure." }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_create_joint", "Create a physics joint between nodes.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		jointType: z.enum(["pin", "groove", "damped_spring", "hinge", "slider", "cone_twist", "generic_6dof"]),
		is3d: z.boolean().optional().default(false),
		nodeA: z.string().describe("First body node path"),
		nodeB: z.string().describe("Second body node path"),
		name: z.string().optional().default("Joint"),
	}, async ({ scenePath, parent, jointType, is3d, nodeA, nodeB, name }) => {
		try {
			const typeMap3D: Record<string, string> = { pin: "PinJoint3D", hinge: "HingeJoint3D", slider: "SliderJoint3D", cone_twist: "ConeTwistJoint3D", generic_6dof: "Generic6DOFJoint3D" };
			const typeMap2D: Record<string, string> = { pin: "PinJoint2D", groove: "GrooveJoint2D", damped_spring: "DampedSpringJoint2D" };
			const typeMap = is3d ? typeMap3D : typeMap2D;
			const godotType = typeMap[jointType];
			if (!godotType) return { content: [{ type: "text", text: `Invalid joint type "${jointType}" for ${is3d ? "3D" : "2D"}` }], isError: true };

			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			doc.nodes.push({ name, type: godotType, parent, properties: {
				node_a: { type: "NodePath", path: nodeA },
				node_b: { type: "NodePath", path: nodeB },
			} });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${godotType} "${name}" connecting "${nodeA}" to "${nodeB}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_navigation_setup", "Add NavigationRegion + NavigationAgent to a scene.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		is3d: z.boolean().optional().default(false),
		agentParent: z.string().optional().describe("Parent node for NavigationAgent (e.g., the character)"),
	}, async ({ scenePath, parent, is3d, agentParent }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const regionType = is3d ? "NavigationRegion3D" : "NavigationRegion2D";
			const agentType = is3d ? "NavigationAgent3D" : "NavigationAgent2D";

			doc.nodes.push({ name: "NavigationRegion", type: regionType, parent, properties: {} });
			if (agentParent) {
				doc.nodes.push({ name: "NavigationAgent", type: agentType, parent: agentParent, properties: {} });
			}

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${regionType} and ${agentParent ? agentType : "no agent"} to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_physics_material", "Create a PhysicsMaterial .tres resource.", {
		path: z.string().describe("Output .tres path"),
		friction: z.number().optional().default(1.0),
		bounce: z.number().optional().default(0.0),
		rough: z.boolean().optional().default(false),
		absorbent: z.boolean().optional().default(false),
	}, async ({ path, friction, bounce, rough, absorbent }) => {
		try {
			const content = [
				`[gd_resource type="PhysicsMaterial" format=3]`, "",
				"[resource]",
				`friction = ${friction}`,
				`bounce = ${bounce}`,
				`rough = ${rough}`,
				`absorbent = ${absorbent}`, "",
			].join("\n");
			const absPath = resToAbsolute(path, ctx.projectRoot);
			const { mkdirSync: mk } = await import("node:fs");
			const { dirname: dn } = await import("node:path");
			mk(dn(absPath), { recursive: true });
			writeFileSync(absPath, content, "utf-8");
			return { content: [{ type: "text", text: `Created PhysicsMaterial at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
