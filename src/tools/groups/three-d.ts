/**
 * 3D Tool Group — 5 tools that manipulate scene and resource files.
 *
 * Removed: create_camera_rig (pure code-gen an LLM can do natively).
 * Removed: lod_setup (minimal value — just sets one property).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerThreeDTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_create_mesh", "Add a procedural mesh (primitive or CSG) to a scene.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		meshType: z.enum(["box", "sphere", "cylinder", "capsule", "plane", "prism", "torus", "csg_box", "csg_sphere", "csg_cylinder"]),
		name: z.string().optional().default("Mesh"),
		size: z.string().optional().describe("Size in Variant format (e.g., Vector3(2, 1, 2))"),
	}, async ({ scenePath, parent, meshType, name, size }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const csgTypes: Record<string, string> = { csg_box: "CSGBox3D", csg_sphere: "CSGSphere3D", csg_cylinder: "CSGCylinder3D" };
			if (csgTypes[meshType]) {
				const props: Record<string, unknown> = {};
				if (size) props.size = parseVariant(size);
				doc.nodes.push({ name, type: csgTypes[meshType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			} else {
				const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh", prism: "PrismMesh", torus: "TorusMesh" };
				const subId = `${meshMap[meshType]}_${generateResourceId()}`;
				const meshProps: Record<string, unknown> = {};
				if (size) meshProps.size = parseVariant(size);
				doc.subResources.push({ type: meshMap[meshType], id: subId, properties: meshProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
				doc.nodes.push({ name, type: "MeshInstance3D", parent, properties: { mesh: { type: "SubResource", id: subId } } });
			}
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${meshType} mesh "${name}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_configure_material", "Create a StandardMaterial3D .tres resource file.", {
		path: z.string(), albedoColor: z.string().optional(), metallic: z.number().optional(),
		roughness: z.number().optional(), emission: z.string().optional(),
		emissionEnergy: z.number().optional(), transparency: z.enum(["disabled", "alpha", "alpha_scissor"]).optional(),
		albedoTexture: z.string().optional().describe("Texture path (res://)"),
	}, async ({ path, albedoColor, metallic, roughness, emission, emissionEnergy, transparency, albedoTexture }) => {
		try {
			const lines = [`[gd_resource type="StandardMaterial3D" format=3]`, ""];
			if (albedoTexture) { lines.push(`[ext_resource type="Texture2D" path="${albedoTexture}" id="1_tex"]`); lines.push(""); }
			lines.push("[resource]");
			if (albedoColor) lines.push(`albedo_color = ${albedoColor}`);
			if (albedoTexture) lines.push(`albedo_texture = ExtResource("1_tex")`);
			if (metallic !== undefined) lines.push(`metallic = ${metallic}`);
			if (roughness !== undefined) lines.push(`roughness = ${roughness}`);
			if (emission) { lines.push(`emission_enabled = true`); lines.push(`emission = ${emission}`); }
			if (emissionEnergy !== undefined) lines.push(`emission_energy_multiplier = ${emissionEnergy}`);
			if (transparency && transparency !== "disabled") { const map: Record<string, number> = { alpha: 1, alpha_scissor: 2 }; lines.push(`transparency = ${map[transparency]}`); }
			lines.push("");
			const absPath = resToAbsolute(path, ctx.projectRoot);
			const { mkdirSync } = await import("node:fs"); const { dirname } = await import("node:path");
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, lines.join("\n"), "utf-8");
			return { content: [{ type: "text", text: `Created StandardMaterial3D at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_setup_environment", "Add WorldEnvironment + DirectionalLight3D to a 3D scene.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
	}, async ({ scenePath, parent }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			doc.nodes.push({ name: "WorldEnvironment", type: "WorldEnvironment", parent, properties: {} });
			doc.nodes.push({ name: "DirectionalLight3D", type: "DirectionalLight3D", parent, properties: {
				transform: { type: "Transform3D", basis: [0.866, -0.433, 0.25, 0, 0.5, 0.866, -0.5, -0.75, 0.433], origin: [0, 10, 0] },
				shadow_enabled: true,
			} });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added WorldEnvironment + DirectionalLight3D to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_configure_light", "Add and configure a light node in a scene.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		lightType: z.enum(["directional", "omni", "spot"]),
		color: z.string().optional().default("Color(1, 1, 1, 1)"),
		energy: z.number().optional().default(1.0),
		shadowEnabled: z.boolean().optional().default(true),
		name: z.string().optional().default("Light"),
	}, async ({ scenePath, parent, lightType, color, energy, shadowEnabled, name }) => {
		try {
			const typeMap: Record<string, string> = { directional: "DirectionalLight3D", omni: "OmniLight3D", spot: "SpotLight3D" };
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			doc.nodes.push({ name, type: typeMap[lightType], parent, properties: {
				light_color: parseVariant(color),
				light_energy: energy,
				shadow_enabled: shadowEnabled,
			} });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${typeMap[lightType]} "${name}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_import_config", "Modify .import file settings for an asset.", {
		assetPath: z.string().describe("Asset path (res://)"),
		settings: z.record(z.string(), z.string()).describe("Import parameter overrides"),
	}, async ({ assetPath, settings }) => {
		try {
			const importPath = resToAbsolute(assetPath + ".import", ctx.projectRoot);
			let content = readFileSync(importPath, "utf-8");
			for (const [k, v] of Object.entries(settings)) {
				const regex = new RegExp(`^${k.replace("/", "\\/")}=.*$`, "m");
				if (regex.test(content)) content = content.replace(regex, `${k}=${v}`);
				else content += `${k}=${v}\n`;
			}
			writeFileSync(importPath, content, "utf-8");
			return { content: [{ type: "text", text: `Updated import settings for ${assetPath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
