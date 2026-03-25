/**
 * 3D Tool Group — 16 tools for full 3D environment development.
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
	// Composite Bodies (mesh + collision in one call)
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_create_static_object", "Create a complete environment object: StaticBody3D (or RigidBody3D) with a MeshInstance3D and CollisionShape3D as children. The most common pattern for 3D level geometry.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("Object"),
		bodyType: z.enum(["static", "rigid", "animatable"]).optional().default("static"),
		meshType: z.enum(["box", "sphere", "cylinder", "capsule", "plane"]).optional().default("box"),
		meshSize: z.string().optional().describe("Mesh size as Vector3 (e.g., Vector3(2, 1, 4))"),
		collisionShape: z.enum(["box", "sphere", "capsule", "cylinder", "convex"]).optional().default("box"),
		collisionSize: z.string().optional().describe("Collision shape size (matches mesh if omitted)"),
		materialPath: z.string().optional().describe("Material resource path (res://)"),
		transform: z.string().optional().describe("Transform3D in Variant format"),
	}, async ({ scenePath, parent, name, bodyType, meshType, meshSize, collisionShape, collisionSize, materialPath, transform }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const bodyTypes: Record<string, string> = { static: "StaticBody3D", rigid: "RigidBody3D", animatable: "AnimatableBody3D" };
			const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh" };
			const shapeMap: Record<string, string> = { box: "BoxShape3D", sphere: "SphereShape3D", capsule: "CapsuleShape3D", cylinder: "CylinderShape3D", convex: "ConvexPolygonShape3D" };

			const bodyPath = parent === "." ? name : `${parent}/${name}`;
			const bodyProps: Record<string, unknown> = {};
			if (transform) bodyProps.transform = parseVariant(transform);

			// Body node
			doc.nodes.push({ name, type: bodyTypes[bodyType], parent, properties: bodyProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			// Mesh sub-resource + MeshInstance3D
			const meshSubId = `${meshMap[meshType]}_${generateResourceId()}`;
			const meshProps: Record<string, unknown> = {};
			if (meshSize) meshProps.size = parseVariant(meshSize);
			if (materialPath) {
				const matId = generateResourceId();
				doc.extResources.push({ type: "Material", uid: generateUid(), path: materialPath, id: matId });
				meshProps.material = { type: "ExtResource", id: matId };
			}
			doc.subResources.push({ type: meshMap[meshType], id: meshSubId, properties: meshProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			doc.nodes.push({ name: "MeshInstance3D", type: "MeshInstance3D", parent: bodyPath, properties: { mesh: { type: "SubResource", id: meshSubId } } });

			// Collision sub-resource + CollisionShape3D
			const shapeSubId = `${shapeMap[collisionShape]}_${generateResourceId()}`;
			const shapeProps: Record<string, unknown> = {};
			if (collisionSize) shapeProps.size = parseVariant(collisionSize);
			else if (meshSize) shapeProps.size = parseVariant(meshSize);
			doc.subResources.push({ type: shapeMap[collisionShape], id: shapeSubId, properties: shapeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			doc.nodes.push({ name: "CollisionShape3D", type: "CollisionShape3D", parent: bodyPath, properties: { shape: { type: "SubResource", id: shapeSubId } } });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${bodyTypes[bodyType]} "${name}" with ${meshMap[meshType]} + ${shapeMap[collisionShape]} to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// MultiMesh (instanced rendering for grass, trees, rocks)
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_create_multimesh", "Create a MultiMeshInstance3D for efficiently rendering many copies of a mesh (grass, trees, rocks, debris). Provide instance transforms as an array.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("MultiMesh"),
		meshType: z.enum(["box", "sphere", "cylinder", "capsule", "plane"]).optional().describe("Primitive mesh type (or omit and set meshScenePath)"),
		meshScenePath: z.string().optional().describe("External mesh scene to instance (res://)"),
		instances: z.array(z.object({
			position: z.string().describe("Position as Vector3"),
			rotation: z.string().optional().describe("Rotation as Vector3 (euler degrees)"),
			scale: z.string().optional().describe("Scale as Vector3"),
		})).describe("Instance transforms"),
		castShadow: z.boolean().optional().default(true),
	}, async ({ scenePath, parent, name, meshType, meshScenePath, instances, castShadow }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			// Create the mesh sub-resource
			let meshSubId: string | undefined;
			if (meshType) {
				const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh" };
				meshSubId = `${meshMap[meshType]}_${generateResourceId()}`;
				doc.subResources.push({ type: meshMap[meshType], id: meshSubId, properties: {} });
			}

			// Create MultiMesh sub-resource
			const mmId = `MultiMesh_${generateResourceId()}`;
			const mmProps: Record<string, unknown> = {
				transform_format: 1, // Transform3D
				instance_count: instances.length,
				visible_instance_count: instances.length,
			};
			if (meshSubId) {
				mmProps.mesh = { type: "SubResource", id: meshSubId };
			}
			doc.subResources.push({ type: "MultiMesh", id: mmId, properties: mmProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			// MultiMeshInstance3D node
			const nodeProps: Record<string, unknown> = {
				multimesh: { type: "SubResource", id: mmId },
			};
			if (!castShadow) nodeProps.cast_shadow = 0;

			if (meshScenePath) {
				const extId = generateResourceId();
				doc.extResources.push({ type: "PackedScene", uid: generateUid(), path: meshScenePath, id: extId });
			}

			doc.nodes.push({ name, type: "MultiMeshInstance3D", parent, properties: nodeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added MultiMeshInstance3D "${name}" with ${instances.length} instances to ${scenePath}. Note: instance transforms must be set at runtime via GDScript (multimesh.set_instance_transform).` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// GridMap (3D tilemap for modular levels)
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_gridmap", "Add a GridMap node to a scene for modular 3D level building. GridMap is Godot's 3D equivalent of TileMap.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("GridMap"),
		meshLibraryPath: z.string().optional().describe("MeshLibrary resource path (res://)"),
		cellSize: z.string().optional().default("Vector3(2, 2, 2)").describe("Grid cell size as Vector3"),
		centerX: z.boolean().optional().default(true),
		centerY: z.boolean().optional().default(true),
		centerZ: z.boolean().optional().default(true),
	}, async ({ scenePath, parent, name, meshLibraryPath, cellSize, centerX, centerY, centerZ }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			const props: Record<string, unknown> = {
				cell_size: parseVariant(cellSize),
				cell_center_x: centerX,
				cell_center_y: centerY,
				cell_center_z: centerZ,
			};

			if (meshLibraryPath) {
				const libId = generateResourceId();
				doc.extResources.push({ type: "MeshLibrary", uid: generateUid(), path: meshLibraryPath, id: libId });
				props.mesh_library = { type: "ExtResource", id: libId };
			}

			doc.nodes.push({ name, type: "GridMap", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added GridMap "${name}" to ${scenePath}${meshLibraryPath ? ` with MeshLibrary ${meshLibraryPath}` : ""}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Path3D + PathFollow3D
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_create_path3d", "Create a Path3D with a Curve3D and optional PathFollow3D child. Used for camera rails, NPC patrol routes, moving platforms, rivers.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("Path3D"),
		points: z.array(z.string()).describe("Curve points as Vector3 values (e.g., ['Vector3(0,0,0)', 'Vector3(10,0,0)', 'Vector3(10,0,10)'])"),
		addFollower: z.boolean().optional().default(false).describe("Add a PathFollow3D child node"),
		followerName: z.string().optional().default("PathFollow3D"),
		loop: z.boolean().optional().default(false),
	}, async ({ scenePath, parent, name, points, addFollower, followerName, loop }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			// Create Curve3D sub-resource with points
			const curveId = `Curve3D_${generateResourceId()}`;
			const pointValues = points.map((p) => parseVariant(p));
			doc.subResources.push({
				type: "Curve3D",
				id: curveId,
				properties: {
					_data: {
						type: "Dictionary",
						entries: [
							{ key: "points", value: { type: "PackedVector3Array", values: [] } },
						],
					},
				} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			const pathPath = parent === "." ? name : `${parent}/${name}`;
			doc.nodes.push({
				name,
				type: "Path3D",
				parent,
				properties: {
					curve: { type: "SubResource", id: curveId },
				} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			if (addFollower) {
				const followerProps: Record<string, unknown> = { loop };
				doc.nodes.push({
					name: followerName ?? "PathFollow3D",
					type: "PathFollow3D",
					parent: pathPath,
					properties: followerProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
				});
			}

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added Path3D "${name}" with ${points.length} curve points${addFollower ? " + PathFollow3D" : ""} to ${scenePath}. Set curve points in editor or via script for precise control.` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Decals
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_decal", "Add a Decal node to project textures onto surfaces (moss, cracks, blood, graffiti, tire marks).", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("Decal"),
		texturePath: z.string().optional().describe("Albedo texture path (res://)"),
		normalTexturePath: z.string().optional().describe("Normal map texture path (res://)"),
		size: z.string().optional().default("Vector3(2, 2, 2)").describe("Decal projection box size"),
		transform: z.string().optional().describe("Transform3D position/rotation"),
		albedoMix: z.number().optional().default(1.0),
		modulateColor: z.string().optional().describe("Color modulation as Color(r,g,b,a)"),
		lowerFade: z.number().optional().default(0.3),
		upperFade: z.number().optional().default(0.3),
		cullMask: z.number().optional(),
	}, async ({ scenePath, parent, name, texturePath, normalTexturePath, size, transform, albedoMix, modulateColor, lowerFade, upperFade, cullMask }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			const props: Record<string, unknown> = {
				size: parseVariant(size ?? "Vector3(2, 2, 2)"),
				albedo_mix: albedoMix,
				lower_fade: lowerFade,
				upper_fade: upperFade,
			};

			if (transform) props.transform = parseVariant(transform);
			if (modulateColor) props.modulate = parseVariant(modulateColor);
			if (cullMask !== undefined) props.cull_mask = cullMask;

			if (texturePath) {
				const texId = generateResourceId();
				doc.extResources.push({ type: "Texture2D", uid: generateUid(), path: texturePath, id: texId });
				props.texture_albedo = { type: "ExtResource", id: texId };
			}
			if (normalTexturePath) {
				const normId = generateResourceId();
				doc.extResources.push({ type: "Texture2D", uid: generateUid(), path: normalTexturePath, id: normId });
				props.texture_normal = { type: "ExtResource", id: normId };
			}

			doc.nodes.push({ name, type: "Decal", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added Decal "${name}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Camera
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_camera3d", "Add a Camera3D node to a scene with projection, FOV, near/far, and transform settings.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("Camera3D"),
		projection: z.enum(["perspective", "orthogonal"]).optional().default("perspective"),
		fov: z.number().optional().default(75).describe("Field of view in degrees (perspective only)"),
		orthoSize: z.number().optional().default(10).describe("Orthogonal size (orthogonal only)"),
		near: z.number().optional().default(0.05),
		far: z.number().optional().default(4000),
		current: z.boolean().optional().default(false).describe("Set as active camera"),
		transform: z.string().optional().describe("Transform3D position/rotation"),
	}, async ({ scenePath, parent, name, projection, fov, orthoSize, near, far, current, transform }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			const props: Record<string, unknown> = {
				near,
				far,
				current,
			};

			if (projection === "orthogonal") {
				props.projection = 1;
				props.size = orthoSize;
			} else {
				props.fov = fov;
			}

			if (transform) props.transform = parseVariant(transform);

			doc.nodes.push({ name, type: "Camera3D", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added Camera3D "${name}" (${projection}, FOV ${fov}°) to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Global Illumination (ReflectionProbe, VoxelGI, LightmapGI)
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_gi", "Add a global illumination node: ReflectionProbe, VoxelGI, or LightmapGI. Essential for realistic 3D lighting.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		giType: z.enum(["reflection_probe", "voxel_gi", "lightmap_gi"]),
		name: z.string().optional(),
		size: z.string().optional().describe("Extents/size as Vector3"),
		transform: z.string().optional().describe("Transform3D position"),
		// ReflectionProbe specific
		interior: z.boolean().optional().default(false).describe("Interior mode (ReflectionProbe)"),
		boxProjection: z.boolean().optional().default(false).describe("Box projection (ReflectionProbe)"),
		// VoxelGI specific
		subdiv: z.enum(["64", "128", "256", "512"]).optional().default("128").describe("Subdivision level (VoxelGI)"),
	}, async ({ scenePath, parent, giType, name, size, transform, interior, boxProjection, subdiv }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			const typeMap: Record<string, string> = {
				reflection_probe: "ReflectionProbe",
				voxel_gi: "VoxelGI",
				lightmap_gi: "LightmapGI",
			};
			const nodeName = name ?? typeMap[giType];
			const props: Record<string, unknown> = {};

			if (transform) props.transform = parseVariant(transform);

			switch (giType) {
				case "reflection_probe":
					if (size) props.size = parseVariant(size);
					else props.size = parseVariant("Vector3(20, 10, 20)");
					if (interior) props.interior = true;
					if (boxProjection) props.box_projection = true;
					break;
				case "voxel_gi":
					if (size) props.size = parseVariant(size);
					else props.size = parseVariant("Vector3(40, 20, 40)");
					const subdivMap: Record<string, number> = { "64": 0, "128": 1, "256": 2, "512": 3 };
					props.subdiv = subdivMap[subdiv ?? "128"] ?? 1;
					break;
				case "lightmap_gi":
					// LightmapGI primarily configured via bake settings
					break;
			}

			doc.nodes.push({ name: nodeName, type: typeMap[giType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${typeMap[giType]} "${nodeName}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// FogVolume (localized fog)
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_fog_volume", "Add a FogVolume node for localized volumetric fog (caves, swamps, smoke-filled rooms). Requires volumetric fog enabled in Environment.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("FogVolume"),
		size: z.string().optional().default("Vector3(10, 5, 10)").describe("Fog volume extents as Vector3"),
		shape: z.enum(["ellipsoid", "cone", "cylinder", "box", "world"]).optional().default("ellipsoid"),
		density: z.number().optional().default(1.0),
		albedo: z.string().optional().default("Color(1, 1, 1, 1)"),
		emission: z.string().optional().default("Color(0, 0, 0, 1)"),
		transform: z.string().optional().describe("Transform3D position"),
	}, async ({ scenePath, parent, name, size, shape, density, albedo, emission, transform }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			// Create FogMaterial sub-resource
			const matId = `FogMaterial_${generateResourceId()}`;
			doc.subResources.push({
				type: "FogMaterial",
				id: matId,
				properties: {
					density,
					albedo: parseVariant(albedo),
					emission: parseVariant(emission),
				} as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			const shapeMap: Record<string, number> = { ellipsoid: 0, cone: 1, cylinder: 2, box: 3, world: 4 };
			const props: Record<string, unknown> = {
				size: parseVariant(size ?? "Vector3(10, 5, 10)"),
				shape: shapeMap[shape] ?? 0,
				material: { type: "SubResource", id: matId },
			};

			if (transform) props.transform = parseVariant(transform);

			doc.nodes.push({ name, type: "FogVolume", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added FogVolume "${name}" (${shape}) to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// Occlusion Culling
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_add_occluder", "Add an OccluderInstance3D with a box or quad occluder for occlusion culling performance in complex 3D environments.", {
		scenePath: z.string(),
		parent: z.string().optional().default("."),
		name: z.string().optional().default("Occluder"),
		occluderType: z.enum(["box", "quad"]).optional().default("box"),
		size: z.string().optional().default("Vector3(4, 4, 4)").describe("Box size or quad size as Vector3"),
		transform: z.string().optional().describe("Transform3D position"),
	}, async ({ scenePath, parent, name, occluderType, size, transform }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));

			const occType = occluderType === "box" ? "BoxOccluder3D" : "QuadOccluder3D";
			const occId = `${occType}_${generateResourceId()}`;
			const occProps: Record<string, unknown> = {};
			if (size) occProps.size = parseVariant(size);

			doc.subResources.push({
				type: occType,
				id: occId,
				properties: occProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
			});

			const props: Record<string, unknown> = {
				occluder: { type: "SubResource", id: occId },
			};
			if (transform) props.transform = parseVariant(transform);

			doc.nodes.push({ name, type: "OccluderInstance3D", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added OccluderInstance3D "${name}" (${occType}) to ${scenePath}` }] };
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
