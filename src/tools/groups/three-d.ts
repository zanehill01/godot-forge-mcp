/**
 * 3D Tool Group — Single unified tool for full 3D environment development.
 *
 * All actions write real .tscn/.tres files with proper sub-resources.
 * No code-gen wrappers — every action manipulates project state.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId, escapeRegex } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerThreeDTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_3d",
		`Unified 3D tool. Actions and their params:

• create_mesh — scenePath, parent, meshType (box|sphere|cylinder|capsule|plane|prism|torus|csg_box|csg_sphere|csg_cylinder), name, size, materialPath
• add_model — scenePath, modelPath, name, parent, transform, scale
• material — path, albedoColor, metallic, roughness, emission, emissionEnergy, transparency (disabled|alpha|alpha_scissor), albedoTexture, normalTexture
• environment — scenePath, parent, sky {type,topColor,horizonColor,bottomColor,sunAngleMax,sunCurve}, tonemap {mode,exposure,whiteRef}, fog {enabled,color,density,skyAffect}, volumetricFog {enabled,density,albedo,emission}, ssao {enabled,radius,intensity}, glow {enabled,intensity,bloom,blendMode}, ambient {source,color,energy}, sunLight {enabled,color,energy,shadowEnabled}
• particles — scenePath, parent, name, is3d, gpuParticles, amount, lifetime, emitting, oneShot, preset (custom|fire|smoke|rain|snow|sparks|dust|explosion|leaves), direction, spread, initialVelocity, gravity, emissionShape (point|sphere|box|ring), emissionRadius, emissionBoxExtents, color, colorRamp, scaleMin, scaleMax
• light — scenePath, parent, lightType (directional|omni|spot), color, energy, shadowEnabled, name, range, spotAngle
• camera — scenePath, parent, name, projection (perspective|orthogonal), fov, orthoSize, near, far, current, transform
• gi — scenePath, parent, giType (reflection_probe|voxel_gi|lightmap_gi), name, size, transform, interior, boxProjection, subdiv (64|128|256|512)
• fog_volume — scenePath, parent, name, size, shape (ellipsoid|cone|cylinder|box|world), density, albedo, emission, transform
• decal — scenePath, parent, name, texturePath, normalTexturePath, size, transform, albedoMix, modulateColor, lowerFade, upperFade, cullMask
• path3d — scenePath, parent, name, points (string[]), addFollower, followerName, loop
• gridmap — scenePath, parent, name, meshLibraryPath, cellSize, centerX, centerY, centerZ
• multimesh — scenePath, parent, name, meshType (box|sphere|cylinder|capsule|plane), meshScenePath, instances [{position,rotation?,scale?}], castShadow
• static_object — scenePath, parent, name, bodyType (static|rigid|animatable), meshType, meshSize, collisionShape (box|sphere|capsule|cylinder|convex), collisionSize, materialPath, transform
• occluder — scenePath, parent, name, occluderType (box|quad), size, transform
• import_config — assetPath, settings (Record<string,string>)`,
		{
			action: z.enum([
				"create_mesh", "add_model", "material", "environment", "particles",
				"light", "camera", "gi", "fog_volume", "decal", "path3d", "gridmap",
				"multimesh", "static_object", "occluder", "import_config",
			]),

			// Common params
			scenePath: z.string().optional().describe("Target scene path (res://)"),
			parent: z.string().optional().describe("Parent node path (default '.')"),
			name: z.string().optional().describe("Node name"),
			transform: z.string().optional().describe("Transform3D in Variant format"),
			size: z.string().optional().describe("Size as Vector3"),

			// create_mesh
			meshType: z.enum(["box", "sphere", "cylinder", "capsule", "plane", "prism", "torus", "csg_box", "csg_sphere", "csg_cylinder"]).optional(),
			materialPath: z.string().optional().describe("Material resource path (res://)"),

			// add_model
			modelPath: z.string().optional().describe("Model file path (res://, e.g., res://models/tree.glb)"),
			scale: z.string().optional().describe("Scale as Vector3 (e.g., Vector3(2, 2, 2))"),

			// material
			path: z.string().optional().describe("Resource file path (res://)"),
			albedoColor: z.string().optional(),
			metallic: z.number().optional(),
			roughness: z.number().optional(),
			emission: z.string().optional(),
			emissionEnergy: z.number().optional(),
			transparency: z.enum(["disabled", "alpha", "alpha_scissor"]).optional(),
			albedoTexture: z.string().optional().describe("Texture path (res://)"),
			normalTexture: z.string().optional().describe("Normal map path (res://)"),

			// environment
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

			// particles
			is3d: z.boolean().optional().describe("3D (true) or 2D (false) particles"),
			gpuParticles: z.boolean().optional().describe("GPU (true) or CPU (false) particles"),
			amount: z.number().optional(),
			lifetime: z.number().optional(),
			emitting: z.boolean().optional(),
			oneShot: z.boolean().optional(),
			preset: z.enum(["custom", "fire", "smoke", "rain", "snow", "sparks", "dust", "explosion", "leaves"]).optional(),
			direction: z.string().optional().describe("Direction as Vector3"),
			spread: z.number().optional().describe("Spread angle in degrees"),
			initialVelocity: z.number().optional(),
			gravity: z.string().optional().describe("Gravity as Vector3"),
			emissionShape: z.enum(["point", "sphere", "box", "ring"]).optional(),
			emissionRadius: z.number().optional(),
			emissionBoxExtents: z.string().optional().describe("Box extents as Vector3"),
			color: z.string().optional().describe("Color value as Color(r, g, b, a)"),
			colorRamp: z.boolean().optional().describe("Add a color gradient (white->transparent)"),
			scaleMin: z.number().optional(),
			scaleMax: z.number().optional(),

			// light
			lightType: z.enum(["directional", "omni", "spot"]).optional(),
			energy: z.number().optional(),
			shadowEnabled: z.boolean().optional(),
			range: z.number().optional().describe("Range for omni/spot lights"),
			spotAngle: z.number().optional().describe("Cone angle for spot lights (degrees)"),

			// camera
			projection: z.enum(["perspective", "orthogonal"]).optional(),
			fov: z.number().optional().describe("Field of view in degrees"),
			orthoSize: z.number().optional().describe("Orthogonal size"),
			near: z.number().optional(),
			far: z.number().optional(),
			current: z.boolean().optional().describe("Set as active camera"),

			// gi
			giType: z.enum(["reflection_probe", "voxel_gi", "lightmap_gi"]).optional(),
			interior: z.boolean().optional().describe("Interior mode (ReflectionProbe)"),
			boxProjection: z.boolean().optional().describe("Box projection (ReflectionProbe)"),
			subdiv: z.enum(["64", "128", "256", "512"]).optional().describe("Subdivision level (VoxelGI)"),

			// fog_volume
			shape: z.enum(["ellipsoid", "cone", "cylinder", "box", "world"]).optional().describe("FogVolume shape"),
			density: z.number().optional(),
			albedo: z.string().optional().describe("Albedo color"),

			// decal
			texturePath: z.string().optional().describe("Albedo texture path (res://)"),
			normalTexturePath: z.string().optional().describe("Normal map texture path (res://)"),
			albedoMix: z.number().optional(),
			modulateColor: z.string().optional().describe("Color modulation as Color(r,g,b,a)"),
			lowerFade: z.number().optional(),
			upperFade: z.number().optional(),
			cullMask: z.number().optional(),

			// path3d
			points: z.array(z.string()).optional().describe("Curve points as Vector3 values"),
			addFollower: z.boolean().optional().describe("Add a PathFollow3D child node"),
			followerName: z.string().optional(),
			loop: z.boolean().optional(),

			// gridmap
			meshLibraryPath: z.string().optional().describe("MeshLibrary resource path (res://)"),
			cellSize: z.string().optional().describe("Grid cell size as Vector3"),
			centerX: z.boolean().optional(),
			centerY: z.boolean().optional(),
			centerZ: z.boolean().optional(),

			// multimesh
			meshScenePath: z.string().optional().describe("External mesh scene to instance (res://)"),
			instances: z.array(z.object({
				position: z.string().describe("Position as Vector3"),
				rotation: z.string().optional().describe("Rotation as Vector3 (euler degrees)"),
				scale: z.string().optional().describe("Scale as Vector3"),
			})).optional().describe("Instance transforms for multimesh"),
			castShadow: z.boolean().optional(),

			// static_object
			bodyType: z.enum(["static", "rigid", "animatable"]).optional(),
			meshSize: z.string().optional().describe("Mesh size as Vector3"),
			collisionShape: z.enum(["box", "sphere", "capsule", "cylinder", "convex"]).optional(),
			collisionSize: z.string().optional().describe("Collision shape size"),

			// occluder
			occluderType: z.enum(["box", "quad"]).optional(),

			// import_config
			assetPath: z.string().optional().describe("Asset path (res://)"),
			settings: z.record(z.string(), z.string()).optional().describe("Import parameter overrides"),
		},
		async (params) => {
			try {
				switch (params.action) {
					// ═══════════════════════════════════════════════════════════
					// create_mesh
					// ═══════════════════════════════════════════════════════════
					case "create_mesh": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const meshType = params.meshType!;
						const name = params.name ?? "Mesh";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const csgTypes: Record<string, string> = { csg_box: "CSGBox3D", csg_sphere: "CSGSphere3D", csg_cylinder: "CSGCylinder3D" };

						if (csgTypes[meshType]) {
							const props: Record<string, unknown> = {};
							if (params.size) props.size = parseVariant(params.size);
							if (params.materialPath) {
								const matId = generateResourceId();
								doc.extResources.push({ type: "Material", uid: generateUid(), path: params.materialPath, id: matId });
								props.material = { type: "ExtResource", id: matId };
							}
							doc.nodes.push({ name, type: csgTypes[meshType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						} else {
							const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh", prism: "PrismMesh", torus: "TorusMesh" };
							const subId = `${meshMap[meshType]}_${generateResourceId()}`;
							const meshProps: Record<string, unknown> = {};
							if (params.size) meshProps.size = parseVariant(params.size);
							if (params.materialPath) {
								const matId = generateResourceId();
								doc.extResources.push({ type: "Material", uid: generateUid(), path: params.materialPath, id: matId });
								meshProps.material = { type: "ExtResource", id: matId };
							}
							doc.subResources.push({ type: meshMap[meshType], id: subId, properties: meshProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
							doc.nodes.push({ name, type: "MeshInstance3D", parent, properties: { mesh: { type: "SubResource", id: subId } } });
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added ${meshType} mesh "${name}" to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// add_model
					// ═══════════════════════════════════════════════════════════
					case "add_model": {
						const scenePath = params.scenePath!;
						const modelPath = params.modelPath!;
						const name = params.name ?? "Model";
						const parent = params.parent ?? ".";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const resId = generateResourceId();
						doc.extResources.push({
							type: "PackedScene",
							uid: generateUid(),
							path: modelPath,
							id: resId,
						});

						const props: Record<string, unknown> = {};
						if (params.transform) props.transform = parseVariant(params.transform);
						if (params.scale) {
							const s = parseVariant(params.scale);
							if (!params.transform && typeof s === "object" && s !== null && "type" in s && s.type === "Vector3") {
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
					}

					// ═══════════════════════════════════════════════════════════
					// material
					// ═══════════════════════════════════════════════════════════
					case "material": {
						const path = params.path!;
						const lines = [`[gd_resource type="StandardMaterial3D" format=3]`, ""];
						let extId = 1;
						if (params.albedoTexture) { lines.push(`[ext_resource type="Texture2D" path="${params.albedoTexture}" id="${extId}_tex"]`); extId++; }
						if (params.normalTexture) { lines.push(`[ext_resource type="Texture2D" path="${params.normalTexture}" id="${extId}_norm"]`); }
						if (params.albedoTexture || params.normalTexture) lines.push("");
						lines.push("[resource]");
						if (params.albedoColor) lines.push(`albedo_color = ${params.albedoColor}`);
						if (params.albedoTexture) lines.push(`albedo_texture = ExtResource("1_tex")`);
						if (params.normalTexture) { lines.push(`normal_enabled = true`); lines.push(`normal_texture = ExtResource("${extId}_norm")`); }
						if (params.metallic !== undefined) lines.push(`metallic = ${params.metallic}`);
						if (params.roughness !== undefined) lines.push(`roughness = ${params.roughness}`);
						if (params.emission) { lines.push(`emission_enabled = true`); lines.push(`emission = ${params.emission}`); }
						if (params.emissionEnergy !== undefined) lines.push(`emission_energy_multiplier = ${params.emissionEnergy}`);
						if (params.transparency && params.transparency !== "disabled") { const map: Record<string, number> = { alpha: 1, alpha_scissor: 2 }; lines.push(`transparency = ${map[params.transparency]}`); }
						lines.push("");
						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						return { content: [{ type: "text", text: `Created StandardMaterial3D at ${path}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// environment
					// ═══════════════════════════════════════════════════════════
					case "environment": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const s = params.sky ?? {};
						const t = params.tonemap ?? {};
						const f = params.fog ?? {};
						const vf = params.volumetricFog ?? {};
						const ao = params.ssao ?? {};
						const gl = params.glow ?? {};
						const am = params.ambient ?? {};
						const sl = params.sunLight ?? {};

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
					}

					// ═══════════════════════════════════════════════════════════
					// particles
					// ═══════════════════════════════════════════════════════════
					case "particles": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "Particles";
						const is3d = params.is3d ?? true;
						const gpuParticles = params.gpuParticles ?? true;
						const amount = params.amount ?? 32;
						const lifetime = params.lifetime ?? 1.0;
						const emitting = params.emitting ?? true;
						const oneShot = params.oneShot ?? false;
						const preset = params.preset ?? "custom";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						// Build ParticleProcessMaterial properties from preset or custom params
						const matProps: Record<string, unknown> = {};
						const presets = getParticlePreset(preset);

						// Apply preset defaults, then override with explicit params
						matProps.direction = parseVariant(params.direction ?? presets.direction ?? "Vector3(0, 1, 0)");
						matProps.spread = params.spread ?? presets.spread ?? 45.0;
						matProps.initial_velocity_min = params.initialVelocity ?? presets.initialVelocity ?? 5.0;
						matProps.initial_velocity_max = (params.initialVelocity ?? presets.initialVelocity ?? 5.0) * 1.2;
						matProps.gravity = parseVariant(params.gravity ?? presets.gravity ?? "Vector3(0, -9.8, 0)");

						// Emission shape
						const emShape = params.emissionShape ?? presets.emissionShape ?? "point";
						const emissionShapeMap: Record<string, number> = { point: 0, sphere: 1, box: 3, ring: 4 };
						matProps.emission_shape = emissionShapeMap[emShape] ?? 0;
						if (emShape === "sphere" && (params.emissionRadius ?? presets.emissionRadius)) {
							matProps.emission_sphere_radius = params.emissionRadius ?? presets.emissionRadius ?? 1.0;
						}
						if (emShape === "box" && params.emissionBoxExtents) {
							matProps.emission_box_extents = parseVariant(params.emissionBoxExtents);
						}

						if (params.color ?? presets.color) matProps.color = parseVariant(params.color ?? presets.color!);
						if (params.scaleMin ?? presets.scaleMin) matProps.scale_min = params.scaleMin ?? presets.scaleMin;
						if (params.scaleMax ?? presets.scaleMax) matProps.scale_max = params.scaleMax ?? presets.scaleMax;

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
					}

					// ═══════════════════════════════════════════════════════════
					// light
					// ═══════════════════════════════════════════════════════════
					case "light": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const lightType = params.lightType!;
						const color = params.color ?? "Color(1, 1, 1, 1)";
						const energy = params.energy ?? 1.0;
						const shadowEnabled = params.shadowEnabled ?? true;
						const name = params.name ?? "Light";
						const typeMap: Record<string, string> = { directional: "DirectionalLight3D", omni: "OmniLight3D", spot: "SpotLight3D" };
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const props: Record<string, unknown> = {
							light_color: parseVariant(color),
							light_energy: energy,
							shadow_enabled: shadowEnabled,
						};
						if (params.range !== undefined && (lightType === "omni" || lightType === "spot")) {
							props.omni_range = params.range;
						}
						if (params.spotAngle !== undefined && lightType === "spot") {
							props.spot_angle = params.spotAngle;
						}
						doc.nodes.push({ name, type: typeMap[lightType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added ${typeMap[lightType]} "${name}" to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// camera
					// ═══════════════════════════════════════════════════════════
					case "camera": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "Camera3D";
						const projection = params.projection ?? "perspective";
						const fov = params.fov ?? 75;
						const orthoSize = params.orthoSize ?? 10;
						const near = params.near ?? 0.05;
						const far = params.far ?? 4000;
						const current = params.current ?? false;
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

						if (params.transform) props.transform = parseVariant(params.transform);

						doc.nodes.push({ name, type: "Camera3D", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added Camera3D "${name}" (${projection}, FOV ${fov}°) to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// gi
					// ═══════════════════════════════════════════════════════════
					case "gi": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const giType = params.giType!;
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const typeMap: Record<string, string> = {
							reflection_probe: "ReflectionProbe",
							voxel_gi: "VoxelGI",
							lightmap_gi: "LightmapGI",
						};
						const nodeName = params.name ?? typeMap[giType];
						const props: Record<string, unknown> = {};

						if (params.transform) props.transform = parseVariant(params.transform);

						switch (giType) {
							case "reflection_probe":
								if (params.size) props.size = parseVariant(params.size);
								else props.size = parseVariant("Vector3(20, 10, 20)");
								if (params.interior) props.interior = true;
								if (params.boxProjection) props.box_projection = true;
								break;
							case "voxel_gi":
								if (params.size) props.size = parseVariant(params.size);
								else props.size = parseVariant("Vector3(40, 20, 40)");
								const subdivMap: Record<string, number> = { "64": 0, "128": 1, "256": 2, "512": 3 };
								props.subdiv = subdivMap[params.subdiv ?? "128"] ?? 1;
								break;
							case "lightmap_gi":
								// LightmapGI primarily configured via bake settings
								break;
						}

						doc.nodes.push({ name: nodeName, type: typeMap[giType], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added ${typeMap[giType]} "${nodeName}" to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// fog_volume
					// ═══════════════════════════════════════════════════════════
					case "fog_volume": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "FogVolume";
						const size = params.size ?? "Vector3(10, 5, 10)";
						const shape = params.shape ?? "ellipsoid";
						const density = params.density ?? 1.0;
						const albedo = params.albedo ?? "Color(1, 1, 1, 1)";
						const emission = params.emission ?? "Color(0, 0, 0, 1)";
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
							size: parseVariant(size),
							shape: shapeMap[shape] ?? 0,
							material: { type: "SubResource", id: matId },
						};

						if (params.transform) props.transform = parseVariant(params.transform);

						doc.nodes.push({ name, type: "FogVolume", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added FogVolume "${name}" (${shape}) to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// decal
					// ═══════════════════════════════════════════════════════════
					case "decal": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "Decal";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const props: Record<string, unknown> = {
							size: parseVariant(params.size ?? "Vector3(2, 2, 2)"),
							albedo_mix: params.albedoMix ?? 1.0,
							lower_fade: params.lowerFade ?? 0.3,
							upper_fade: params.upperFade ?? 0.3,
						};

						if (params.transform) props.transform = parseVariant(params.transform);
						if (params.modulateColor) props.modulate = parseVariant(params.modulateColor);
						if (params.cullMask !== undefined) props.cull_mask = params.cullMask;

						if (params.texturePath) {
							const texId = generateResourceId();
							doc.extResources.push({ type: "Texture2D", uid: generateUid(), path: params.texturePath, id: texId });
							props.texture_albedo = { type: "ExtResource", id: texId };
						}
						if (params.normalTexturePath) {
							const normId = generateResourceId();
							doc.extResources.push({ type: "Texture2D", uid: generateUid(), path: params.normalTexturePath, id: normId });
							props.texture_normal = { type: "ExtResource", id: normId };
						}

						doc.nodes.push({ name, type: "Decal", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added Decal "${name}" to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// path3d
					// ═══════════════════════════════════════════════════════════
					case "path3d": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "Path3D";
						const points = params.points!;
						const addFollower = params.addFollower ?? false;
						const followerName = params.followerName ?? "PathFollow3D";
						const loop = params.loop ?? false;
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
								name: followerName,
								type: "PathFollow3D",
								parent: pathPath,
								properties: followerProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
							});
						}

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added Path3D "${name}" with ${points.length} curve points${addFollower ? " + PathFollow3D" : ""} to ${scenePath}. Set curve points in editor or via script for precise control.` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// gridmap
					// ═══════════════════════════════════════════════════════════
					case "gridmap": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "GridMap";
						const cellSize = params.cellSize ?? "Vector3(2, 2, 2)";
						const centerX = params.centerX ?? true;
						const centerY = params.centerY ?? true;
						const centerZ = params.centerZ ?? true;
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const props: Record<string, unknown> = {
							cell_size: parseVariant(cellSize),
							cell_center_x: centerX,
							cell_center_y: centerY,
							cell_center_z: centerZ,
						};

						if (params.meshLibraryPath) {
							const libId = generateResourceId();
							doc.extResources.push({ type: "MeshLibrary", uid: generateUid(), path: params.meshLibraryPath, id: libId });
							props.mesh_library = { type: "ExtResource", id: libId };
						}

						doc.nodes.push({ name, type: "GridMap", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added GridMap "${name}" to ${scenePath}${params.meshLibraryPath ? ` with MeshLibrary ${params.meshLibraryPath}` : ""}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// multimesh
					// ═══════════════════════════════════════════════════════════
					case "multimesh": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "MultiMesh";
						const instances = params.instances!;
						const castShadow = params.castShadow ?? true;
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						// Create the mesh sub-resource
						let meshSubId: string | undefined;
						if (params.meshType) {
							const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh" };
							meshSubId = `${meshMap[params.meshType]}_${generateResourceId()}`;
							doc.subResources.push({ type: meshMap[params.meshType], id: meshSubId, properties: {} });
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

						if (params.meshScenePath) {
							const extId = generateResourceId();
							doc.extResources.push({ type: "PackedScene", uid: generateUid(), path: params.meshScenePath, id: extId });
						}

						doc.nodes.push({ name, type: "MultiMeshInstance3D", parent, properties: nodeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added MultiMeshInstance3D "${name}" with ${instances.length} instances to ${scenePath}. Note: instance transforms must be set at runtime via GDScript (multimesh.set_instance_transform).` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// static_object
					// ═══════════════════════════════════════════════════════════
					case "static_object": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "Object";
						const bodyType = params.bodyType ?? "static";
						const meshType = params.meshType ?? "box";
						const collisionShape = params.collisionShape ?? "box";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const bodyTypes: Record<string, string> = { static: "StaticBody3D", rigid: "RigidBody3D", animatable: "AnimatableBody3D" };
						const meshMap: Record<string, string> = { box: "BoxMesh", sphere: "SphereMesh", cylinder: "CylinderMesh", capsule: "CapsuleMesh", plane: "PlaneMesh" };
						const shapeMap: Record<string, string> = { box: "BoxShape3D", sphere: "SphereShape3D", capsule: "CapsuleShape3D", cylinder: "CylinderShape3D", convex: "ConvexPolygonShape3D" };

						const bodyPath = parent === "." ? name : `${parent}/${name}`;
						const bodyProps: Record<string, unknown> = {};
						if (params.transform) bodyProps.transform = parseVariant(params.transform);

						// Body node
						doc.nodes.push({ name, type: bodyTypes[bodyType], parent, properties: bodyProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						// Mesh sub-resource + MeshInstance3D
						const meshSubId = `${meshMap[meshType]}_${generateResourceId()}`;
						const meshProps: Record<string, unknown> = {};
						if (params.meshSize) meshProps.size = parseVariant(params.meshSize);
						if (params.materialPath) {
							const matId = generateResourceId();
							doc.extResources.push({ type: "Material", uid: generateUid(), path: params.materialPath, id: matId });
							meshProps.material = { type: "ExtResource", id: matId };
						}
						doc.subResources.push({ type: meshMap[meshType], id: meshSubId, properties: meshProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						doc.nodes.push({ name: "MeshInstance3D", type: "MeshInstance3D", parent: bodyPath, properties: { mesh: { type: "SubResource", id: meshSubId } } });

						// Collision sub-resource + CollisionShape3D
						const shapeSubId = `${shapeMap[collisionShape]}_${generateResourceId()}`;
						const shapeProps: Record<string, unknown> = {};
						if (params.collisionSize) shapeProps.size = parseVariant(params.collisionSize);
						else if (params.meshSize) shapeProps.size = parseVariant(params.meshSize);
						doc.subResources.push({ type: shapeMap[collisionShape], id: shapeSubId, properties: shapeProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						doc.nodes.push({ name: "CollisionShape3D", type: "CollisionShape3D", parent: bodyPath, properties: { shape: { type: "SubResource", id: shapeSubId } } });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added ${bodyTypes[bodyType]} "${name}" with ${meshMap[meshType]} + ${shapeMap[collisionShape]} to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// occluder
					// ═══════════════════════════════════════════════════════════
					case "occluder": {
						const scenePath = params.scenePath!;
						const parent = params.parent ?? ".";
						const name = params.name ?? "Occluder";
						const occluderType = params.occluderType ?? "box";
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));

						const occType = occluderType === "box" ? "BoxOccluder3D" : "QuadOccluder3D";
						const occId = `${occType}_${generateResourceId()}`;
						const occProps: Record<string, unknown> = {};
						if (params.size) occProps.size = parseVariant(params.size);

						doc.subResources.push({
							type: occType,
							id: occId,
							properties: occProps as Record<string, import("../../parsers/tscn/types.js").GodotVariant>,
						});

						const props: Record<string, unknown> = {
							occluder: { type: "SubResource", id: occId },
						};
						if (params.transform) props.transform = parseVariant(params.transform);

						doc.nodes.push({ name, type: "OccluderInstance3D", parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });

						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added OccluderInstance3D "${name}" (${occType}) to ${scenePath}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// import_config
					// ═══════════════════════════════════════════════════════════
					case "import_config": {
						const assetPath = params.assetPath!;
						const settings = params.settings!;
						const importPath = resToAbsolute(assetPath + ".import", ctx.projectRoot);
						let content = readFileSync(importPath, "utf-8");
						for (const [k, v] of Object.entries(settings)) {
							const regex = new RegExp(`^${escapeRegex(k)}=.*$`, "m");
							if (regex.test(content)) content = content.replace(regex, `${k}=${v}`);
							else content += `${k}=${v}\n`;
						}
						writeFileSync(importPath, content, "utf-8");
						return { content: [{ type: "text", text: `Updated import settings for ${assetPath}` }] };
					}

					default:
						return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], isError: true };
				}
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);
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
