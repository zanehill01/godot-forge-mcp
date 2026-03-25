/**
 * 3D Tool Group — 7 tools for 3D setup.
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

	server.tool("godot_configure_material", "Create a StandardMaterial3D .tres resource.", {
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

	server.tool("godot_setup_environment", "Add WorldEnvironment + sky + directional light to a scene.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		skyType: z.enum(["procedural", "physical", "panorama"]).optional().default("procedural"),
		ambientColor: z.string().optional(), fogEnabled: z.boolean().optional().default(false),
		ssaoEnabled: z.boolean().optional().default(false), glowEnabled: z.boolean().optional().default(false),
	}, async ({ scenePath, parent, skyType }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			// Add WorldEnvironment with a basic setup
			doc.nodes.push({ name: "WorldEnvironment", type: "WorldEnvironment", parent, properties: {} });
			doc.nodes.push({ name: "DirectionalLight3D", type: "DirectionalLight3D", parent, properties: {
				transform: { type: "Transform3D", basis: [0.866, -0.433, 0.25, 0, 0.5, 0.866, -0.5, -0.75, 0.433], origin: [0, 10, 0] },
				shadow_enabled: true,
			} });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added WorldEnvironment (${skyType} sky) + DirectionalLight3D to ${scenePath}. Configure Environment resource in the editor for full sky/fog/SSAO/glow settings.` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_create_camera_rig", "Generate GDScript for common camera setups.", {
		style: z.enum(["follow", "orbit", "first_person", "top_down", "side_scroll"]),
		is3d: z.boolean().optional().default(true),
	}, async ({ style, is3d }) => {
		const scripts: Record<string, string> = {
			follow: is3d ? `extends Camera3D\n\n@export var target: Node3D\n@export var offset := Vector3(0, 5, -10)\n@export var smooth_speed := 5.0\n\nfunc _physics_process(delta: float) -> void:\n\tif target:\n\t\tvar desired := target.global_position + offset\n\t\tglobal_position = global_position.lerp(desired, smooth_speed * delta)\n\t\tlook_at(target.global_position)\n` : `extends Camera2D\n\n@export var target: Node2D\n@export var smooth_speed := 5.0\n\nfunc _physics_process(delta: float) -> void:\n\tif target:\n\t\tglobal_position = global_position.lerp(target.global_position, smooth_speed * delta)\n`,
			orbit: `extends Node3D\n\n@export var target: Node3D\n@export var distance := 10.0\n@export var rotation_speed := 0.01\n@export var min_pitch := -80.0\n@export var max_pitch := 80.0\n\nvar _yaw := 0.0\nvar _pitch := -30.0\n\nfunc _unhandled_input(event: InputEvent) -> void:\n\tif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):\n\t\t_yaw -= event.relative.x * rotation_speed\n\t\t_pitch -= event.relative.y * rotation_speed\n\t\t_pitch = clampf(_pitch, min_pitch, max_pitch)\n\nfunc _physics_process(_delta: float) -> void:\n\tif not target:\n\t\treturn\n\tvar offset := Vector3(\n\t\tsin(deg_to_rad(_yaw)) * cos(deg_to_rad(_pitch)),\n\t\tsin(deg_to_rad(_pitch)),\n\t\tcos(deg_to_rad(_yaw)) * cos(deg_to_rad(_pitch))\n\t) * distance\n\tglobal_position = target.global_position + offset\n\tlook_at(target.global_position)\n`,
			first_person: `extends Camera3D\n\n@export var mouse_sensitivity := 0.002\nvar _pitch := 0.0\n\nfunc _ready() -> void:\n\tInput.mouse_mode = Input.MOUSE_MODE_CAPTURED\n\nfunc _unhandled_input(event: InputEvent) -> void:\n\tif event is InputEventMouseMotion:\n\t\tget_parent().rotate_y(-event.relative.x * mouse_sensitivity)\n\t\t_pitch -= event.relative.y * mouse_sensitivity\n\t\t_pitch = clampf(_pitch, deg_to_rad(-89), deg_to_rad(89))\n\t\trotation.x = _pitch\n\tif event.is_action_pressed("ui_cancel"):\n\t\tInput.mouse_mode = Input.MOUSE_MODE_VISIBLE\n`,
			top_down: `extends Camera3D\n\n@export var target: Node3D\n@export var height := 15.0\n@export var smooth_speed := 5.0\n\nfunc _ready() -> void:\n\trotation_degrees = Vector3(-90, 0, 0)\n\nfunc _physics_process(delta: float) -> void:\n\tif target:\n\t\tvar desired := Vector3(target.global_position.x, height, target.global_position.z)\n\t\tglobal_position = global_position.lerp(desired, smooth_speed * delta)\n`,
			side_scroll: `extends Camera2D\n\n@export var target: Node2D\n@export var look_ahead := 100.0\n@export var smooth_speed := 5.0\n\nfunc _physics_process(delta: float) -> void:\n\tif target:\n\t\tvar ahead := target.velocity.normalized() * look_ahead if target is CharacterBody2D else Vector2.ZERO\n\t\tvar desired := target.global_position + ahead\n\t\tglobal_position = global_position.lerp(desired, smooth_speed * delta)\n`,
		};
		return { content: [{ type: "text", text: scripts[style] ?? "# Camera style not found" }] };
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

	server.tool("godot_lod_setup", "Configure LOD visibility ranges on a MeshInstance3D.", {
		scenePath: z.string(), nodePath: z.string(),
		ranges: z.array(z.object({ begin: z.number(), end: z.number(), fadeMode: z.enum(["disabled", "self", "dependencies"]).optional() })),
	}, async ({ scenePath, nodePath, ranges }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === nodePath);
			if (!node) return { content: [{ type: "text", text: `Node not found` }], isError: true };
			if (ranges[0]) { node.properties.visibility_range_begin = ranges[0].begin; node.properties.visibility_range_end = ranges[0].end; }
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Configured LOD on "${nodePath}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_import_config", "Modify .import file settings for an asset.", {
		assetPath: z.string().describe("Asset path (res://, e.g., res://models/player.glb)"),
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
