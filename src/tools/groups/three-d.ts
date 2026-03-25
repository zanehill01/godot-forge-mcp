/**
 * 3D Tool Group — 9 tools for 3D scene and resource manipulation.
 *
 * All tools write real .tscn/.tres files with proper sub-resources.
 * No code-gen wrappers — every tool manipulates project state.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerThreeDTools(server: McpServer, ctx: ToolContext): void {
	// ═══════════════════════════════════════════════════════════
	// Mesh Creation
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_create_mesh", "Add a procedural mesh (primitive or CSG) node to a scene with proper sub-resource.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		meshType: z.enum(["box", "sphere", "cylinder", "capsule", "plane", "prism", "torus", "csg_box", "csg_sphere", "csg_cylinder"]),
		name: z.string().optional().default("Mesh"),
		size: z.string().optional().describe("Size in Variant format (e.g., Vector3(2, 1, 2))"),
		materialPath: z.string().optional().describe("Material resource path (res://) to assign"),
	}, async ({ scenePath, parent, meshType, name, size, materialPath }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const csgTypes: Record<string, string> = { csg_box: "CSGBox3D", csg_sphere: "CSGSphere3D", csg_cylinder: "CSGCylinder3D" };

			if (csgTypes[meshType]) {
				const props: Record<string, unknown> = {};
				if (size) props.size = parseVariant(size);
				if (materialPath) {
					const matId = generateResourceId();
					doc.extResources.push({ type: "Material", uid: generateUid(), path: materialPath, id: matId });
					props.material = { type: "ExtResource", id: matId };
				}
				doc.nodes.push({ name, type: csgTypes[meshType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			} else {
				const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh", prism: "PrismMesh", torus: "TorusMesh" };
				const subId = `${meshMap[meshType]}_${generateResourceId()}`;
				const meshProps: Record<string, unknown> = {};
				if (size) meshProps.size = parseVariant(size);
				if (materialPath) {
					const matId = generateResourceId();
					doc.extResources.push({ type: "Material", uid: generateUid(), path: materialPath, id: matId });
					meshProps.material = { type: "ExtResource", id: matId };
				}
				doc.subResources.push({ type: meshMap[meshType], id: subId, properties: meshProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
				doc.nodes.push({ name, type: "MeshInstance3D", parent, properties: { mesh: { type: "SubResource", id: subId } } });
			}

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${meshType} mesh "${name}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Model Instancing (.glb/.gltf/.fbx → scene)
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_model", "Add a 3D model (.glb, .gltf, .fbx, .obj) to a scene as an instanced scene. Godot imports these as PackedScenes, so they're added as scene instances with optional transform and material overrides.", {
		scenePath: z.string().describe("Target scene path (res://)"),
		modelPath: z.string().describe("Model file path (res://, e.g., res://models/tree.glb)"),
		name: z.string().optional().default("Model"),
		parent: z.string().optional().default("."),
		transform: z.string().optional().describe("Transform3D in Variant format"),
		scale: z.string().optional().describe("Scale as Vector3 (e.g., Vector3(2, 2, 2))"),
	}, async ({ scenePath, modelPath, name, parent, transform, scale }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			// Godot imports .glb/.gltf as PackedScenes — instance them
			const resId = generateResourceId();
			doc.extResources.push({
				type: "PackedScene",
				uid: generateUid(),
				path: modelPath,
				id: resId,
			});

			const props: Record<string, unknown> = {};
			if (transform) props.transform = parseVariant(transform);
			if (scale) {
				// If only scale is given, construct a transform with identity rotation + scale
				const s = parseVariant(scale);
				if (!transform && typeof s === "object" && s !== null && "type" in s && s.type === "Vector3") {
					props.transform = {
						type: "Transform3D",
						basis: [(s as { x: number }).x, 0, 0, 0, (s as { y: number }).y, 0, 0, 0, (s as { z: number }).z],
						origin: [0, 0, 0],
					};
				}
			}

			doc.nodes.push({
				name,
				parent,
				instance: { type: "ExtResource", id: resId },
				properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added model instance "${name}" (${modelPath}) to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Materials
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_configure_material", "Create a StandardMaterial3D .tres resource file with PBR properties.", {
		path: z.string(), albedoColor: z.string().optional(), metallic: z.number().optional(),
		roughness: z.number().optional(), emission: z.string().optional(),
		emissionEnergy: z.number().optional(), transparency: z.enum(["disabled", "alpha", "alpha_scissor"]).optional(),
		albedoTexture: z.string().optional().describe("Texture path (res://)"),
		normalTexture: z.string().optional().describe("Normal map path (res://)"),
	}, async ({ path, albedoColor, metallic, roughness, emission, emissionEnergy, transparency, albedoTexture, normalTexture }) => {
		try {
			const lines = [`[gd_resource type="StandardMaterial3D" format=3]`, ""];
			let extId = 1;
			if (albedoTexture) { lines.push(`[ext_resource type="Texture2D" path="${albedoTexture}" id="${extId}_tex"]`); extId++; }
			if (normalTexture) { lines.push(`[ext_resource type="Texture2D" path="${normalTexture}" id="${extId}_norm"]`); }
			if (albedoTexture || normalTexture) lines.push("");
			lines.push("[resource]");
			if (albedoColor) lines.push(`albedo_color = ${albedoColor}`);
			if (albedoTexture) lines.push(`albedo_texture = ExtResource("1_tex")`);
			if (normalTexture) { lines.push(`normal_enabled = true`); lines.push(`normal_texture = ExtResource("${extId}_norm")`); }
			if (metallic !== undefined) lines.push(`metallic = ${metallic}`);
			if (roughness !== undefined) lines.push(`roughness = ${roughness}`);
			if (emission) { lines.push(`emission_enabled = true`); lines.push(`emission = ${emission}`); }
			if (emissionEnergy !== undefined) lines.push(`emission_energy_multiplier = ${emissionEnergy}`);
			if (transparency && transparency !== "disabled") { const map: Record<string, number> = { alpha: 1, alpha_scissor: 2 }; lines.push(`transparency = ${map[transparency]}`); }
			lines.push("");
			const absPath = resToAbsolute(path, ctx.projectRoot);
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, lines.join("\n"), "utf-8");
			return { content: [{ type: "text", text: `Created StandardMaterial3D at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Environment
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_create_environment", "Create a full Environment .tres resource with sky, fog, tonemap, SSAO, glow, and volumetric fog settings. Also adds WorldEnvironment + DirectionalLight3D nodes to a scene.", {
		scenePath: z.string().describe("Scene to add WorldEnvironment to (res://)"),
		parent: z.string().optional().default("."),
		sky: z.object({
			type: z.enum(["procedural", "physical"]).optional().default("procedural"),
			topColor: z.string().optional().default("Color(0.385, 0.454, 0.55, 1)"),
			horizonColor: z.string().optional().default("Color(0.646, 0.654, 0.671, 1)"),
			bottomColor: z.string().optional().default("Color(0.2, 0.169, 0.133, 1)"),
			sunAngleMax: z.number().optional().default(30.0),
			sunCurve: z.number().optional().default(0.15),
		}).optional(),
		tonemap: z.object({
			mode: z.enum(["linear", "reinhardt", "filmic", "aces"]).optional().default("filmic"),
			exposure: z.number().optional().default(1.0),
			whiteRef: z.number().optional().default(6.0),
		}).optional(),
		fog: z.object({
			enabled: z.boolean().optional().default(false),
			color: z.string().optional().default("Color(0.5, 0.6, 0.7, 1)"),
			density: z.number().optional().default(0.01),
			skyAffect: z.number().optional().default(1.0),
		}).optional(),
		volumetricFog: z.object({
			enabled: z.boolean().optional().default(false),
			density: z.number().optional().default(0.05),
			albedo: z.string().optional().default("Color(1, 1, 1, 1)"),
			emission: z.string().optional().default("Color(0, 0, 0, 1)"),
		}).optional(),
		ssao: z.object({
			enabled: z.boolean().optional().default(false),
			radius: z.number().optional().default(1.0),
			intensity: z.number().optional().default(2.0),
		}).optional(),
		glow: z.object({
			enabled: z.boolean().optional().default(false),
			intensity: z.number().optional().default(0.8),
			bloom: z.number().optional().default(0.0),
			blendMode: z.enum(["additive", "screen", "softlight", "replace"]).optional().default("softlight"),
		}).optional(),
		ambient: z.object({
			source: z.enum(["background", "disabled", "color", "sky"]).optional().default("sky"),
			color: z.string().optional(),
			energy: z.number().optional().default(1.0),
		}).optional(),
		sunLight: z.object({
			enabled: z.boolean().optional().default(true),
			color: z.string().optional().default("Color(1, 0.96, 0.89, 1)"),
			energy: z.number().optional().default(1.0),
			shadowEnabled: z.boolean().optional().default(true),
		}).optional(),
	}, async ({ scenePath, parent, sky, tonemap, fog, volumetricFog, ssao, glow, ambient, sunLight }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const s = sky ?? {};
			const t = tonemap ?? {};
			const f = fog ?? {};
			const vf = volumetricFog ?? {};
			const ao = ssao ?? {};
			const gl = glow ?? {};
			const am = ambient ?? {};
			const sl = sunLight ?? {};

			// Create ProceduralSkyMaterial sub-resource
			const skyMatId = `ProceduralSkyMaterial_${generateResourceId()}`;
			doc.subResources.push({
				type: "ProceduralSkyMaterial",
				id: skyMatId,
				properties: {
					sky_top_color: parseVariant(s.topColor ?? "Color(0.385, 0.454, 0.55, 1)"),
					sky_horizon_color: parseVariant(s.horizonColor ?? "Color(0.646, 0.654, 0.671, 1)"),
					ground_bottom_color: parseVariant(s.bottomColor ?? "Color(0.2, 0.169, 0.133, 1)"),
					sun_angle_max: s.sunAngleMax ?? 30.0,
					sun_curve: s.sunCurve ?? 0.15,
				} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			// Create Sky sub-resource
			const skyId = `Sky_${generateResourceId()}`;
			doc.subResources.push({
				type: "Sky",
				id: skyId,
				properties: {
					sky_material: { type: "SubResource", id: skyMatId },
				} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			// Create Environment sub-resource
			const envId = `Environment_${generateResourceId()}`;
			const envProps: Record<string, unknown> = {
				background_mode: 2, // Sky
				sky: { type: "SubResource", id: skyId },
			};

			// Tonemap
			const tonemapModes: Record<string, number> = { linear: 0, reinhardt: 1, filmic: 2, aces: 3 };
			envProps.tonemap_mode = tonemapModes[t.mode ?? "filmic"] ?? 2;
			if (t.exposure !== undefined) envProps.tonemap_exposure = t.exposure;
			if (t.whiteRef !== undefined) envProps.tonemap_white = t.whiteRef;

			// Ambient
			const ambientSources: Record<string, number> = { background: 0, disabled: 1, color: 2, sky: 3 };
			envProps.ambient_light_source = ambientSources[am.source ?? "sky"] ?? 3;
			if (am.color) envProps.ambient_light_color = parseVariant(am.color);
			if (am.energy !== undefined) envProps.ambient_light_energy = am.energy;

			// Fog
			if (f.enabled) {
				envProps.fog_enabled = true;
				envProps.fog_light_color = parseVariant(f.color ?? "Color(0.5, 0.6, 0.7, 1)");
				envProps.fog_density = f.density ?? 0.01;
				envProps.fog_sky_affect = f.skyAffect ?? 1.0;
			}

			// Volumetric fog
			if (vf.enabled) {
				envProps.volumetric_fog_enabled = true;
				envProps.volumetric_fog_density = vf.density ?? 0.05;
				envProps.volumetric_fog_albedo = parseVariant(vf.albedo ?? "Color(1, 1, 1, 1)");
				envProps.volumetric_fog_emission = parseVariant(vf.emission ?? "Color(0, 0, 0, 1)");
			}

			// SSAO
			if (ao.enabled) {
				envProps.ssao_enabled = true;
				envProps.ssao_radius = ao.radius ?? 1.0;
				envProps.ssao_intensity = ao.intensity ?? 2.0;
			}

			// Glow
			if (gl.enabled) {
				envProps.glow_enabled = true;
				envProps.glow_intensity = gl.intensity ?? 0.8;
				envProps.glow_bloom = gl.bloom ?? 0.0;
				const glowModes: Record<string, number> = { additive: 0, screen: 1, softlight: 2, replace: 3 };
				envProps.glow_blend_mode = glowModes[gl.blendMode ?? "softlight"] ?? 2;
			}

			doc.subResources.push({
				type: "Environment",
				id: envId,
				properties: envProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			// Add WorldEnvironment node
			doc.nodes.push({
				name: "WorldEnvironment",
				type: "WorldEnvironment",
				parent,
				properties: {
					environment: { type: "SubResource", id: envId },
				} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			// Add DirectionalLight3D (sun)
			if (sl.enabled !== false) {
				doc.nodes.push({
					name: "DirectionalLight3D",
					type: "DirectionalLight3D",
					parent,
					properties: {
						transform: {
							type: "Transform3D",
							basis: [0.866, -0.433, 0.25, 0, 0.5, 0.866, -0.5, -0.75, 0.433],
							origin: [0, 0, 0],
						},
						light_color: parseVariant(sl.color ?? "Color(1, 0.96, 0.89, 1)"),
						light_energy: sl.energy ?? 1.0,
						shadow_enabled: sl.shadowEnabled ?? true,
					} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
				});
			}

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return {
				content: [{
					type: "text",
					text: `Added full environment to ${scenePath}: WorldEnvironment (sky + tonemap${f.enabled ? " + fog" : ""}${vf.enabled ? " + volumetric fog" : ""}${ao.enabled ? " + SSAO" : ""}${gl.enabled ? " + glow" : ""}) + DirectionalLight3D`,
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Particles
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_particles", "Add GPU or CPU particle system nodes to a scene with a ParticleProcessMaterial. Supports 2D and 3D with common presets.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("Particles"),
		is3d: z.boolean().optional().default(true),
		gpuParticles: z.boolean().optional().default(true).describe("GPU (true) or CPU (false) particles"),
		amount: z.number().optional().default(32),
		lifetime: z.number().optional().default(1.0),
		emitting: z.boolean().optional().default(true),
		oneShot: z.boolean().optional().default(false),
		preset: z.enum(["custom", "fire", "smoke", "rain", "snow", "sparks", "dust", "explosion", "leaves"]).optional().default("custom"),
		direction: z.string().optional().describe("Direction as Vector3 (e.g., Vector3(0, 1, 0))"),
		spread: z.number().optional().describe("Spread angle in degrees"),
		initialVelocity: z.number().optional(),
		gravity: z.string().optional().describe("Gravity as Vector3 (e.g., Vector3(0, -9.8, 0))"),
		emissionShape: z.enum(["point", "sphere", "box", "ring"]).optional().default("point"),
		emissionRadius: z.number().optional(),
		emissionBoxExtents: z.string().optional().describe("Box extents as Vector3"),
		color: z.string().optional().describe("Start color as Color(r, g, b, a)"),
		colorRamp: z.boolean().optional().default(false).describe("Add a color gradient (white→transparent)"),
		scaleMin: z.number().optional(),
		scaleMax: z.number().optional(),
	}, async ({ scenePath, parent, name, is3d, gpuParticles, amount, lifetime, emitting, oneShot, preset, direction, spread, initialVelocity, gravity, emissionShape, emissionRadius, emissionBoxExtents, color, colorRamp, scaleMin, scaleMax }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			// Build ParticleProcessMaterial properties from preset or custom params
			const matProps: Record<string, unknown> = {};
			const presets = getParticlePreset(preset);

			// Apply preset defaults, then override with explicit params
			matProps.direction = parseVariant(direction ?? presets.direction ?? "Vector3(0, 1, 0)");
			matProps.spread = spread ?? presets.spread ?? 45.0;
			matProps.initial_velocity_min = initialVelocity ?? presets.initialVelocity ?? 5.0;
			matProps.initial_velocity_max = (initialVelocity ?? presets.initialVelocity ?? 5.0) * 1.2;
			matProps.gravity = parseVariant(gravity ?? presets.gravity ?? "Vector3(0, -9.8, 0)");

			// Emission shape
			const shape = emissionShape ?? presets.emissionShape ?? "point";
			const emissionShapeMap: Record<string, number> = { point: 0, sphere: 1, box: 3, ring: 4 };
			matProps.emission_shape = emissionShapeMap[shape] ?? 0;
			if (shape === "sphere" && (emissionRadius ?? presets.emissionRadius)) {
				matProps.emission_sphere_radius = emissionRadius ?? presets.emissionRadius ?? 1.0;
			}
			if (shape === "box" && emissionBoxExtents) {
				matProps.emission_box_extents = parseVariant(emissionBoxExtents);
			}

			if (color ?? presets.color) matProps.color = parseVariant(color ?? presets.color!);
			if (scaleMin ?? presets.scaleMin) matProps.scale_min = scaleMin ?? presets.scaleMin;
			if (scaleMax ?? presets.scaleMax) matProps.scale_max = scaleMax ?? presets.scaleMax;

			// Create sub-resource
			const matId = `ParticleProcessMaterial_${generateResourceId()}`;
			doc.subResources.push({
				type: "ParticleProcessMaterial",
				id: matId,
				properties: matProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			// Determine node type
			let nodeType: string;
			if (is3d) {
				nodeType = gpuParticles ? "GPUParticles3D" : "CPUParticles3D";
			} else {
				nodeType = gpuParticles ? "GPUParticles2D" : "CPUParticles2D";
			}

			const nodeProps: Record<string, unknown> = {
				amount,
				lifetime,
				emitting,
				one_shot: oneShot,
				process_material: { type: "SubResource", id: matId },
			};

			doc.nodes.push({
				name,
				type: nodeType,
				parent,
				properties: nodeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return {
				content: [{
					type: "text",
					text: `Added ${nodeType} "${name}" (${preset !== "custom" ? preset + " preset, " : ""}${amount} particles, ${lifetime}s lifetime) to ${scenePath}`,
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Lighting
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_configure_light", "Add and configure a light node in a scene.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		lightType: z.enum(["directional", "omni", "spot"]),
		color: z.string().optional().default("Color(1, 1, 1, 1)"),
		energy: z.number().optional().default(1.0),
		shadowEnabled: z.boolean().optional().default(true),
		name: z.string().optional().default("Light"),
		range: z.number().optional().describe("Range for omni/spot lights"),
		spotAngle: z.number().optional().describe("Cone angle for spot lights (degrees)"),
	}, async ({ scenePath, parent, lightType, color, energy, shadowEnabled, name, range, spotAngle }) => {
		try {
			const typeMap: Record<string, string> = { directional: "DirectionalLight3D", omni: "OmniLight3D", spot: "SpotLight3D" };
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const props: Record<string, unknown> = {
				light_color: parseVariant(color),
				light_energy: energy,
				shadow_enabled: shadowEnabled,
			};
			if (range !== undefined && (lightType === "omni" || lightType === "spot")) {
				props.omni_range = range;
			}
			if (spotAngle !== undefined && lightType === "spot") {
				props.spot_angle = spotAngle;
			}
			doc.nodes.push({ name, type: typeMap[lightType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${typeMap[lightType]} "${name}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Import Config
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_import_config", "Modify .import file settings for an asset (textures, models, audio).", {
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

// ═══════════════════════════════════════════════════════════════
// Particle Presets
// ═══════════════════════════════════════════════════════════════

interface ParticlePresetConfig {
	direction?: string;
	spread?: number;
	initialVelocity?: number;
	gravity?: string;
	emissionShape?: string;
	emissionRadius?: number;
	color?: string;
	scaleMin?: number;
	scaleMax?: number;
}

function getParticlePreset(name: string): ParticlePresetConfig {
	const presets: Record<string, ParticlePresetConfig> = {
		fire: {
			direction: "Vector3(0, 1, 0)", spread: 15, initialVelocity: 3,
			gravity: "Vector3(0, 0, 0)", color: "Color(1, 0.5, 0.1, 1)",
			scaleMin: 0.5, scaleMax: 1.5,
		},
		smoke: {
			direction: "Vector3(0, 1, 0)", spread: 30, initialVelocity: 1,
			gravity: "Vector3(0, 0.5, 0)", color: "Color(0.5, 0.5, 0.5, 0.6)",
			scaleMin: 1.0, scaleMax: 3.0,
		},
		rain: {
			direction: "Vector3(0, -1, 0)", spread: 5, initialVelocity: 20,
			gravity: "Vector3(0, -9.8, 0)", emissionShape: "box",
			color: "Color(0.7, 0.8, 1, 0.6)", scaleMin: 0.1, scaleMax: 0.2,
		},
		snow: {
			direction: "Vector3(0, -1, 0)", spread: 30, initialVelocity: 2,
			gravity: "Vector3(0, -1, 0)", emissionShape: "box",
			color: "Color(1, 1, 1, 0.9)", scaleMin: 0.2, scaleMax: 0.5,
		},
		sparks: {
			direction: "Vector3(0, 1, 0)", spread: 90, initialVelocity: 10,
			gravity: "Vector3(0, -9.8, 0)", color: "Color(1, 0.8, 0.3, 1)",
			scaleMin: 0.05, scaleMax: 0.15,
		},
		dust: {
			direction: "Vector3(0, 0.5, 0)", spread: 60, initialVelocity: 0.5,
			gravity: "Vector3(0, -0.5, 0)", emissionShape: "sphere", emissionRadius: 2.0,
			color: "Color(0.8, 0.75, 0.6, 0.3)", scaleMin: 0.5, scaleMax: 2.0,
		},
		explosion: {
			direction: "Vector3(0, 1, 0)", spread: 180, initialVelocity: 15,
			gravity: "Vector3(0, -5, 0)", emissionShape: "sphere", emissionRadius: 0.5,
			color: "Color(1, 0.6, 0.2, 1)", scaleMin: 0.5, scaleMax: 3.0,
		},
		leaves: {
			direction: "Vector3(-0.3, -1, 0.2)", spread: 45, initialVelocity: 1.5,
			gravity: "Vector3(0, -2, 0)", emissionShape: "box",
			color: "Color(0.4, 0.6, 0.2, 0.9)", scaleMin: 0.3, scaleMax: 0.8,
		},
		custom: {},
	};
	return presets[name] ?? {};
}
