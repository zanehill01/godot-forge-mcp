/**
 * Scaffold Tool Group — High-level project and entity scaffolding.
 *
 * Compound operations that generate multiple files at once:
 * - init_project: Create a complete Godot project from a preset
 * - create_entity: Generate a full entity (scene + script + components)
 * - scaffold_roguelike: Generate a complete roguelike game project
 * - theme_preset: Generate a styled UI theme
 * - validate: Check all scenes for errors
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ToolContext } from "../registry.js";

export function registerScaffoldTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_scaffold",
		`High-level project and entity scaffolding. Generates multiple files in one call.

Actions:

• init_project — Create a complete Godot project. Generates project.godot, directory structure, .gitignore.
    projectName (required), preset (blank|platformer_2d|platformer_3d|fps|rpg|roguelike), renderer (forward_plus|mobile|gl_compatibility), windowWidth, windowHeight

• create_entity — Generate a full entity scene + script + components in one call.
    entityType (required: player_3d|player_2d|enemy_3d|enemy_2d|npc|projectile|interactable|pickup), name (required), scriptPath (required), scenePath (required), health?, speed?, damage?, hasNavigation?, hasInventory?

• validate — Check all project scenes and scripts for errors.
    fix? (bool, auto-fix what's possible)

• theme_preset — Generate a complete UI theme .tres file.
    path (required), preset (required: dark_roguelike|sci_fi|fantasy|minimal|retro|cyberpunk)

• rename_class — Rename a class across all .gd and .tscn files.
    oldName (required), newName (required), dryRun (default true)`,
		{
			action: z.enum(["init_project", "create_entity", "validate", "theme_preset", "rename_class"]),

			// init_project
			projectName: z.string().optional(),
			preset: z.enum(["blank", "platformer_2d", "platformer_3d", "fps", "rpg", "roguelike"]).optional().default("blank"),
			renderer: z.enum(["forward_plus", "mobile", "gl_compatibility"]).optional().default("forward_plus"),
			windowWidth: z.number().optional().default(1920),
			windowHeight: z.number().optional().default(1080),

			// create_entity
			entityType: z.enum(["player_3d", "player_2d", "enemy_3d", "enemy_2d", "npc", "projectile", "interactable", "pickup"]).optional(),
			name: z.string().optional(),
			scriptPath: z.string().optional(),
			scenePath: z.string().optional(),
			health: z.number().optional(),
			speed: z.number().optional(),
			damage: z.number().optional(),
			hasNavigation: z.boolean().optional().default(false),
			hasInventory: z.boolean().optional().default(false),

			// theme_preset
			path: z.string().optional(),
			presetTheme: z.enum(["dark_roguelike", "sci_fi", "fantasy", "minimal", "retro", "cyberpunk"]).optional(),

			// rename_class
			oldName: z.string().optional(),
			newName: z.string().optional(),
			dryRun: z.boolean().optional().default(true),

			// validate
			fix: z.boolean().optional().default(false),
		},
		async (args) => {
			try {
				switch (args.action) {
					// ── init_project ───────────────────────────────────────
					case "init_project": {
						if (!args.projectName) return _err("projectName required");
						const root = ctx.projectRoot;
						const files: string[] = [];

						// Directories
						const dirs = [
							"scenes/characters", "scenes/enemies", "scenes/stages", "scenes/interactables",
							"scenes/projectiles", "scenes/vfx", "scenes/ui",
							"scripts/core", "scripts/components", "scripts/characters", "scripts/enemies",
							"scripts/abilities", "scripts/items", "scripts/resources", "scripts/ui", "scripts/stages",
							"resources/items", "resources/loot_tables", "resources/enemy_data", "resources/abilities",
							"shaders", "materials",
							"audio/music", "audio/sfx", "audio/ambience",
							"assets/models/characters", "assets/models/enemies", "assets/models/weapons",
							"assets/models/interactables", "assets/models/props",
							"assets/textures", "assets/hdri",
						];
						for (const d of dirs) {
							mkdirSync(join(root, d), { recursive: true });
						}
						files.push(`Created ${dirs.length} directories`);

						// .gitignore
						const gitignore = `.godot/\n*.uid\nexport/\n*.pck\n*.zip\n.godot_forge_tmp_*\n.godot_forge_screenshot_*\nassets/downloads/\n.DS_Store\nThumbs.db\n.vscode/\n.idea/\n`;
						writeFileSync(join(root, ".gitignore"), gitignore, "utf-8");
						files.push(".gitignore");

						// Physics layers based on preset
						let physicsLayers = "";
						let inputMap = "";
						let autoloads = "";

						if (args.preset === "roguelike" || args.preset === "rpg") {
							physicsLayers = [
								'3d_physics/layer_1="Environment"', '3d_physics/layer_2="Player"',
								'3d_physics/layer_3="Enemy"', '3d_physics/layer_4="PlayerHurtbox"',
								'3d_physics/layer_5="EnemyHurtbox"', '3d_physics/layer_6="PlayerProjectile"',
								'3d_physics/layer_7="EnemyProjectile"', '3d_physics/layer_8="Interactable"',
								'3d_physics/layer_9="Pickup"', '3d_physics/layer_10="Trigger"',
							].join("\n");
						} else if (args.preset === "platformer_2d") {
							physicsLayers = [
								'2d_physics/layer_1="Environment"', '2d_physics/layer_2="Player"',
								'2d_physics/layer_3="Enemy"', '2d_physics/layer_4="Pickup"',
							].join("\n");
						} else if (args.preset === "fps" || args.preset === "platformer_3d") {
							physicsLayers = [
								'3d_physics/layer_1="Environment"', '3d_physics/layer_2="Player"',
								'3d_physics/layer_3="Enemy"', '3d_physics/layer_4="Projectile"',
							].join("\n");
						}

						// Input map (common across presets)
						inputMap = _generateInputMap(args.preset ?? "blank");

						// project.godot
						const projectGodot = `; Engine configuration file.
config_version=5

[application]

config/name="${args.projectName}"
run/main_scene=""
config/features=PackedStringArray("4.2", "Forward Plus")

[display]

window/size/viewport_width=${args.windowWidth}
window/size/viewport_height=${args.windowHeight}
window/stretch/mode="canvas_items"
${autoloads ? `\n[autoload]\n\n${autoloads}` : ""}
${inputMap ? `\n[input]\n\n${inputMap}` : ""}
${physicsLayers ? `\n[layer_names]\n\n${physicsLayers}` : ""}

[rendering]

renderer/rendering_method="${args.renderer}"
anti_aliasing/quality/msaa_3d=2
`;
						if (!existsSync(join(root, "project.godot"))) {
							writeFileSync(join(root, "project.godot"), projectGodot, "utf-8");
							files.push("project.godot (created)");
						} else {
							files.push("project.godot (already exists, skipped)");
						}

						// Icon placeholder
						if (!existsSync(join(root, "icon.svg"))) {
							const initials = args.projectName.split(/\s+/).map((w: string) => w[0]?.toUpperCase() ?? "").join("").slice(0, 2);
							writeFileSync(join(root, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#1a1a2e"/><text x="64" y="72" font-family="Arial" font-size="48" fill="#e94560" text-anchor="middle" font-weight="bold">${initials}</text></svg>`, "utf-8");
							files.push("icon.svg");
						}

						return { content: [{ type: "text" as const, text: `Initialized project "${args.projectName}" (${args.preset}):\n${files.join("\n")}` }] };
					}

					// ── create_entity ──────────────────────────────────────
					case "create_entity": {
						if (!args.entityType || !args.name || !args.scriptPath || !args.scenePath) {
							return _err("entityType, name, scriptPath, scenePath required");
						}
						const { resToAbsolute: resAbs } = await import("../../utils/path.js");

						const is3d = !args.entityType.includes("2d");
						const dim = is3d ? "3D" : "2D";
						const vec = is3d ? "Vector3" : "Vector2";
						const bodyType = is3d ? "CharacterBody3D" : "CharacterBody2D";
						const hp = args.health ?? 100;
						const spd = args.speed ?? (is3d ? 7.0 : 200.0);
						const dmg = args.damage ?? 10;

						let script = "";
						let tscnNodes = "";
						let extResources = "";
						let subResources = "";
						let extIdx = 1;

						// Script header
						const className = args.name.replace(/[^a-zA-Z0-9]/g, "");

						switch (args.entityType) {
							case "player_3d":
							case "player_2d": {
								script = `class_name ${className}
extends ${bodyType}

@export var move_speed: float = ${spd}
@export var base_damage: float = ${dmg}
@export var crit_chance: float = 0.01

@onready var health: HealthComponent = $HealthComponent

func _ready() -> void:
\tpass

func _physics_process(delta: float) -> void:
\tvar input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
\tvar direction := (transform.basis * ${is3d ? "Vector3(input_dir.x, 0, input_dir.y)" : "Vector2(input_dir.x, input_dir.y)"}).normalized()
\tif direction.length() > 0:
\t\tvelocity${is3d ? ".x" : ".x"} = direction.x * move_speed
\t\t${is3d ? "velocity.z = direction.z * move_speed" : "velocity.y = direction.y * move_speed"}
\telse:
\t\tvelocity = velocity.lerp(${vec}.ZERO, 0.2)
\t${is3d ? "if not is_on_floor():\n\t\tvelocity.y -= 25.0 * delta" : ""}
\tmove_and_slide()
`;
								// Build .tscn with collision + hurtbox + health
								const colShape = is3d ? "CapsuleShape3D" : "CapsuleShape2D";
								subResources = `[sub_resource type="${colShape}" id="col_1"]\nradius = 0.4\nheight = 1.8\n\n[sub_resource type="${is3d ? "SphereShape3D" : "CircleShape2D"}" id="hurt_1"]\nradius = 0.6\n`;
								extResources = `[ext_resource type="Script" path="${args.scriptPath}" id="${extIdx}"]\n`;
								tscnNodes = `[node name="${args.name}" type="${bodyType}"]\ncollision_layer = 2\ncollision_mask = 1\nscript = ExtResource("${extIdx}")\n\n`;
								tscnNodes += `[node name="CollisionShape${dim}" type="CollisionShape${dim}" parent="."]\n${is3d ? 'transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.9, 0)\n' : ""}shape = SubResource("col_1")\n\n`;
								tscnNodes += `[node name="HealthComponent" type="Node" parent="."]\nscript = ExtResource("2")\nmax_health = ${hp}.0\n\n`;
								tscnNodes += `[node name="HurtboxComponent" type="Area${dim}" parent="."]\ncollision_layer = ${is3d ? 8 : 4}\ncollision_mask = ${is3d ? 64 : 8}\nscript = ExtResource("3")\nteam = 0\n\n`;
								tscnNodes += `[node name="HurtboxShape" type="CollisionShape${dim}" parent="HurtboxComponent"]\n${is3d ? 'transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.9, 0)\n' : ""}shape = SubResource("hurt_1")\n`;
								if (args.hasInventory) {
									tscnNodes += `\n[node name="Inventory" type="Node" parent="."]\nscript = ExtResource("4")\n`;
								}
								break;
							}
							case "enemy_3d":
							case "enemy_2d": {
								script = `class_name ${className}
extends ${is3d ? "EnemyBase" : bodyType}

${is3d ? "" : `@export var base_hp: float = ${hp}.0\n@export var base_damage: float = ${dmg}.0\n@export var base_speed: float = ${spd}\n`}
${args.hasNavigation ? `@onready var nav_agent: NavigationAgent${dim} = $NavigationAgent${dim}\n` : ""}
func _ready() -> void:
${is3d ? `\tbase_hp = ${hp}.0\n\tbase_damage = ${dmg}.0\n\tbase_speed = ${spd}\n\tsuper._ready()` : "\tpass"}
${args.hasNavigation ? `\tnav_agent.path_desired_distance = 1.0\n\tnav_agent.target_desired_distance = 1.0` : ""}

func _physics_process(delta: float) -> void:
\tpass
`;
								const colShape2 = is3d ? "CapsuleShape3D" : "CapsuleShape2D";
								subResources = `[sub_resource type="${colShape2}" id="col_1"]\nradius = 0.35\nheight = 1.4\n\n[sub_resource type="${is3d ? "SphereShape3D" : "CircleShape2D"}" id="hurt_1"]\nradius = 0.5\n`;
								extResources = `[ext_resource type="Script" path="${args.scriptPath}" id="1"]\n`;
								tscnNodes = `[node name="${args.name}" type="${is3d ? "CharacterBody3D" : "CharacterBody2D"}"]\ncollision_layer = ${is3d ? 4 : 4}\ncollision_mask = 1\nscript = ExtResource("1")\n\n`;
								tscnNodes += `[node name="CollisionShape${dim}" type="CollisionShape${dim}" parent="."]\n${is3d ? 'transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.7, 0)\n' : ""}shape = SubResource("col_1")\n\n`;
								if (args.hasNavigation) {
									tscnNodes += `[node name="NavigationAgent${dim}" type="NavigationAgent${dim}" parent="."]\n\n`;
								}
								tscnNodes += `[node name="HealthComponent" type="Node" parent="."]\nscript = ExtResource("2")\nmax_health = ${hp}.0\n\n`;
								tscnNodes += `[node name="HurtboxComponent" type="Area${dim}" parent="."]\ncollision_layer = ${is3d ? 16 : 8}\ncollision_mask = ${is3d ? 32 : 4}\nscript = ExtResource("3")\nteam = 1\n\n`;
								tscnNodes += `[node name="HurtboxShape" type="CollisionShape${dim}" parent="HurtboxComponent"]\n${is3d ? 'transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.7, 0)\n' : ""}shape = SubResource("hurt_1")\n\n`;
								tscnNodes += `[node name="KnockbackComponent" type="Node" parent="."]\nscript = ExtResource("4")\n`;
								break;
							}
							case "projectile": {
								script = `class_name ${className}
extends Area${dim}

@export var speed: float = ${spd}
@export var damage: float = ${dmg}.0
@export var lifetime: float = 3.0

var direction: ${vec} = ${is3d ? "Vector3.FORWARD" : "Vector2.RIGHT"}
var _timer: float = 0.0

func _ready() -> void:
\tarea_entered.connect(_on_hit)

func _physics_process(delta: float) -> void:
\tglobal_position += direction * speed * delta
\t_timer += delta
\tif _timer >= lifetime:
\t\tqueue_free()

func _on_hit(area: Area${dim}) -> void:
\tif area is HurtboxComponent:
\t\tvar hurtbox := area as HurtboxComponent
\t\tvar kb_dir := direction.normalized()
\t\thurtbox.receive_hit(damage, 5.0, ${is3d ? "kb_dir" : "kb_dir"}, 1.0, get_parent())
\t\tqueue_free()
`;
								subResources = `[sub_resource type="${is3d ? "SphereShape3D" : "CircleShape2D"}" id="col_1"]\nradius = 0.3\n`;
								extResources = `[ext_resource type="Script" path="${args.scriptPath}" id="1"]\n`;
								tscnNodes = `[node name="${args.name}" type="Area${dim}"]\ncollision_layer = ${is3d ? 32 : 4}\ncollision_mask = ${is3d ? 16 : 8}\nscript = ExtResource("1")\n\n`;
								tscnNodes += `[node name="CollisionShape${dim}" type="CollisionShape${dim}" parent="."]\nshape = SubResource("col_1")\n`;
								break;
							}
							case "interactable": {
								script = `class_name ${className}
extends StaticBody${dim}

signal interacted(entity: Node)

@export var interaction_text: String = "[E] Interact"
var _player_nearby: bool = false

func _ready() -> void:
\t$InteractArea.body_entered.connect(func(body): if body.is_in_group("player"): _player_nearby = true)
\t$InteractArea.body_exited.connect(func(body): if body.is_in_group("player"): _player_nearby = false)

func _unhandled_input(event: InputEvent) -> void:
\tif _player_nearby and event.is_action_pressed("interact"):
\t\tinteracted.emit(get_tree().get_first_node_in_group("player"))
`;
								subResources = `[sub_resource type="${is3d ? "BoxShape3D" : "RectangleShape2D"}" id="col_1"]\n${is3d ? "size = Vector3(1, 1, 1)" : "size = Vector2(32, 32)"}\n`;
								extResources = `[ext_resource type="Script" path="${args.scriptPath}" id="1"]\n`;
								tscnNodes = `[node name="${args.name}" type="StaticBody${dim}"]\ncollision_layer = ${is3d ? 128 : 16}\nscript = ExtResource("1")\n\n`;
								tscnNodes += `[node name="CollisionShape${dim}" type="CollisionShape${dim}" parent="."]\nshape = SubResource("col_1")\n\n`;
								tscnNodes += `[node name="InteractArea" type="Area${dim}" parent="."]\ncollision_layer = 0\ncollision_mask = 2\n\n`;
								tscnNodes += `[node name="InteractShape" type="CollisionShape${dim}" parent="InteractArea"]\n`;
								const interactShape = is3d ? `[sub_resource type="SphereShape3D" id="interact_1"]\nradius = 3.0\n` : `[sub_resource type="CircleShape2D" id="interact_1"]\nradius = 48.0\n`;
								subResources += `\n${interactShape}`;
								tscnNodes += `shape = SubResource("interact_1")\n`;
								break;
							}
							default: {
								// Generic pickup
								script = `class_name ${className}\nextends Area${dim}\n\nfunc _ready() -> void:\n\tpass\n`;
								extResources = `[ext_resource type="Script" path="${args.scriptPath}" id="1"]\n`;
								tscnNodes = `[node name="${args.name}" type="Area${dim}"]\nscript = ExtResource("1")\n`;
							}
						}

						// Write script
						const absScript = resAbs(args.scriptPath, ctx.projectRoot);
						mkdirSync(dirname(absScript), { recursive: true });
						writeFileSync(absScript, script, "utf-8");

						// Write scene
						const absScene = resAbs(args.scenePath, ctx.projectRoot);
						mkdirSync(dirname(absScene), { recursive: true });
						// Count ext_resources needed
						let loadSteps = 2;
						if (args.entityType.includes("player") || args.entityType.includes("enemy")) loadSteps = 5;
						const tscn = `[gd_scene load_steps=${loadSteps} format=3]\n\n${extResources}\n${subResources}\n${tscnNodes}`;
						writeFileSync(absScene, tscn, "utf-8");

						return { content: [{ type: "text" as const, text: `Created ${args.entityType} "${args.name}":\n  Script: ${args.scriptPath}\n  Scene: ${args.scenePath}\n  HP: ${hp}, Speed: ${spd}, Damage: ${dmg}${args.hasNavigation ? "\n  + NavigationAgent" : ""}${args.hasInventory ? "\n  + Inventory" : ""}` }] };
					}

					// ── validate ───────────────────────────────────────────
					case "validate": {
						const errors: Array<{ file: string; line?: number; severity: string; message: string }> = [];
						const root = ctx.projectRoot;

						// Check all .tscn files
						const scenes = ctx.getAssetManager().byCategory("scene");
						for (const scene of scenes) {
							try {
								const content = readFileSync(scene.absPath, "utf-8");
								// Check ext_resource paths
								const extResMatches = content.matchAll(/path="(res:\/\/[^"]+)"/g);
								for (const match of extResMatches) {
									const resPath = match[1];
									try {
										const { resToAbsolute: r } = await import("../../utils/path.js");
										const absPath = r(resPath, root);
										if (!existsSync(absPath)) {
											errors.push({ file: scene.resPath, severity: "ERROR", message: `Missing resource: ${resPath}` });
										}
									} catch { /* skip */ }
								}
							} catch (e) {
								errors.push({ file: scene.resPath, severity: "ERROR", message: `Parse error: ${e}` });
							}
						}

						// Check all scripts for class_name references that don't exist
						const scripts = ctx.getAssetManager().byCategory("script");
						const classNames = new Set<string>();
						for (const s of scripts) {
							try {
								const content = readFileSync(s.absPath, "utf-8");
								const classMatch = content.match(/^class_name\s+(\w+)/m);
								if (classMatch) classNames.add(classMatch[1]);
							} catch { /* skip */ }
						}

						// Check extends references
						for (const s of scripts) {
							try {
								const content = readFileSync(s.absPath, "utf-8");
								const extendsMatch = content.match(/^extends\s+(\w+)/m);
								if (extendsMatch) {
									const base = extendsMatch[1];
									// Built-in types are fine, check custom class_names
									if (base[0] === base[0].toUpperCase() && !_isBuiltinType(base) && !classNames.has(base)) {
										errors.push({ file: s.resPath, severity: "WARNING", message: `Extends unknown class: ${base}` });
									}
								}
							} catch { /* skip */ }
						}

						// Check project.godot autoload paths
						try {
							const projContent = readFileSync(join(root, "project.godot"), "utf-8");
							const autoloadMatches = projContent.matchAll(/="?\*?res:\/\/([^"]+)"?/g);
							for (const m of autoloadMatches) {
								const resPath = `res://${m[1]}`;
								try {
									const { resToAbsolute: r } = await import("../../utils/path.js");
									if (!existsSync(r(resPath, root))) {
										errors.push({ file: "project.godot", severity: "ERROR", message: `Missing autoload: ${resPath}` });
									}
								} catch { /* skip */ }
							}
						} catch { /* no project.godot */ }

						const summary = errors.length === 0
							? `Validation passed! ${scenes.length} scenes, ${scripts.length} scripts checked — no errors.`
							: `Found ${errors.length} issue(s):\n\n${errors.map((e) => `[${e.severity}] ${e.file}: ${e.message}`).join("\n")}`;

						return { content: [{ type: "text" as const, text: summary }] };
					}

					// ── theme_preset ───────────────────────────────────────
					case "theme_preset": {
						if (!args.path || !args.presetTheme) return _err("path and presetTheme required");
						const { resToAbsolute: r } = await import("../../utils/path.js");

						const presets: Record<string, { bg: string; panel: string; button: string; buttonHover: string; accent: string; text: string; textDim: string; border: string }> = {
							dark_roguelike: { bg: "Color(0.08, 0.07, 0.09, 1)", panel: "Color(0.12, 0.11, 0.14, 0.95)", button: "Color(0.15, 0.13, 0.18, 1)", buttonHover: "Color(0.22, 0.18, 0.28, 1)", accent: "Color(0.92, 0.35, 0.22, 1)", text: "Color(0.9, 0.88, 0.82, 1)", textDim: "Color(0.55, 0.52, 0.48, 1)", border: "Color(0.35, 0.28, 0.22, 1)" },
							sci_fi: { bg: "Color(0.04, 0.06, 0.1, 1)", panel: "Color(0.06, 0.1, 0.16, 0.95)", button: "Color(0.08, 0.12, 0.2, 1)", buttonHover: "Color(0.1, 0.18, 0.3, 1)", accent: "Color(0.2, 0.7, 1.0, 1)", text: "Color(0.85, 0.9, 0.95, 1)", textDim: "Color(0.4, 0.5, 0.6, 1)", border: "Color(0.15, 0.3, 0.5, 1)" },
							fantasy: { bg: "Color(0.1, 0.08, 0.06, 1)", panel: "Color(0.15, 0.12, 0.08, 0.95)", button: "Color(0.2, 0.16, 0.1, 1)", buttonHover: "Color(0.3, 0.22, 0.14, 1)", accent: "Color(0.9, 0.75, 0.3, 1)", text: "Color(0.95, 0.9, 0.8, 1)", textDim: "Color(0.6, 0.55, 0.45, 1)", border: "Color(0.5, 0.4, 0.25, 1)" },
							minimal: { bg: "Color(0.12, 0.12, 0.12, 1)", panel: "Color(0.18, 0.18, 0.18, 0.95)", button: "Color(0.22, 0.22, 0.22, 1)", buttonHover: "Color(0.3, 0.3, 0.3, 1)", accent: "Color(0.95, 0.95, 0.95, 1)", text: "Color(0.9, 0.9, 0.9, 1)", textDim: "Color(0.5, 0.5, 0.5, 1)", border: "Color(0.3, 0.3, 0.3, 1)" },
							retro: { bg: "Color(0.12, 0.1, 0.15, 1)", panel: "Color(0.16, 0.14, 0.2, 0.95)", button: "Color(0.2, 0.18, 0.25, 1)", buttonHover: "Color(0.28, 0.24, 0.35, 1)", accent: "Color(0.3, 0.9, 0.4, 1)", text: "Color(0.3, 0.9, 0.4, 1)", textDim: "Color(0.2, 0.5, 0.25, 1)", border: "Color(0.2, 0.6, 0.3, 1)" },
							cyberpunk: { bg: "Color(0.05, 0.02, 0.08, 1)", panel: "Color(0.08, 0.04, 0.12, 0.95)", button: "Color(0.1, 0.05, 0.15, 1)", buttonHover: "Color(0.18, 0.08, 0.25, 1)", accent: "Color(1.0, 0.2, 0.6, 1)", text: "Color(0.9, 0.85, 0.95, 1)", textDim: "Color(0.5, 0.4, 0.6, 1)", border: "Color(0.6, 0.15, 0.4, 1)" },
						};

						const p = presets[args.presetTheme];
						if (!p) return _err(`Unknown preset: ${args.presetTheme}`);

						const themeContent = `[gd_resource type="Theme" format=3]

[sub_resource type="StyleBoxFlat" id="panel"]
bg_color = ${p.panel}
border_color = ${p.border}
border_width_left = 2
border_width_top = 2
border_width_right = 2
border_width_bottom = 2
corner_radius_left_top = 6
corner_radius_right_top = 6
corner_radius_left_bottom = 6
corner_radius_right_bottom = 6
content_margin_left = 16.0
content_margin_top = 16.0
content_margin_right = 16.0
content_margin_bottom = 16.0

[sub_resource type="StyleBoxFlat" id="btn_normal"]
bg_color = ${p.button}
border_color = ${p.border}
border_width_left = 2
border_width_top = 2
border_width_right = 2
border_width_bottom = 2
corner_radius_left_top = 4
corner_radius_right_top = 4
corner_radius_left_bottom = 4
corner_radius_right_bottom = 4
content_margin_left = 10.0
content_margin_top = 10.0
content_margin_right = 10.0
content_margin_bottom = 10.0

[sub_resource type="StyleBoxFlat" id="btn_hover"]
bg_color = ${p.buttonHover}
border_color = ${p.accent}
border_width_left = 2
border_width_top = 2
border_width_right = 2
border_width_bottom = 2
corner_radius_left_top = 4
corner_radius_right_top = 4
corner_radius_left_bottom = 4
corner_radius_right_bottom = 4
content_margin_left = 10.0
content_margin_top = 10.0
content_margin_right = 10.0
content_margin_bottom = 10.0

[sub_resource type="StyleBoxFlat" id="btn_pressed"]
bg_color = ${p.accent}
border_color = ${p.accent}
border_width_left = 2
border_width_top = 2
border_width_right = 2
border_width_bottom = 2
corner_radius_left_top = 4
corner_radius_right_top = 4
corner_radius_left_bottom = 4
corner_radius_right_bottom = 4

[resource]
default_font_size = 16
PanelContainer/styles/panel = SubResource("panel")
Button/styles/normal = SubResource("btn_normal")
Button/styles/hover = SubResource("btn_hover")
Button/styles/pressed = SubResource("btn_pressed")
Button/styles/focus = SubResource("btn_hover")
Button/colors/font_color = ${p.text}
Button/colors/font_hover_color = ${p.accent}
Button/colors/font_pressed_color = Color(1, 1, 1, 1)
Label/colors/font_color = ${p.text}
LineEdit/colors/font_color = ${p.text}
LineEdit/colors/font_placeholder_color = ${p.textDim}
`;
						const absPath = r(args.path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, themeContent, "utf-8");
						return { content: [{ type: "text" as const, text: `Created ${args.presetTheme} theme at ${args.path}` }] };
					}

					// ── rename_class ───────────────────────────────────────
					case "rename_class": {
						if (!args.oldName || !args.newName) return _err("oldName and newName required");
						const changes: Array<{ file: string; count: number }> = [];

						const allFiles = [
							...ctx.getAssetManager().byCategory("script"),
							...ctx.getAssetManager().byCategory("scene"),
						];

						const oldNameEscaped = args.oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
						const pattern = new RegExp(`\\b${oldNameEscaped}\\b`, "g");

						for (const f of allFiles) {
							try {
								const content = readFileSync(f.absPath, "utf-8");
								const matches = content.match(pattern);
								if (matches && matches.length > 0) {
									if (!args.dryRun) {
										const newContent = content.replace(pattern, args.newName);
										writeFileSync(f.absPath, newContent, "utf-8");
									}
									changes.push({ file: f.resPath, count: matches.length });
								}
							} catch { /* skip */ }
						}

						const mode = args.dryRun ? "DRY RUN" : "APPLIED";
						const summary = changes.length === 0
							? `No references to "${args.oldName}" found.`
							: `${mode}: Renamed "${args.oldName}" → "${args.newName}" in ${changes.length} files:\n${changes.map((c) => `  ${c.file} (${c.count} occurrences)`).join("\n")}`;
						return { content: [{ type: "text" as const, text: summary }] };
					}

					default:
						return _err(`Unknown action: ${args.action}`);
				}
			} catch (e) {
				return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
			}
		},
	);
}

function _err(msg: string) {
	return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function _isBuiltinType(name: string): boolean {
	const builtins = new Set([
		"Node", "Node2D", "Node3D", "Control", "Resource", "RefCounted", "Object",
		"CharacterBody2D", "CharacterBody3D", "RigidBody2D", "RigidBody3D",
		"StaticBody2D", "StaticBody3D", "Area2D", "Area3D",
		"AnimationPlayer", "AnimationTree", "Camera2D", "Camera3D",
		"CollisionShape2D", "CollisionShape3D", "Sprite2D", "Sprite3D",
		"MeshInstance3D", "MeshInstance2D", "Label", "Button", "CanvasLayer",
		"AudioStreamPlayer", "AudioStreamPlayer2D", "AudioStreamPlayer3D",
		"NavigationAgent2D", "NavigationAgent3D", "NavigationRegion2D", "NavigationRegion3D",
		"Timer", "RayCast2D", "RayCast3D", "TileMapLayer", "SubViewport",
		"WorldEnvironment", "DirectionalLight3D", "OmniLight3D", "SpotLight3D",
		"GPUParticles3D", "CPUParticles3D", "GPUParticles2D", "CPUParticles2D",
		"SpringArm3D", "Marker2D", "Marker3D", "Path3D", "PathFollow3D",
		"VBoxContainer", "HBoxContainer", "PanelContainer", "MarginContainer",
		"ProgressBar", "TextureRect", "Label3D", "LineEdit", "OptionButton",
		"CheckButton", "HSlider", "HSeparator", "ColorRect",
	]);
	return builtins.has(name);
}

function _generateInputMap(preset: string): string {
	const _key = (keycode: number) => `Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":${keycode},"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)`;
	const _mouse = (button: number) => `Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":${button},"position":Vector2(0,0),"global_position":Vector2(0,0),"factor":1.0,"button_index":${button},"canceled":false,"pressed":true,"double_click":false,"script":null)`;

	const actions: Record<string, string> = {
		move_forward: _key(87), // W
		move_back: _key(83),    // S
		move_left: _key(65),    // A
		move_right: _key(68),   // D
		jump: _key(32),         // Space
		sprint: _key(4194325),  // Shift
		interact: _key(69),     // E
		pause: _key(4194305),   // Escape
	};

	if (preset === "roguelike" || preset === "rpg" || preset === "fps") {
		actions.primary_attack = _mouse(1);
		actions.secondary_attack = _mouse(2);
		actions.utility_ability = _key(4194325); // Shift
		actions.special_ability = _key(82);       // R
		actions.info = _key(4194306);             // Tab
	}

	let result = "";
	for (const [name, event] of Object.entries(actions)) {
		result += `${name}={\n"deadzone": 0.5,\n"events": [${event}]\n}\n`;
	}
	return result;
}
